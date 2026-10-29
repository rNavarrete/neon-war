#!/usr/bin/env node
// Seeded passing/failing examples for `npm run check` (G-B1, G-B5).
// Runs the pure-lib unit tests, then for each case copies the repo into a temp dir,
// makes a clean git commit, applies a seed and runs scripts/check.mjs there.
// Never writes to the real repo except the result file (--out, default check-selftest.json).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIGEST = 'ab'.repeat(32);
// Digest claimed in the PR body for the contract-claim cases (distinct from DIGEST).
const CLAIM_DIGEST = '0123456789abcdef'.repeat(4);
const CASE_TIMEOUT_MS = 5 * 60 * 1000;
const UNIT_TIMEOUT_MS = 60 * 1000;
const REQUIRED = ['format', 'lint', 'typecheck', 'test', 'build', 'e2e'];

const outArg = process.argv.indexOf('--out');
const OUT = path.resolve(ROOT, outArg > -1 ? process.argv[outArg + 1] : 'check-selftest.json');

function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

function git(cwd, ...args) {
  const r = run('git', ['-c', 'user.name=selftest', '-c', 'user.email=selftest@example.invalid', ...args], {
    cwd,
  });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function listRepoFiles() {
  // Tracked plus untracked-but-not-ignored, so uncommitted work is included.
  const out = git(ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard');
  const files = [...new Set(out.split('\0').filter(Boolean))];
  return files.filter((f) => {
    try {
      return fs.lstatSync(path.join(ROOT, f)).isFile();
    } catch {
      return false; // deleted in the working tree
    }
  });
}

function makeCopy(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-selftest-'));
  for (const f of files) {
    const dest = path.join(dir, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), dest);
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--no-verify', '-m', 'selftest baseline');
  return dir;
}

function write(dir, rel, content) {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
}

function commitSeed(dir) {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--no-verify', '-m', 'selftest seed');
}

function writeEvent(file, title, body) {
  fs.writeFileSync(file, JSON.stringify({ pull_request: { title, body } }) + '\n');
}

// fail: steps that must fail. ignore: steps whose result is not asserted.
// Every other step in the evidence must pass.
// event(file): writes a fake GitHub event to `file` (outside the repo copy) and
// runs check.mjs with --contract-claim-from-event instead of --contract-digest.
// claimError: check must exit nonzero even though every step passes.
// shards: run the CI shard flow instead: `--e2e-shard i/n` for i in 1..runShards into a dir
// outside the copy, then the check with `--e2e-from-shards <dir>`.
const CASES = [
  { name: 'baseline', seed: () => {}, expectPass: true },
  {
    name: 'format error',
    seed: (dir) => {
      write(dir, 'src/seed-format.ts', 'export const   seedFormat   =   {a:1}\n');
      commitSeed(dir);
    },
    fail: ['format'],
  },
  {
    name: 'lint error',
    seed: (dir) => {
      write(dir, 'src/seed-lint.ts', 'const unused = 1;\nexport {};\n');
      commitSeed(dir);
    },
    fail: ['lint'],
  },
  {
    name: 'type error',
    seed: (dir) => {
      write(dir, 'src/seed-type.ts', "export const n: number = 'x';\n");
      commitSeed(dir);
    },
    fail: ['typecheck'],
    ignore: ['build'],
  },
  {
    name: 'failing test',
    seed: (dir) => {
      write(
        dir,
        'tests/seed.test.ts',
        "describe('seed', () => {\n  it('fails', () => {\n    expect(1).toBe(2);\n  });\n});\n",
      );
      commitSeed(dir);
    },
    fail: ['test'],
  },
  {
    name: 'failing browser test',
    seed: (dir) => {
      write(
        dir,
        'tests/browser/seed.spec.ts',
        "import { expect, test } from '@playwright/test';\n\ntest('fails', async ({ page }) => {\n  await page.goto('/?test');\n  expect(await page.title()).toBe('not the title');\n});\n",
      );
      commitSeed(dir);
    },
    fail: ['e2e'],
  },
  {
    name: 'dirty tree',
    seed: (dir) => {
      // Valid content, but not committed: the tree is not a candidate commit.
      write(dir, 'src/seed-dirty.ts', 'export const seedDirty = 1;\n');
    },
    fail: [],
    dirty: true,
  },
  {
    name: 'contract claim',
    seed: () => {},
    expectPass: true,
    event: (file) =>
      writeEvent(file, `[T1 a1 ${CLAIM_DIGEST.slice(0, 12)}] x`, `Contract-Digest: ${CLAIM_DIGEST}`),
    expectDigest: CLAIM_DIGEST,
    expectDigestSource: 'pr-body',
  },
  {
    name: 'claim mismatch',
    seed: () => {},
    event: (file) => writeEvent(file, '[T1 a1 fedcba987654] x', `Contract-Digest: ${CLAIM_DIGEST}`),
    // check.mjs records the claim as its own "contract" step; other steps still pass.
    ignore: ['contract'],
    claimError: true,
  },
  { name: 'sharded e2e', seed: () => {}, expectPass: true, shards: { total: 1, run: 1 } },
  // A shard set with one shard never run: e2e must fail even though no shard failed.
  { name: 'missing shard', seed: () => {}, shards: { total: 2, run: 1 }, fail: ['e2e'] },
];

function checkCase(c, files) {
  const problems = [];
  const started = Date.now();
  const dir = makeCopy(files);
  let evidence = null;
  let exitCode = null;
  try {
    c.seed(dir);
    const head = git(dir, 'rev-parse', 'HEAD');
    const out = path.join(dir, '..', `${path.basename(dir)}-e.json`);
    // No case inherits a real GitHub event from the environment.
    const env = { ...process.env, FACTORY_CONTRACT_DIGEST: '', GITHUB_STEP_SUMMARY: '' };
    delete env.GITHUB_EVENT_PATH;
    let args = ['--contract-digest', DIGEST];
    let eventFile = null;
    if (c.event) {
      eventFile = path.join(dir, '..', `${path.basename(dir)}-event.json`);
      c.event(eventFile);
      env.GITHUB_EVENT_PATH = eventFile;
      args = ['--contract-claim-from-event'];
    }
    let shardDir = null;
    if (c.shards) {
      shardDir = path.join(dir, '..', `${path.basename(dir)}-shards`);
      fs.mkdirSync(shardDir);
      for (let i = 1; i <= c.shards.run; i++) {
        const s = run(
          process.execPath,
          [
            'scripts/check.mjs',
            '--e2e-shard',
            `${i}/${c.shards.total}`,
            '--out',
            path.join(shardDir, `${i}`, `check-evidence-e2e-shard-${i}.json`),
          ],
          { cwd: dir, timeout: CASE_TIMEOUT_MS, killSignal: 'SIGKILL', env },
        );
        if (s.status !== 0) problems.push(`shard ${i}/${c.shards.total} exit ${s.status}, expected 0`);
      }
      args = [...args, '--e2e-from-shards', shardDir];
    }
    const r = run(process.execPath, ['scripts/check.mjs', '--out', out, ...args], {
      cwd: dir,
      timeout: CASE_TIMEOUT_MS,
      killSignal: 'SIGKILL',
      env,
    });
    if (shardDir) fs.rmSync(shardDir, { recursive: true, force: true });
    if (eventFile) fs.rmSync(eventFile, { force: true });
    exitCode = r.status;
    if (r.error) problems.push(`check.mjs did not finish: ${r.error.message}`);
    try {
      evidence = JSON.parse(fs.readFileSync(out, 'utf8'));
      fs.rmSync(out, { force: true });
    } catch (err) {
      // A rejected contract claim may stop before evidence is written; only the exit code matters then.
      if (!c.claimError) problems.push(`no readable evidence: ${err.message}`);
    }

    if (c.expectPass) {
      if (exitCode !== 0) problems.push(`exit ${exitCode}, expected 0`);
    } else if (exitCode === 0) {
      problems.push('exit 0, expected nonzero');
    }

    if (evidence) {
      const steps = Array.isArray(evidence.steps) ? evidence.steps : [];
      const byName = new Map(steps.map((s) => [s.name, s]));
      if (evidence.schemaVersion !== 1) problems.push(`schemaVersion ${evidence.schemaVersion}`);
      if (c.claimError) {
        if (evidence.outcome === 'pass' && !(evidence.contractClaimErrors?.length > 0)) {
          problems.push('outcome pass with no contractClaimErrors for a mismatched claim');
        }
      } else if (evidence.outcome !== (c.expectPass ? 'pass' : 'fail')) {
        problems.push(`outcome ${evidence.outcome}`);
      }
      if (evidence.candidate?.commit !== head) {
        problems.push(`commit ${evidence.candidate?.commit} != HEAD ${head}`);
      }
      if (evidence.candidate?.treeClean !== !c.dirty) {
        problems.push(`treeClean ${evidence.candidate?.treeClean}`);
      }
      const wantDigest = c.expectDigest ?? (c.event ? undefined : DIGEST);
      if (wantDigest !== undefined && evidence.contractDigest !== wantDigest) {
        problems.push(`contractDigest ${evidence.contractDigest}, expected ${wantDigest}`);
      }
      if (c.expectDigestSource && evidence.contractDigestSource !== c.expectDigestSource) {
        problems.push(
          `contractDigestSource ${evidence.contractDigestSource}, expected ${c.expectDigestSource}`,
        );
      }
      const rev = evidence.checkRevision ?? {};
      for (const k of ['checkVersion', 'checkScriptSha256', 'workflowSha256', 'configSha256']) {
        if (!rev[k]) problems.push(`checkRevision.${k} missing`);
      }
      for (const name of REQUIRED) {
        if (!byName.has(name)) problems.push(`step ${name} missing`);
      }
      if (c.shards && !/merged from/.test(byName.get('e2e')?.command ?? '')) {
        problems.push(`e2e step was not merged from shards: ${byName.get('e2e')?.command}`);
      }
      const fail = c.fail ?? [];
      const ignore = c.ignore ?? [];
      for (const s of steps) {
        if (ignore.includes(s.name)) continue;
        if (fail.includes(s.name)) {
          if (s.status !== 'fail') problems.push(`step ${s.name} is ${s.status}, expected fail`);
          if (!s.logTail || !String(s.logTail).trim()) problems.push(`step ${s.name} logTail empty`);
        } else if (s.status !== 'pass') {
          problems.push(`step ${s.name} is ${s.status}, expected pass`);
        }
      }
    }
  } catch (err) {
    problems.push(`harness error: ${err.message}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return {
    name: c.name,
    ok: problems.length === 0,
    exitCode,
    outcome: evidence?.outcome ?? null,
    steps: Object.fromEntries((evidence?.steps ?? []).map((s) => [s.name, s.status])),
    durationMs: Date.now() - started,
    problems,
  };
}

function unitTests() {
  const started = Date.now();
  const libDir = path.join(ROOT, 'scripts', 'lib');
  const tests = fs.existsSync(libDir)
    ? fs
        .readdirSync(libDir)
        .filter((f) => f.endsWith('.test.mjs'))
        .map((f) => path.join('scripts', 'lib', f))
    : [];
  const problems = [];
  let exitCode = null;
  if (tests.length === 0) {
    problems.push('no scripts/lib/*.test.mjs found');
  } else {
    const r = run(process.execPath, ['--test', ...tests], { cwd: ROOT, timeout: UNIT_TIMEOUT_MS });
    exitCode = r.status;
    if (r.status !== 0) {
      problems.push(`node --test exit ${r.status}`);
      process.stdout.write(r.stdout.split('\n').slice(-60).join('\n') + '\n' + r.stderr);
    }
  }
  return {
    name: 'unit tests',
    ok: problems.length === 0,
    exitCode,
    outcome: problems.length ? 'fail' : 'pass',
    steps: {},
    durationMs: Date.now() - started,
    problems,
  };
}

const t0 = Date.now();
const results = [unitTests()];
// The cases test the check command, not the game: each copy keeps one browser test (boot) so the e2e
// step still runs for real, and leaves out the rest of the suite, which plays whole sessions and
// takes about 11 minutes. Ten full runs would not fit the job's 25 minutes.
const KEPT_BROWSER_TEST = 'tests/browser/boot.spec.ts';
const files = listRepoFiles().filter((f) => !f.startsWith('tests/browser/') || f === KEPT_BROWSER_TEST);
for (const c of CASES) {
  process.stdout.write(`running case: ${c.name} ...\n`);
  results.push(checkCase(c, files));
}
const totalMs = Date.now() - t0;
const ok = results.every((r) => r.ok);

const pad = (s, n) => String(s).padEnd(n);
console.log('\n' + pad('case', 22) + pad('result', 8) + pad('exit', 6) + pad('outcome', 9) + 'time');
for (const r of results) {
  console.log(
    pad(r.name, 22) +
      pad(r.ok ? 'ok' : 'MISMATCH', 8) +
      pad(r.exitCode ?? '-', 6) +
      pad(r.outcome ?? '-', 9) +
      `${(r.durationMs / 1000).toFixed(1)}s`,
  );
  for (const p of r.problems) console.log(`    - ${p}`);
}
console.log(`\ntotal ${(totalMs / 1000).toFixed(1)}s: ${ok ? 'all expectations met' : 'MISMATCH'}`);

fs.writeFileSync(
  OUT,
  JSON.stringify(
    {
      schemaVersion: 1,
      ok,
      totalMs,
      node: process.version,
      runner:
        process.env.FACTORY_RUNNER || (process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local'),
      results,
    },
    null,
    2,
  ) + '\n',
);
process.exit(ok ? 0 : 1);
