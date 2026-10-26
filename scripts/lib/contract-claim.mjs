// Pure parsing of the contract digest a candidate PR CLAIMS (ENG-140). No I/O
// here so it can be unit tested; scripts/check.mjs reads the PR title/body from
// the GitHub event payload and records the claim in its evidence.
//
// The claim is NOT trusted: CI only records it. The controller compares it with
// its own approval record via verify-evidence --expect-contract-digest.

// Factory PR title marker: `[<task> a<n> <digest12>] ...`
const TITLE_MARKER_RE = /^\[\S+ a\d+ ([0-9a-f]{12})\]/i;
const BODY_LINE_RE = /^Contract-Digest:\s*([0-9a-f]{64})\s*$/gim;
// Anything that looks like a Contract-Digest line, valid or not, so a malformed
// second line cannot hide next to a valid one.
const BODY_ANY_RE = /^\s*Contract-Digest\s*:/gim;

/**
 * @param {{ title?: unknown, body?: unknown }} pr
 * @returns {{ digest: string | null, reasons: string[] }}
 */
export function parseContractClaim({ title, body } = {}) {
  const reasons = [];
  const t = typeof title === 'string' ? title : '';
  const b = typeof body === 'string' ? body.replace(/\r\n?/g, '\n') : '';

  const marker = TITLE_MARKER_RE.exec(t);
  const markerDigest = marker ? marker[1].toLowerCase() : null;

  const valid = [...b.matchAll(BODY_LINE_RE)].map((m) => m[1].toLowerCase());
  const any = [...b.matchAll(BODY_ANY_RE)].length;

  let digest = null;
  if (any > 1) {
    reasons.push(`PR body has ${any} Contract-Digest lines; expected exactly one`);
  } else if (any === 1 && valid.length === 0) {
    reasons.push('PR body Contract-Digest line is malformed; expected "Contract-Digest: <64 hex chars>"');
  } else if (valid.length === 1) {
    digest = valid[0];
  }

  if (markerDigest !== null) {
    if (any === 0) {
      reasons.push(
        `PR title has factory marker (digest ${markerDigest}) but the body has no Contract-Digest line`,
      );
    } else if (digest !== null && !digest.startsWith(markerDigest)) {
      reasons.push(
        `PR body Contract-Digest ${digest} does not start with title marker digest ${markerDigest}`,
      );
    }
  }

  return { digest: reasons.length === 0 ? digest : null, reasons };
}
