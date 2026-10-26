import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiff } from './control-change.mjs';

function assertFlagged(files, pattern) {
  const result = classifyDiff(files);
  assert.equal(result.flagged, true, `expected flagged for ${JSON.stringify(files)}`);
  assert.ok(Array.isArray(result.reasons) && result.reasons.length > 0, 'expected reasons');
  if (pattern) {
    assert.ok(
      result.reasons.some((r) => pattern.test(r)),
      `expected a reason matching ${pattern}, got ${JSON.stringify(result.reasons)}`,
    );
  }
}

function assertNotFlagged(files) {
  const result = classifyDiff(files);
  assert.equal(result.flagged, false, JSON.stringify(result.reasons));
}

test('empty diff is not flagged', () => {
  assertNotFlagged([]);
});

test('plain src change is not flagged', () => {
  assertNotFlagged([
    { path: 'src/books.ts', status: 'modified', patch: '@@\n-const a = 1;\n+const a = 2;\n' },
    { path: 'src/new.ts', status: 'added', patch: '@@\n+export const x = 1;\n' },
    { path: 'src/style.css', status: 'modified', patch: '@@\n-a{}\n+b{}\n' },
  ]);
});

test('workflow edit is flagged', () => {
  assertFlagged(
    [{ path: '.github/workflows/ci.yml', status: 'modified', patch: '@@\n-a\n+b\n' }],
    /\.github/,
  );
});

test('release workflow edit is flagged too', () => {
  assertFlagged([{ path: '.github/workflows/release.yml', status: 'modified' }]);
});

test('CODEOWNERS edits are flagged', () => {
  assertFlagged([{ path: '.github/CODEOWNERS', status: 'modified' }]);
  assertFlagged([{ path: 'CODEOWNERS', status: 'added' }]);
});

test('script edit is flagged', () => {
  assertFlagged([{ path: 'scripts/check.mjs', status: 'modified' }], /scripts/);
  assertFlagged([{ path: 'scripts/lib/evidence.mjs', status: 'removed' }]);
});

for (const path of [
  'package.json',
  'package-lock.json',
  'eslint.config.js',
  '.prettierrc.json',
  '.prettierignore',
  'tsconfig.json',
  'vite.config.ts',
  '.nvmrc',
]) {
  test(`config file ${path} is flagged`, () => {
    assertFlagged([{ path, status: 'modified' }]);
  });
}

test('protected match is exact, not a substring', () => {
  assertNotFlagged([
    { path: 'src/package.json.ts', status: 'added', patch: '@@\n+export {};\n' },
    { path: 'src/scripts/helper.ts', status: 'added', patch: '@@\n+export {};\n' },
  ]);
});

test('renamed protected file is flagged', () => {
  assertFlagged([{ path: 'scripts/check.mjs', status: 'renamed' }]);
});

test('deleted test file is flagged', () => {
  assertFlagged([{ path: 'tests/books.test.ts', status: 'removed' }], /test/i);
});

test('removed assertion in a test file is flagged', () => {
  assertFlagged([
    {
      path: 'tests/books.test.ts',
      status: 'modified',
      patch: "@@ -1,3 +1,2 @@\n   it('x', () => {\n-    expect(a).toBe(1);\n     expect(b).toBe(2);\n",
    },
  ]);
});

test('removed it() in a test file is flagged', () => {
  assertFlagged([
    {
      path: 'tests/books.test.ts',
      status: 'modified',
      patch: "@@\n-  it('drops', () => {\n-    foo();\n-  });\n",
    },
  ]);
});

test('test files outside tests/ are covered too', () => {
  assertFlagged([{ path: 'src/books.test.ts', status: 'removed' }]);
});

for (const added of [
  "it.skip('x', () => {});",
  "describe.only('x', () => {});",
  "it.todo('x');",
  "it.fails('x', () => {});",
  "test.skip('x', () => {});",
]) {
  test(`adding ${added.split('(')[0]} in a test file is flagged`, () => {
    assertFlagged([{ path: 'tests/books.test.ts', status: 'modified', patch: `@@\n+  ${added}\n` }]);
  });
}

test('adding a new assertion to an existing test file is flagged (existing tests always need review)', () => {
  assertFlagged(
    [
      {
        path: 'tests/books.test.ts',
        status: 'modified',
        patch: "@@\n   it('x', () => {\n+    expect(c).toBe(3);\n   });\n",
      },
    ],
    /books\.test\.ts/,
  );
});

test('rewriting an assertion one-for-one is flagged (any edit of an existing test line counts)', () => {
  assertFlagged([
    {
      path: 'tests/books.test.ts',
      status: 'modified',
      patch: '@@\n-    expect(a).toBe(1);\n+    expect(a).toEqual(1);\n',
    },
  ]);
});

test('adding a new test file is not flagged', () => {
  assertNotFlagged([
    {
      path: 'tests/new.test.ts',
      status: 'added',
      patch: "@@\n+it('works', () => {\n+  expect(1).toBe(1);\n+});\n",
    },
  ]);
});

