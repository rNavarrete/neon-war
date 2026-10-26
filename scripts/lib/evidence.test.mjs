import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyEvidence } from './evidence.mjs';

const COMMIT = 'a'.repeat(40);
const OTHER_COMMIT = 'b'.repeat(40);
const REQUIRED = ['format', 'lint', 'typecheck', 'test', 'build', 'e2e'];

const trustedRevision = () => ({
  checkVersion: '1',
  checkScriptSha256: '1'.repeat(64),
  workflowSha256: '2'.repeat(64),
  configSha256: '3'.repeat(64),
});

function goodEvidence() {
  return {
    schemaVersion: 1,
    command: 'npm run check',
    startedAt: '2026-10-07T10:00:00.000Z',
    finishedAt: '2026-10-07T10:01:00.000Z',
    durationMs: 60000,
    candidate: { commit: COMMIT, treeClean: true, branch: 'main' },
    contractDigest: 'c'.repeat(64),
    checkRevision: trustedRevision(),
    environment: {
      node: 'v22.22.0',
      npm: '10.9.0',
      platform: 'linux',
      arch: 'x64',
      ci: true,
      runner: 'github-actions',
    },
    steps: REQUIRED.map((name) => ({
      name,
      command: name,
      status: 'pass',
      exitCode: 0,
      durationMs: 1000,
      timeoutMs: 60000,
      logTail: '',
    })),
    outcome: 'pass',
  };
}

function expectRejected(evidence, expectations, pattern) {
  const result = verifyEvidence(evidence, expectations);
  assert.equal(result.verified, false, 'expected evidence to be rejected');
  assert.ok(Array.isArray(result.reasons) && result.reasons.length > 0, 'expected reasons');
  if (pattern) {
    assert.ok(
      result.reasons.some((r) => pattern.test(r)),
      `expected a reason matching ${pattern}, got ${JSON.stringify(result.reasons)}`,
    );
  }
}

test('clean passing evidence on the expected commit is verified', () => {
  const result = verifyEvidence(goodEvidence(), { expectCommit: COMMIT });
  assert.equal(result.verified, true, JSON.stringify(result.reasons));
  assert.deepEqual(result.reasons, []);
});

test('matching trusted checkRevision is verified', () => {
  const result = verifyEvidence(goodEvidence(), {
    expectCommit: COMMIT,
    expectCheckRevision: trustedRevision(),
  });
  assert.equal(result.verified, true, JSON.stringify(result.reasons));
});

test('rejects missing or non-object evidence', () => {
  for (const bad of [null, undefined, 'x', 42, []]) {
    expectRejected(bad, { expectCommit: COMMIT });
  }
});

test('rejects wrong schemaVersion', () => {
  const e = goodEvidence();
  e.schemaVersion = 2;
  expectRejected(e, { expectCommit: COMMIT }, /schema/i);
  delete e.schemaVersion;
  expectRejected(e, { expectCommit: COMMIT }, /schema/i);
});

test('rejects outcome other than pass', () => {
  for (const outcome of ['fail', 'neutral', 'skipped', undefined]) {
    const e = goodEvidence();
    e.outcome = outcome;
    expectRejected(e, { expectCommit: COMMIT }, /outcome/i);
  }
});

test('rejects stale evidence from a different commit', () => {
  expectRejected(goodEvidence(), { expectCommit: OTHER_COMMIT }, /commit|stale/i);
});

test('rejects evidence with no candidate commit', () => {
  const e = goodEvidence();
  delete e.candidate.commit;
  expectRejected(e, { expectCommit: COMMIT });
});

test('rejects a dirty tree', () => {
  const e = goodEvidence();
  e.candidate.treeClean = false;
  expectRejected(e, { expectCommit: COMMIT }, /clean|dirty/i);
});

for (const name of REQUIRED) {
  test(`rejects when required step "${name}" is missing`, () => {
    const e = goodEvidence();
    e.steps = e.steps.filter((s) => s.name !== name);
    expectRejected(e, { expectCommit: COMMIT }, new RegExp(name));
  });

  test(`rejects when required step "${name}" failed`, () => {
    const e = goodEvidence();
    const step = e.steps.find((s) => s.name === name);
    step.status = 'fail';
    step.exitCode = 1;
    e.outcome = 'pass'; // even if a tampered outcome says pass
    expectRejected(e, { expectCommit: COMMIT }, new RegExp(name));
  });
}

for (const status of ['skipped', 'neutral', 'timeout', 'error', 'unknown', '', undefined]) {
  test(`rejects a required step with status ${JSON.stringify(status)}`, () => {
    const e = goodEvidence();
    e.steps.find((s) => s.name === 'test').status = status;
    expectRejected(e, { expectCommit: COMMIT }, /test/);
  });
}

test('rejects when steps is missing or empty', () => {
  const e = goodEvidence();
  e.steps = [];
  expectRejected(e, { expectCommit: COMMIT });
  delete e.steps;
  expectRejected(e, { expectCommit: COMMIT });
});

