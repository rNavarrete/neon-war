// Pure logic for running the e2e step as parallel shards (CI speed-up). No I/O
// here so it can be unit tested; scripts/check.mjs does the file handling.
//
// Each CI shard job runs `check.mjs --e2e-shard i/n`, which runs only the
// environment step and `playwright test --shard=i/n`, and writes a shard
// evidence file. The `check` job then runs every other step itself and records
// the e2e step from the shard files (`--e2e-from-shards <dir>`). That e2e step
// passes only when mergeShardEvidence() accepts the whole set: complete (1..n,
// each exactly once, same n), same commit and check revision as the check run,
// clean tree, and every shard's environment and e2e steps passed.

export const SHARD_KIND = 'e2e-shard';
export const SHARD_SCHEMA_VERSION = 1;
export const MAX_SHARDS = 8;
// The only file names the merge looks for, at any depth under the shard dir.
export const SHARD_FILE_RE = /^check-evidence-e2e-shard-([1-9][0-9]*)\.json$/;
const REVISION_KEYS = ['checkVersion', 'checkScriptSha256', 'workflowSha256', 'configSha256'];

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function shardFileName(index) {
  return `check-evidence-e2e-shard-${index}.json`;
}

/** The exact e2e command a shard runs. */
export function shardCommand(index, total) {
  return `playwright test --shard=${index}/${total}`;
}

/**
 * Strictly parse "i/n": plain decimal integers, no signs, spaces or leading zeros, 1 <= i <= n <= MAX_SHARDS.
 * @param {unknown} spec
 * @returns {{ ok: true, index: number, total: number } | { ok: false, error: string }}
 */
export function parseShardSpec(spec) {
  if (typeof spec !== 'string') return { ok: false, error: 'shard spec must be a string like 2/4' };
  const m = /^([1-9][0-9]*)\/([1-9][0-9]*)$/.exec(spec);
  if (!m) return { ok: false, error: `invalid shard spec ${JSON.stringify(spec)}; expected i/n, e.g. 2/4` };
  const index = Number(m[1]);
  const total = Number(m[2]);
  if (total > MAX_SHARDS) return { ok: false, error: `shard total ${total} is above ${MAX_SHARDS}` };
  if (index > total) return { ok: false, error: `shard index ${index} is above shard total ${total}` };
  return { ok: true, index, total };
}

/**
 * Validate a set of shard evidence files and merge them into one e2e result.
 *
 * @param {{ file: string, text?: string, readError?: string }[]} files every candidate shard file found
 *   (file: path relative to the shard dir; text: its content; readError: why it could not be read)
 * @param {{ commit: string | null, checkRevision: object }} expected this check run's commit and revision
 * @returns {{ ok: boolean, total: number | null, reasons: string[], durationMs: number,
 *   shards: { index: number, file: string, status: string, durationMs: number, log: string }[] }}
 */