test('one protected file among many flags the whole diff', () => {
  assertFlagged([
    { path: 'src/books.ts', status: 'modified', patch: '@@\n+x\n' },
    { path: 'vite.config.ts', status: 'modified', patch: '@@\n+x\n' },
  ]);
});

// Deny-by-default: anything outside the content allowlist is flagged.
for (const path of [
  'CLAUDE.md',
  '.npmrc',
  '.gitignore',
  'vitest.config.ts',
  'some-new-file.txt',
  'public/favicon.svg',
  'config/anything.json',
]) {
  test(`path outside the content allowlist (${path}) is flagged`, () => {
    assertFlagged([{ path, status: 'added', patch: '@@\n+x\n' }]);
  });
}

// Config-looking basenames are flagged even inside allowlisted folders.
for (const path of [
  'src/.prettierrc',
  'tests/.npmrc',
  'docs/.eslintrc.json',
  'docs/CODEOWNERS',
  'src/package.json',
  'tests/tsconfig.json',
  'tests/tsconfig.build.json',
  'tests/vitest.config.ts',
  'src/postcss.config.js',
  'tests/vitest.workspace.ts',
]) {
  test(`config-looking file inside the allowlist (${path}) is flagged`, () => {
    assertFlagged([{ path, status: 'added', patch: '@@\n+x\n' }]);
  });
}

test('plain edits to content files are not flagged', () => {
  assertNotFlagged([
    { path: 'docs/checks.md', status: 'modified', patch: '@@\n-old\n+new\n' },
    { path: 'README.md', status: 'modified', patch: '@@\n-old\n+new\n' },
    { path: 'index.html', status: 'modified', patch: '@@\n-<p>a</p>\n+<p>b</p>\n' },
    { path: 'tests/helpers.ts', status: 'added', patch: '@@\n+export const h = 1;\n' },
  ]);
});

for (const added of [
  "it.skipIf(true)('x', () => {});",
  "it.runIf(false)('x', () => {});",
  "describe.skipIf(true)('x', () => {});",
  "it.concurrent.skip('x', () => {});",
  "it.concurrent.only('x', () => {});",
]) {
  test(`adding ${added.split("('")[0].split('(')[0]} in a test file is flagged`, () => {
    assertFlagged([{ path: 'tests/books.test.ts', status: 'modified', patch: `@@\n+  ${added}\n` }]);
  });
}

for (const removed of ['expect.soft(a).toBe(1);', 'assert(a === 1);']) {
  test(`removing ${removed.split('(')[0]}( in a test file is flagged`, () => {
    assertFlagged([
      {
        path: 'tests/books.test.ts',
        status: 'modified',
        patch: `@@\n   it('x', () => {\n-    ${removed}\n   });\n`,
      },
    ]);
  });
}

for (const directive of [
  '// @ts-nocheck',
  '// @ts-ignore',
  '// @ts-expect-error',
  '/* eslint-disable */',
  '// eslint-disable-next-line',
]) {
  for (const path of ['src/books.ts', 'tests/books.test.ts']) {
    test(`adding "${directive}" in ${path} is flagged`, () => {
      assertFlagged([{ path, status: 'modified', patch: `@@\n+${directive}\n const a = 1;\n` }]);
    });
  }
}

test('removing a suppression directive is not flagged', () => {
  assertNotFlagged([
    { path: 'src/books.ts', status: 'modified', patch: '@@\n-// @ts-ignore\n const a = 1;\n' },
  ]);
});

// Renames and placement of test files.
test('renaming a test file from tests/ into src/ is flagged', () => {
  assertFlagged(
    [{ path: 'src/books.test.ts', oldPath: 'tests/books.test.ts', status: 'renamed' }],
    /test|rename|move/i,
  );
});

test('renaming a test file from src/ into tests/ is flagged', () => {
  assertFlagged(
    [{ path: 'tests/x.test.ts', oldPath: 'src/x.test.ts', status: 'renamed' }],
    /test|rename|move/i,
  );
});

test('adding a test file outside tests/**/*.test.ts is flagged (it would not run in the suite)', () => {
  assertFlagged(
    [
      {
        path: 'src/new.test.ts',
        status: 'added',
        patch: "@@\n+it('works', () => {\n+  expect(1).toBe(1);\n+});\n",
      },
    ],
    /test|suite|outside/i,
  );
});

test('adding a nested test file under tests/ is not flagged', () => {
  assertNotFlagged([
    {
      path: 'tests/sub/new.test.ts',
      status: 'added',
      patch: "@@\n+it('works', () => {\n+  expect(1).toBe(1);\n+});\n",
    },
  ]);
});

