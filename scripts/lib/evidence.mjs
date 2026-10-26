// Pure verification of check evidence (ENG-140, G-B2). No I/O here so it can be
// unit tested; scripts/verify-evidence.mjs is the CLI wrapper.

export const SCHEMA_VERSION = 1;
export const REQUIRED_STEPS = ['format', 'lint', 'typecheck', 'test', 'build', 'e2e'];
export const CHECK_REVISION_KEYS = ['checkVersion', 'checkScriptSha256', 'workflowSha256', 'configSha256'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * @param {unknown} evidence parsed evidence JSON
 * @param {{ expectCommit: string, expectCheckRevision?: object, expectContractDigest?: string, allowControlChange?: boolean }} expectations
 * @returns {{ verified: boolean, reasons: string[] }}
 */
export function verifyEvidence(evidence, expectations = {}) {
  const reasons = [];
  const {
    expectCommit,
    expectCheckRevision,
    expectContractDigest,
    allowControlChange = false,
  } = expectations ?? {};

  if (!isObject(evidence)) {
    return { verified: false, reasons: ['evidence is not a JSON object'] };
  }

  if (evidence.schemaVersion !== SCHEMA_VERSION) {
    reasons.push(`schemaVersion is ${JSON.stringify(evidence.schemaVersion)}, expected ${SCHEMA_VERSION}`);
  }

  if (evidence.outcome !== 'pass') {
    reasons.push(`outcome is ${JSON.stringify(evidence.outcome)}, expected "pass"`);
  }

  const steps = Array.isArray(evidence.steps) ? evidence.steps : null;
  if (!steps) reasons.push('steps is missing or not an array');
  for (const name of REQUIRED_STEPS) {
    const matches = (steps ?? []).filter((s) => isObject(s) && s.name === name);
    if (matches.length === 0) {
      reasons.push(`required step "${name}" is missing`);
    } else if (matches.length > 1) {
      reasons.push(`required step "${name}" appears ${matches.length} times`);
    } else if (matches[0].status !== 'pass') {
      reasons.push(`required step "${name}" status is ${JSON.stringify(matches[0].status)}, expected "pass"`);
    }
  }

  const cand = isObject(evidence.candidate) ? evidence.candidate : null;
  if (!cand) {
    reasons.push('candidate is missing');
  } else {
    if (typeof expectCommit !== 'string' || expectCommit.trim() === '') {
      reasons.push('no expected commit given; evidence cannot be tied to a candidate');
    } else if (typeof cand.commit !== 'string' || cand.commit === '') {
      reasons.push('candidate.commit is missing');
    } else if (cand.commit.toLowerCase() !== expectCommit.trim().toLowerCase()) {
      reasons.push(`stale evidence: candidate.commit ${cand.commit} does not match expected ${expectCommit}`);
    }
    if (cand.treeClean !== true) {
      reasons.push('candidate.treeClean is not true (evidence came from a dirty working tree)');
    }
  }

  if (expectCheckRevision !== undefined && expectCheckRevision !== null) {
    const actual = isObject(evidence.checkRevision) ? evidence.checkRevision : null;
    if (!isObject(expectCheckRevision)) {
      reasons.push('trusted checkRevision baseline is not an object');
    } else if (!actual) {
      reasons.push('checkRevision is missing');
    } else {
      // Every revision key must be present in BOTH the baseline and the evidence,
      // and equal. A baseline missing a key cannot vouch for it.
      for (const key of CHECK_REVISION_KEYS) {
        if (!(key in expectCheckRevision) || expectCheckRevision[key] == null) {
          reasons.push(`trusted checkRevision baseline is missing ${key}`);
        } else if (!(key in actual) || actual[key] == null) {
          reasons.push(`checkRevision.${key} is missing`);
        } else if (actual[key] !== expectCheckRevision[key]) {
          reasons.push(
            `checkRevision.${key} is ${JSON.stringify(actual[key])}, trusted baseline is ${JSON.stringify(expectCheckRevision[key])}`,
          );
        }
      }
    }
  }

  // A malformed or inconsistent PR contract claim (recorded by check.mjs
  // --contract-claim-from-event) is always a rejection, with or without a trusted digest.
  if ('contractClaimErrors' in evidence && evidence.contractClaimErrors !== undefined) {
    const errs = evidence.contractClaimErrors;
    if (!Array.isArray(errs)) {
      reasons.push('contractClaimErrors is not an array');
    } else if (errs.length > 0) {
      reasons.push(`contract claim errors: ${errs.map(String).join('; ')}`);
    }
  }

  // Contract binding: only when the caller supplies a trusted digest (from the
  // controller's approval record, never from the candidate). Without it, unchanged.
  if (expectContractDigest !== undefined && expectContractDigest !== null) {
    const want = typeof expectContractDigest === 'string' ? expectContractDigest.trim().toLowerCase() : '';
    const got = evidence.contractDigest;
    if (want === '') {
      reasons.push('expected contract digest is empty or not a string');
    } else if (typeof got !== 'string' || got.trim() === '') {
      reasons.push(
        `contractDigest is ${got === undefined ? 'missing' : JSON.stringify(got)}, expected ${want}`,
      );
    } else if (got.trim().toLowerCase() !== want) {
      reasons.push(`contractDigest ${got} does not match expected ${want}`);
    }
  }

  if (isObject(evidence.controlChange) && evidence.controlChange.flagged === true && !allowControlChange) {
    const why = Array.isArray(evidence.controlChange.reasons)
      ? `: ${evidence.controlChange.reasons.join('; ')}`
      : '';
    reasons.push(`control change flagged; needs explicit review (--allow-control-change)${why}`);
  }

  return { verified: reasons.length === 0, reasons };
}
