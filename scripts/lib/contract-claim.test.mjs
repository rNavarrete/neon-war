import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContractClaim } from './contract-claim.mjs';

const DIGEST = '0123456789abcdef'.repeat(4);
const PREFIX = DIGEST.slice(0, 12);
const OTHER_PREFIX = 'fedcba987654';

function expectOk(input, digest) {
  const r = parseContractClaim(input);
  assert.deepEqual(r.reasons, [], JSON.stringify(r.reasons));
  assert.equal(r.digest, digest);
}

function expectErrors(input) {
  const r = parseContractClaim(input);
  assert.ok(Array.isArray(r.reasons) && r.reasons.length > 0, `expected reasons, got ${JSON.stringify(r)}`);
  return r;
}

test('a Contract-Digest line in the body is read', () => {
  expectOk({ title: 'Fix x', body: `Some text\n\nContract-Digest: ${DIGEST}\n` }, DIGEST);
});

test('an uppercase digest is lowercased', () => {
  expectOk({ title: 'Fix x', body: `Contract-Digest: ${DIGEST.toUpperCase()}` }, DIGEST);
});

test('CRLF line endings are handled', () => {
  expectOk({ title: 'Fix x', body: `What changed\r\nContract-Digest: ${DIGEST}\r\nmore\r\n` }, DIGEST);
});

test('no marker and no Contract-Digest line is no claim, not an error', () => {
  const r = parseContractClaim({ title: 'Fix x', body: 'Just a description.' });
  assert.equal(r.digest, null);
  assert.deepEqual(r.reasons, []);
});

test('title marker with a body digest that starts with its 12 hex is ok', () => {
  expectOk({ title: `[ENG-12 a1 ${PREFIX}] Fix x`, body: `Contract-Digest: ${DIGEST}` }, DIGEST);
});

test('title marker with a body digest that does not start with its 12 hex is an error', () => {
  const r = expectErrors({ title: `[ENG-12 a1 ${OTHER_PREFIX}] Fix x`, body: `Contract-Digest: ${DIGEST}` });
  assert.ok(
    r.reasons.some((x) => /match|prefix|title|marker/i.test(x)),
    JSON.stringify(r.reasons),
  );
});

test('title marker without a body digest is an error', () => {
  const r = expectErrors({ title: `[ENG-12 a1 ${PREFIX}] Fix x`, body: 'No digest here.' });
  assert.ok(
    r.reasons.some((x) => /digest|missing|contract/i.test(x)),
    JSON.stringify(r.reasons),
  );
});

test('title marker with a null body is an error, not a throw', () => {
  expectErrors({ title: `[ENG-12 a1 ${PREFIX}] Fix x`, body: null });
});

test('two Contract-Digest lines are an error', () => {
  expectErrors({ title: 'Fix x', body: `Contract-Digest: ${DIGEST}\nContract-Digest: ${'1'.repeat(64)}` });
});

test('two identical Contract-Digest lines are still an error', () => {
  expectErrors({ title: 'Fix x', body: `Contract-Digest: ${DIGEST}\nContract-Digest: ${DIGEST}` });
});

test('a malformed digest (63 hex) is never accepted as the digest', () => {
  const bad = DIGEST.slice(0, 63);
  const r = parseContractClaim({ title: 'Fix x', body: `Contract-Digest: ${bad}` });
  assert.notEqual(r.digest, bad);
  assert.ok(r.digest === null || /^[0-9a-f]{64}$/.test(r.digest), JSON.stringify(r));
  // With a title marker a malformed digest must not count as a valid claim.
  const withMarker = parseContractClaim({
    title: `[ENG-12 a1 ${PREFIX}] Fix x`,
    body: `Contract-Digest: ${bad}`,
  });
  assert.notEqual(withMarker.digest, bad);
  assert.ok(withMarker.reasons.length > 0, JSON.stringify(withMarker));
});

test('a 65 hex digest is never accepted as a 64 hex prefix of it', () => {
  const r = parseContractClaim({ title: 'Fix x', body: `Contract-Digest: ${DIGEST}a` });
  assert.notEqual(r.digest, `${DIGEST}a`);
  assert.notEqual(r.digest, DIGEST);
});

test('null, undefined and missing inputs do not throw', () => {
  for (const input of [
    { title: null, body: null },
    { title: undefined, body: undefined },
    {},
    { title: 'Fix x' },
    { body: `Contract-Digest: ${DIGEST}` },
  ]) {
    const r = parseContractClaim(input);
    assert.ok(Array.isArray(r.reasons), JSON.stringify(input));
    assert.ok(r.digest === null || typeof r.digest === 'string');
  }
  expectOk({ title: null, body: `Contract-Digest: ${DIGEST}` }, DIGEST);
  const empty = parseContractClaim({ title: undefined, body: undefined });
  assert.equal(empty.digest, null);
  assert.deepEqual(empty.reasons, []);
});
