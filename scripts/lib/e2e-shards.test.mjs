import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SHARDS,
  mergeShardEvidence,
  parseShardSpec,
  shardCommand,
  shardFileName,
} from './e2e-shards.mjs';

const COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);

const revision = () => ({
  checkVersion: '1',
  checkScriptSha256: '1'.repeat(64),
  workflowSha256: '2'.repeat(64),
  configSha256: '3'.repeat(64),
});
const expected = () => ({ commit: COMMIT, checkRevision: revision() });

function shard(index, total, over = {}) {
  return {
    kind: 'e2e-shard',
    schemaVersion: 1,
    command: `npm run check -- --e2e-shard ${index}/${total}`,
    shard: { index, total },
    candidate: { commit: COMMIT, treeClean: true, branch: 'main' },
    checkRevision: revision(),
    steps: [
      { name: 'environment', command: 'node --version', status: 'pass', exitCode: 0, durationMs: 1 },
      {
        name: 'e2e',
        command: shardCommand(index, total),
        status: 'pass',
        exitCode: 0,
        durationMs: 1000 * index,
        logTail: `tail ${index}`,
      },
    ],
    outcome: 'pass',
    e2eLog: `log of shard ${index}\n`,
    ...over,
  };
}

const file = (ev, index = ev.shard.index) => ({
  file: `e2e-shard-${index}-${COMMIT}/${shardFileName(index)}`,
  text: JSON.stringify(ev),
});
const fullSet = (total = 4) => Array.from({ length: total }, (_, i) => file(shard(i + 1, total)));

function expectRejected(files, pattern) {
  const r = mergeShardEvidence(files, expected());
  assert.equal(r.ok, false, 'expected the shard set to be rejected');
  assert.ok(
    r.reasons.some((x) => pattern.test(x)),
    `expected a reason matching ${pattern}, got ${JSON.stringify(r.reasons)}`,
  );
  return r;
}

test('parseShardSpec accepts i/n with 1 <= i <= n <= 8', () => {
  assert.deepEqual(parseShardSpec('2/4'), { ok: true, index: 2, total: 4 });
  assert.deepEqual(parseShardSpec('1/1'), { ok: true, index: 1, total: 1 });
  assert.deepEqual(parseShardSpec('8/8'), { ok: true, index: 8, total: 8 });
  assert.equal(MAX_SHARDS, 8);
});