for (const field of ['checkVersion', 'checkScriptSha256', 'workflowSha256', 'configSha256']) {
  test(`rejects checkRevision mismatch on ${field}`, () => {
    const trusted = trustedRevision();
    trusted[field] = field === 'checkVersion' ? '999' : 'f'.repeat(64);
    expectRejected(
      goodEvidence(),
      { expectCommit: COMMIT, expectCheckRevision: trusted },
      /revision|checkRevision|sha|version/i,
    );
  });
}

test('rejects missing checkRevision when a trusted baseline is given', () => {
  const e = goodEvidence();
  delete e.checkRevision;
  expectRejected(e, { expectCommit: COMMIT, expectCheckRevision: trustedRevision() });
});

test('rejects flagged control change unless allowed', () => {
  const e = goodEvidence();
  e.controlChange = { flagged: true, reasons: ['scripts/check.mjs changed'] };
  expectRejected(e, { expectCommit: COMMIT }, /control/i);

  const allowed = verifyEvidence(e, { expectCommit: COMMIT, allowControlChange: true });
  assert.equal(allowed.verified, true, JSON.stringify(allowed.reasons));
});

test('unflagged control change field is fine', () => {
  const e = goodEvidence();
  e.controlChange = { flagged: false, reasons: [] };
  const result = verifyEvidence(e, { expectCommit: COMMIT });
  assert.equal(result.verified, true, JSON.stringify(result.reasons));
});

test('allowControlChange does not excuse other failures', () => {
  const e = goodEvidence();
  e.controlChange = { flagged: true, reasons: ['x'] };
  e.outcome = 'fail';
  expectRejected(e, { expectCommit: COMMIT, allowControlChange: true }, /outcome/i);
});

for (const field of ['checkVersion', 'checkScriptSha256', 'workflowSha256', 'configSha256']) {
  test(`rejects a trusted baseline missing ${field}`, () => {
    const trusted = trustedRevision();
    delete trusted[field];
    expectRejected(goodEvidence(), { expectCommit: COMMIT, expectCheckRevision: trusted });
  });
}

test('rejects an empty trusted baseline', () => {
  expectRejected(goodEvidence(), { expectCommit: COMMIT, expectCheckRevision: {} });
});

// Contract digest binding (--expect-contract-digest).
const DIGEST = 'c'.repeat(64);

test('matching contract digest is verified', () => {
  const result = verifyEvidence(goodEvidence(), { expectCommit: COMMIT, expectContractDigest: DIGEST });
  assert.equal(result.verified, true, JSON.stringify(result.reasons));
});

test('contract digest comparison is case-insensitive', () => {
  const e = goodEvidence();
  e.contractDigest = 'C'.repeat(64);
  const result = verifyEvidence(e, { expectCommit: COMMIT, expectContractDigest: DIGEST });
  assert.equal(result.verified, true, JSON.stringify(result.reasons));
  const result2 = verifyEvidence(goodEvidence(), {
    expectCommit: COMMIT,
    expectContractDigest: DIGEST.toUpperCase(),
  });
  assert.equal(result2.verified, true, JSON.stringify(result2.reasons));
});

test('rejects a mismatched contract digest', () => {
  expectRejected(goodEvidence(), { expectCommit: COMMIT, expectContractDigest: 'd'.repeat(64) }, /contract/i);
});

test('rejects a null or missing contract digest when one is expected', () => {
  const nullDigest = goodEvidence();
  nullDigest.contractDigest = null;
  expectRejected(nullDigest, { expectCommit: COMMIT, expectContractDigest: DIGEST }, /contract/i);
  const missing = goodEvidence();
  delete missing.contractDigest;
  expectRejected(missing, { expectCommit: COMMIT, expectContractDigest: DIGEST }, /contract/i);
});

test('without expectContractDigest a null contract digest still passes', () => {
  const e = goodEvidence();
  e.contractDigest = null;
  const result = verifyEvidence(e, { expectCommit: COMMIT });
  assert.equal(result.verified, true, JSON.stringify(result.reasons));
});

// Contract claim errors (PR declared a Contract-Digest that does not match its title marker, etc.).
test('rejects evidence with contract claim errors', () => {
  const e = goodEvidence();
  e.contractClaimErrors = ['Contract-Digest does not start with the title marker digest'];
  expectRejected(e, { expectCommit: COMMIT }, /contract|claim/i);
});

test('contract claim errors are not excused by allowControlChange or a matching digest', () => {
  const e = goodEvidence();
  e.contractClaimErrors = ['two Contract-Digest lines'];
  expectRejected(e, { expectCommit: COMMIT, allowControlChange: true, expectContractDigest: DIGEST });
});

test('an empty or missing contractClaimErrors is fine', () => {
  const empty = goodEvidence();
  empty.contractClaimErrors = [];
  const r1 = verifyEvidence(empty, { expectCommit: COMMIT });
  assert.equal(r1.verified, true, JSON.stringify(r1.reasons));
  const missing = goodEvidence();
  delete missing.contractClaimErrors;
  const r2 = verifyEvidence(missing, { expectCommit: COMMIT });
  assert.equal(r2.verified, true, JSON.stringify(r2.reasons));
});
