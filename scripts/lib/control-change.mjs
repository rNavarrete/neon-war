// Pure control-change classification (ENG-140, G-B3/G-B4). No I/O here so it can
// be unit tested; scripts/control-change.mjs is the CLI wrapper.
//
// Deny by default: a change to ANY path is a control change unless the path is
// plain content under the allowlist below. Even inside the allowlist,
// config-looking files (dotfiles, CODEOWNERS, package.json, tsconfig*.json,
// *.config.*, vitest.workspace*) are control changes. Test-weakening edits and
// added lint/type suppressions are flagged anywhere. Test files are judged
// conservatively: any change to an existing test file (*.test.* / *.spec.*), any
// rename of a test-like file, any test-like file outside the vitest include, and
// any removed or modified non-blank line under tests/ is flagged; only brand-new
// test files inside the suite can be unflagged. Detective only: it never
// blocks, it flags the change for Rolando's explicit review.
//
// The same predicate (isControlPath) decides which files feed the check's
// configSha256, so "would be flagged if changed" == "is part of the check revision".

// Plain content: product source, tests, docs. CLAUDE.md is deliberately absent
// (worker instructions are a control).
export const CONTENT_ALLOWLIST = [
  { re: /^src\//, label: 'src/**' },
  { re: /^tests\//, label: 'tests/**' },
  { re: /^docs\//, label: 'docs/**' },
  { re: /^README\.md$/, label: 'README.md' },
  { re: /^index\.html$/, label: 'index.html' },
];

const CONFIG_BASENAMES = [
  { re: /^\./, label: 'dotfile' },
  { re: /^CODEOWNERS$/, label: 'CODEOWNERS' },
  { re: /^package\.json$/, label: 'package.json' },
  { re: /^tsconfig.*\.json$/, label: 'tsconfig*.json' },
  { re: /\.config\./, label: '*.config.*' },
  { re: /^vitest\.workspace/, label: 'vitest.workspace*' },
];

const ASSERTION_RE = /(?:^|[^\w.$])(?:(?:expect(?:\.soft)?|it|test|assert)\s*\(|assert\.\w+\s*\()/;
const WEAKENING_RE = new RegExp(
  [
    // it.skip / test.only / describe.todo / it.concurrent.skip / describe.skipIf / test.runIf
    String.raw`(?:^|[^\w$])(?:it|test|describe|suite)(?:\.concurrent)?\.(?:skip|only|todo|skipIf|runIf)\b`,
    String.raw`(?:^|[^\w$])(?:it|test)\.fails\b`,
    String.raw`(?:^|[^\w$])(?:xit|xtest|xdescribe|fit|fdescribe)\s*\(`,
  ].join('|'),
);
const SUPPRESSION_RE = /@ts-nocheck|@ts-ignore|@ts-expect-error|eslint-disable/;

export function normalizePath(p) {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '');
}

function basename(p) {
  const parts = p.split('/');
  return parts[parts.length - 1];
}

/**
 * Why a path is a control path, or null when it is plain allowlisted content.
 * @param {string} path repo-relative path
 * @returns {string | null}
 */
export function controlPathReason(path) {
  const p = normalizePath(path);
  if (p === '') return 'empty path';
  const allowed = CONTENT_ALLOWLIST.find(({ re }) => re.test(p));
  if (!allowed)
    return 'protected path (not in content allowlist: src/**, tests/**, docs/**, README.md, index.html)';
  const config = CONFIG_BASENAMES.find(({ re }) => re.test(basename(p)));
  if (config) return `protected path (config file ${config.label} inside ${allowed.label})`;
  return null;
}

export function isControlPath(path) {
  return controlPathReason(path) !== null;
}

// Test-like: anything under tests/ or named *.test.* / *.spec.*. Deliberately
// broader than what vitest runs, so edits to any test-looking file are scrutinized.
const TEST_NAME_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;

export function isTestFile(path) {
  const p = normalizePath(path);
  return p.startsWith('tests/') || TEST_NAME_RE.test(p);
}

// What the suite actually collects: vitest (vite.config.ts `include: ['tests/**/*.test.ts']`)
// and Playwright (playwright.config.ts `testDir: 'tests/browser'`, `testMatch: '**/*.spec.ts'`).
export function isInTestSuite(path) {
  const p = normalizePath(path);
  return /^tests\/(?:.+\/)?[^/]+\.test\.ts$/.test(p) || /^tests\/browser\/(?:.+\/)?[^/]+\.spec\.ts$/.test(p);
}

function isDeleted(status) {
  const s = String(status ?? '').toLowerCase();
  return s === 'd' || s === 'deleted' || s === 'removed';
}

function isAdded(status) {
  const s = String(status ?? '').toLowerCase();
  return s === 'a' || s === 'added';
}

function isRenamed(status) {
  const s = String(status ?? '').toLowerCase();
  return s.startsWith('r') || s === 'renamed';
}

function patchLines(patch) {
  const added = [];
  const removed = [];
  for (const line of String(patch ?? '').split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added.push(line.slice(1));
    else if (line.startsWith('-')) removed.push(line.slice(1));
  }
  return { added, removed };
}

/**
 * @param {{ path: string, status?: string, patch?: string, oldPath?: string }[]} files
 * @returns {{ flagged: boolean, reasons: string[] }}
 */
export function classifyDiff(files) {
  const reasons = [];
  for (const file of files ?? []) {
    const path = normalizePath(file?.path);
    const oldPath = file?.oldPath ? normalizePath(file.oldPath) : null;
    const status = file?.status;

    // Either side of a rename counts.
    for (const p of new Set([path, oldPath].filter((x) => x !== null))) {
      const why = controlPathReason(p);
      if (why) reasons.push(`${p || '(empty path)'}: ${why} changed`);
    }

    const { added, removed } = patchLines(file?.patch);

    const suppressions = added.filter((l) => SUPPRESSION_RE.test(l));
    if (suppressions.length > 0) {
      reasons.push(`${path}: adds lint/type suppression (${suppressions.map((l) => l.trim()).join(' | ')})`);
    }

    const testNow = isTestFile(path);
    const testBefore = oldPath ? isTestFile(oldPath) : testNow;
    // Conservative: ANY change to an existing test file (modified, renamed, copied,
    // removed, type change, or unknown status) is flagged. Added lines alone can
    // disable assertions (e.g. an early `return;` at the top of a test), which no
    // line-level heuristic reliably catches. Only brand-new test files stay
    // unflagged (still subject to the suite, suppression and skip rules below).
    // Plain helpers under tests/ (e.g. tests/helpers.ts) are not covered here.
    const testNamedNow = TEST_NAME_RE.test(path);
    const testNamedBefore = oldPath ? TEST_NAME_RE.test(oldPath) : testNamedNow;
    if ((testNamedNow || testNamedBefore) && (!isAdded(status) || (oldPath && oldPath !== path))) {
      reasons.push(`${path}: existing test file changed: needs review`);
    }
    if ((testNow || testBefore) && isDeleted(status)) {
      reasons.push(`${path}: test file deleted`);
      continue;
    }
    // Conservative: any rename touching a test-like file on either side is flagged
    // (a move can silently take a test out of what vitest collects).
    if (oldPath && oldPath !== path && (testBefore || testNow)) {
      reasons.push(
        testBefore && !isInTestSuite(path)
          ? `${oldPath} -> ${path}: test file moved out of the test suite`
          : `${oldPath} -> ${path}: test file renamed${isRenamed(status) ? '' : ' or copied'}`,
      );
    }
    if (!testNow && !testBefore) continue;
    // A file named like a test (*.test.* / *.spec.*) that vitest will not collect.
    // Plain helpers under tests/ (e.g. tests/helpers.ts) are not tests themselves.
    if (TEST_NAME_RE.test(path) && !isInTestSuite(path)) {
      reasons.push(
        `${path}: test file outside the suite will not run (vitest includes only tests/**/*.test.ts, Playwright only tests/browser/**/*.spec.ts)`,
      );
    }
    // Conservative: any removed or modified existing non-blank line in a test file
    // can weaken it (e.g. expect(add(1, 2)).toBe(3) -> expect(true).toBe(true)).
    // (Pure additions to an existing test file are caught by the rule above; this
    // still matters for plain helpers under tests/.)
    const changedLines = removed.filter((l) => l.trim() !== '');
    if (changedLines.length > 0) {
      reasons.push(
        `${path}: removes or modifies ${changedLines.length} existing test line(s) (${changedLines
          .slice(0, 3)
          .map((l) => l.trim())
          .join(' | ')}${changedLines.length > 3 ? ' | ...' : ''})`,
      );
    }

    const addedAssertions = added.filter((l) => ASSERTION_RE.test(l)).length;
    const removedAssertions = removed.filter((l) => ASSERTION_RE.test(l)).length;
    if (removedAssertions > addedAssertions) {
      reasons.push(
        `${path}: removes more assertion/test lines than it adds (${removedAssertions} removed, ${addedAssertions} added)`,
      );
    }
    const weakening = added.filter((l) => WEAKENING_RE.test(l));
    if (weakening.length > 0) {
      reasons.push(
        `${path}: adds skip/only/todo/fails/skipIf/runIf (${weakening.map((l) => l.trim()).join(' | ')})`,
      );
    }
  }
  return { flagged: reasons.length > 0, reasons };
}