test('parseShardSpec rejects anything else', () => {
  for (const bad of [
    undefined,
    null,
    4,
    '',
    '2',
    '/4',
    '2/',
    '0/4',
    '5/4',
    '1/9',
    '9/9',
    '02/4',
    '2/04',
    '-1/4',
    '+1/4',
    '1.0/4',
    '1/4.5',
    ' 1/4',
    '1/4 ',
    '1 /4',
    '1/4/4',
    '1e0/4',
    '0x1/4',
    '١/4',
    '1/4\n',
  ]) {
    const r = parseShardSpec(bad);
    assert.equal(r.ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
    assert.ok(r.error);
  }
});

test('a complete passing set merges to pass, max duration, logs in order', () => {
  const files = fullSet().reverse();
  const r = mergeShardEvidence(files, expected());
  assert.equal(r.ok, true, JSON.stringify(r.reasons));
  assert.equal(r.total, 4);
  assert.deepEqual(r.reasons, []);
  assert.equal(r.durationMs, 4000);
  assert.deepEqual(
    r.shards.map((s) => [s.index, s.status, s.log]),
    [1, 2, 3, 4].map((i) => [i, 'pass', `log of shard ${i}\n`]),
  );
});

test('rejects an empty set', () => {
  expectRejected([], /no shard evidence/);
});

test('rejects a missing shard', () => {
  const files = fullSet().filter((_, i) => i !== 2);
  expectRejected(files, /shard 3\/4 is missing/);
});

test('rejects a duplicate shard', () => {
  const files = fullSet();
  files.push({ ...file(shard(2, 4)), file: `other/${shardFileName(2)}` });
  expectRejected(files, /shard 2\/4 appears 2 times/);
});

test('rejects shards that disagree on the total', () => {
  const files = fullSet(2);
  files.push(file(shard(3, 3)));
  expectRejected(files, /total 3 differs from 2/);
});

test('rejects a shard for another commit', () => {
  const files = fullSet();
  files[1] = file(shard(2, 4, { candidate: { commit: OTHER_COMMIT, treeClean: true } }));
  expectRejected(files, /commit .* differs/);
});

test('rejects when this run has no commit', () => {
  const r = mergeShardEvidence(fullSet(), { commit: null, checkRevision: revision() });
  assert.equal(r.ok, false);
});

for (const key of ['configSha256', 'checkScriptSha256', 'workflowSha256', 'checkVersion']) {
  test(`rejects a shard with a different checkRevision.${key}`, () => {
    const files = fullSet();
    files[0] = file(shard(1, 4, { checkRevision: { ...revision(), [key]: 'f'.repeat(64) } }));
    expectRejected(files, new RegExp(`checkRevision\\.${key}`));
  });

  test(`rejects a shard missing checkRevision.${key}`, () => {
    const rev = revision();
    delete rev[key];
    const files = fullSet();
    files[0] = file(shard(1, 4, { checkRevision: rev }));
    expectRejected(files, new RegExp(`checkRevision\\.${key}`));
  });
}

test('rejects a shard from a dirty tree', () => {
  const files = fullSet();
  files[3] = file(shard(4, 4, { candidate: { commit: COMMIT, treeClean: false } }));
  expectRejected(files, /not clean/);
});

test('rejects when one shard failed', () => {
  for (const status of ['fail', 'timeout', 'error', 'skipped', undefined]) {
    const ev = shard(3, 4, { outcome: 'fail' });
    ev.steps[1].status = status;
    const files = fullSet();
    files[2] = file(ev);
    const r = expectRejected(files, /shard 3\/4: e2e status/);
    assert.equal(r.shards.length, 4, 'the failed shard is still listed for the log');
  }
});

test('rejects a shard whose outcome is not pass', () => {
  const files = fullSet();
  files[0] = file(shard(1, 4, { outcome: 'fail' }));
  expectRejected(files, /outcome/);
});

test('rejects a shard whose environment step failed or is missing', () => {
  const ev = shard(1, 4);
  ev.steps[0].status = 'fail';
  expectRejected([file(ev), ...fullSet().slice(1)], /environment/);
  const ev2 = shard(1, 4);
  ev2.steps = ev2.steps.slice(1);
  expectRejected([file(ev2), ...fullSet().slice(1)], /environment/);
});

test('rejects a shard with no e2e step, two e2e steps, or another command', () => {
  const none = shard(1, 4);
  none.steps = none.steps.slice(0, 1);
  expectRejected([file(none), ...fullSet().slice(1)], /e2e steps, expected 1/);
  const two = shard(1, 4);
  two.steps.push({ ...two.steps[1] });
  expectRejected([file(two), ...fullSet().slice(1)], /e2e steps, expected 1/);
  const other = shard(1, 4);
  other.steps[1].command = 'playwright test --shard=1/4 --grep boot';
  expectRejected([file(other), ...fullSet().slice(1)], /e2e command/);
});

test('rejects unparsable, unreadable or non-object files', () => {
  const base = fullSet().slice(1);
  expectRejected([{ file: shardFileName(1), text: '{not json' }, ...base], /not valid JSON/);
  expectRejected([{ file: shardFileName(1), readError: 'EACCES' }, ...base], /cannot read/);
  expectRejected([{ file: shardFileName(1), text: '[]' }, ...base], /not a JSON object/);
});

test('rejects the wrong kind or schema', () => {
  const base = fullSet().slice(1);
  expectRejected([file(shard(1, 4, { kind: 'check' })), ...base], /kind/);
  expectRejected([file(shard(1, 4, { schemaVersion: 2 })), ...base], /schemaVersion/);
});

test('rejects an invalid shard field', () => {
  const base = fullSet().slice(1);
  for (const bad of [undefined, { index: 0, total: 4 }, { index: '1', total: 4 }, { index: 1, total: 9 }]) {
    expectRejected([file(shard(1, 4, { shard: bad }), 1), ...base], /invalid shard|missing/);
  }
});

test('rejects a file whose name and content disagree on the index', () => {
  const files = fullSet();
  files[0] = { file: shardFileName(5), text: JSON.stringify(shard(1, 4)) };
  expectRejected(files, /file name says shard 5/);
});

test('rejects a file that is not named like shard evidence', () => {
  const files = fullSet();
  files.push({ file: 'check-evidence.json', text: '{}' });
  expectRejected(files, /not a shard evidence file name/);
});

test('does not mutate its input', () => {
  const files = fullSet();
  const copy = JSON.parse(JSON.stringify(files));
  mergeShardEvidence(files, expected());
  assert.deepEqual(files, copy);
});