// Any edit or removal of an existing test line is flagged.
test('replacing a real assertion with a trivially true one is flagged', () => {
  assertFlagged(
    [
      {
        path: 'tests/books.test.ts',
        status: 'modified',
        patch:
          "@@ -1,3 +1,3 @@\n it('adds', () => {\n-  expect(add(1, 2)).toBe(3);\n+  expect(true).toBe(true);\n });\n",
      },
    ],
    /tests\/books\.test\.ts/,
  );
});

test('changing a non-assertion line in a test file is flagged', () => {
  assertFlagged([
    {
      path: 'tests/books.test.ts',
      status: 'modified',
      patch: '@@\n-  const input = [1, 2, 3];\n+  const input = [];\n',
    },
  ]);
});

// Any change to an existing test-like file is flagged, even a pure addition:
// an added early return can disable every assertion after it.
test('only adding lines to tests/books.test.ts is flagged', () => {
  assertFlagged(
    [
      {
        path: 'tests/books.test.ts',
        status: 'modified',
        patch:
          "@@ -10,3 +10,8 @@\n });\n+\n+it('new case', () => {\n+  const x = 1;\n+  expect(x).toBe(1);\n+});\n",
      },
    ],
    /books\.test\.ts/,
  );
});

test('adding only an early return inside an existing test is flagged', () => {
  assertFlagged(
    [
      {
        path: 'tests/books.test.ts',
        status: 'modified',
        patch:
          "@@ -1,3 +1,4 @@\n it('adds', () => {\n+    if (Date.now() > 0) return;\n   expect(add(1, 2)).toBe(3);\n });\n",
      },
    ],
    /books\.test\.ts/,
  );
});

test('removing only a blank line from a test file is flagged', () => {
  assertFlagged(
    [
      {
        path: 'tests/books.test.ts',
        status: 'modified',
        patch: "@@ -1,4 +1,3 @@\n it('a', () => {});\n-\n it('b', () => {});\n",
      },
    ],
    /books\.test\.ts/,
  );
});

test('a modified test file with no patch is still flagged', () => {
  assertFlagged([{ path: 'tests/books.test.ts', status: 'modified' }], /books\.test\.ts/);
});

for (const status of ['modified', 'M', 'changed']) {
  test(`existing test file with status ${status} is flagged`, () => {
    assertFlagged([{ path: 'tests/books.test.ts', status, patch: '@@\n+// note\n' }]);
  });
}

test('renaming a test file within tests/ is flagged', () => {
  assertFlagged(
    [{ path: 'tests/renamed.test.ts', oldPath: 'tests/books.test.ts', status: 'renamed', patch: '' }],
    /test|rename|move/i,
  );
});

test('deleting a nested test file is flagged', () => {
  assertFlagged([{ path: 'tests/sub/x.test.ts', status: 'removed' }]);
  assertFlagged([{ path: 'tests/sub/x.test.ts', status: 'D' }]);
});

test('a brand-new test file that adds a suppression is flagged', () => {
  assertFlagged([
    {
      path: 'tests/new.test.ts',
      status: 'added',
      patch: "@@\n+// @ts-nocheck\n+it('works', () => {\n+  expect(1).toBe(1);\n+});\n",
    },
  ]);
});

test('a brand-new test file that adds skip or only is flagged', () => {
  assertFlagged([{ path: 'tests/new.test.ts', status: 'added', patch: "@@\n+it.skip('x', () => {});\n" }]);
  assertFlagged([
    { path: 'tests/new.test.ts', status: 'added', patch: "@@\n+describe.only('x', () => {});\n" },
  ]);
});

test('a brand-new test file next to a plain src change is not flagged', () => {
  assertNotFlagged([
    { path: 'src/books.ts', status: 'modified', patch: '@@\n-const a = 1;\n+const a = 2;\n' },
    {
      path: 'tests/books-extra.test.ts',
      status: 'added',
      patch: "@@\n+it('works', () => {\n+  expect(1).toBe(1);\n+});\n",
    },
  ]);
});

test('a new browser spec under tests/browser is in the suite and not flagged', () => {
  assertNotFlagged([
    {
      path: 'tests/browser/cache.spec.ts',
      status: 'added',
      patch: "@@\n+test('x', async () => { expect(1).toBe(1); });\n",
    },
  ]);
});

test('a spec file outside tests/browser is flagged as outside the suite', () => {
  assertFlagged(
    [{ path: 'tests/cache.spec.ts', status: 'added', patch: "@@\n+test('x', () => {});\n" }],
    /outside the suite/,
  );
});

test('changing an existing browser spec is flagged', () => {
  assertFlagged(
    [{ path: 'tests/browser/boot.spec.ts', status: 'modified', patch: '@@\n+  // note\n' }],
    /existing test file changed/,
  );
});

test('playwright config and picked art are protected', () => {
  assertFlagged([{ path: 'playwright.config.ts', status: 'modified', patch: '@@\n+x\n' }], /protected/);
  assertFlagged([{ path: 'public/art/db-hot.png', status: 'modified' }], /protected/);
});