export function mergeShardEvidence(files, expected) {
  const reasons = [];
  const shards = [];
  let total = null;
  const list = Array.isArray(files) ? files : [];
  if (list.length === 0) reasons.push('no shard evidence files found');
  if (!expected || typeof expected.commit !== 'string' || expected.commit === '') {
    reasons.push('this check run has no commit; shard evidence cannot be tied to it');
  }

  for (const f of list) {
    const where = f.file;
    const name = String(where).split('/').pop();
    const fileMatch = SHARD_FILE_RE.exec(name);
    if (!fileMatch) {
      reasons.push(`${where}: not a shard evidence file name`);
      continue;
    }
    if (f.readError) {
      reasons.push(`${where}: cannot read: ${f.readError}`);
      continue;
    }
    let ev;
    try {
      ev = JSON.parse(f.text ?? '');
    } catch (err) {
      reasons.push(`${where}: not valid JSON: ${err.message}`);
      continue;
    }
    if (!isObject(ev)) {
      reasons.push(`${where}: not a JSON object`);
      continue;
    }
    if (ev.kind !== SHARD_KIND)
      reasons.push(`${where}: kind is ${JSON.stringify(ev.kind)}, expected "${SHARD_KIND}"`);
    if (ev.schemaVersion !== SHARD_SCHEMA_VERSION) {
      reasons.push(
        `${where}: schemaVersion is ${JSON.stringify(ev.schemaVersion)}, expected ${SHARD_SCHEMA_VERSION}`,
      );
    }
    const spec = isObject(ev.shard) ? ev.shard : {};
    const parsed = parseShardSpec(`${spec.index}/${spec.total}`);
    if (!Number.isInteger(spec.index) || !Number.isInteger(spec.total) || !parsed.ok) {
      reasons.push(`${where}: invalid shard ${JSON.stringify(ev.shard)}`);
      continue;
    }
    if (Number(fileMatch[1]) !== spec.index) {
      reasons.push(`${where}: file name says shard ${fileMatch[1]} but the evidence is shard ${spec.index}`);
    }
    if (total === null) total = spec.total;
    else if (spec.total !== total) reasons.push(`${where}: shard total ${spec.total} differs from ${total}`);

    const cand = isObject(ev.candidate) ? ev.candidate : {};
    if (typeof cand.commit !== 'string' || cand.commit !== expected?.commit) {
      reasons.push(
        `${where}: commit ${JSON.stringify(cand.commit ?? null)} differs from this run's ${expected?.commit}`,
      );
    }
    if (cand.treeClean !== true) reasons.push(`${where}: tree was not clean`);

    const rev = isObject(ev.checkRevision) ? ev.checkRevision : {};
    const want = isObject(expected?.checkRevision) ? expected.checkRevision : {};
    for (const key of REVISION_KEYS) {
      if (typeof want[key] !== 'string' || want[key] === '') {
        reasons.push(`${where}: this run has no checkRevision.${key} to compare`);
      } else if (rev[key] !== want[key]) {
        reasons.push(
          `${where}: checkRevision.${key} ${JSON.stringify(rev[key] ?? null)} differs from this run's ${want[key]}`,
        );
      }
    }

    const steps = Array.isArray(ev.steps) ? ev.steps : [];
    const env = steps.filter((s) => isObject(s) && s.name === 'environment');
    const e2e = steps.filter((s) => isObject(s) && s.name === 'e2e');
    if (env.length !== 1 || env[0].status !== 'pass') reasons.push(`${where}: environment step did not pass`);
    if (e2e.length !== 1) {
      reasons.push(`${where}: has ${e2e.length} e2e steps, expected 1`);
    } else {
      if (e2e[0].command !== shardCommand(spec.index, spec.total)) {
        reasons.push(
          `${where}: e2e command ${JSON.stringify(e2e[0].command)}, expected "${shardCommand(spec.index, spec.total)}"`,
        );
      }
      if (e2e[0].status !== 'pass') {
        reasons.push(`shard ${spec.index}/${spec.total}: e2e status is ${JSON.stringify(e2e[0].status)}`);
      }
    }
    if (ev.outcome !== 'pass')
      reasons.push(`shard ${spec.index}/${spec.total}: outcome is ${JSON.stringify(ev.outcome)}`);

    shards.push({
      index: spec.index,
      file: where,
      status: e2e.length === 1 ? String(e2e[0].status) : 'missing',
      durationMs: e2e.length === 1 && Number.isFinite(e2e[0].durationMs) ? e2e[0].durationMs : 0,
      log: typeof ev.e2eLog === 'string' ? ev.e2eLog : e2e.length === 1 ? String(e2e[0].logTail ?? '') : '',
    });
  }

  if (total !== null) {
    for (let i = 1; i <= total; i++) {
      const n = shards.filter((s) => s.index === i).length;
      if (n === 0) reasons.push(`shard ${i}/${total} is missing`);
      else if (n > 1) reasons.push(`shard ${i}/${total} appears ${n} times`);
    }
  }

  shards.sort((a, b) => a.index - b.index || a.file.localeCompare(b.file));
  return {
    ok: reasons.length === 0,
    total,
    reasons,
    durationMs: shards.reduce((m, s) => Math.max(m, s.durationMs), 0),
    shards,
  };
}
