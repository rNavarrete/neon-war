#!/usr/bin/env node
// Verify check evidence for an exact candidate commit (ENG-140, G-B2).
//
//   node scripts/verify-evidence.mjs <evidence.json> --expect-commit <sha>
//        [--expect-check-revision <file with trusted checkRevision json>]
//        [--expect-contract-digest <hex>] [--allow-control-change]
//
// --expect-contract-digest binds the evidence to an approved task contract: the
// trusted digest comes from the controller's approval record, never from the PR.
//
// Exit 0 only when verified. Skipped, neutral, missing, stale or dirty evidence is rejected.

import { readFileSync } from 'node:fs';
import { verifyEvidence } from './lib/evidence.mjs';

function fail(reasons) {
  console.error('evidence NOT verified:');
  for (const r of reasons) console.error(`  - ${r}`);
  process.exit(1);
}

function usage(message) {
  console.error(`verify-evidence: ${message}`);
  console.error(
    'usage: node scripts/verify-evidence.mjs <evidence.json> --expect-commit <sha> ' +
      '[--expect-check-revision <file>] [--expect-contract-digest <hex>] [--allow-control-change]',
  );
  process.exit(1);
}

const argv = process.argv.slice(2);
let file = null;
let expectCommit = null;
let revisionFile = null;
let expectContractDigest = null;
let allowControlChange = false;
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  const next = () => {
    const v = argv[++i];
    if (v === undefined || v === '') usage(`${arg} needs a value`);
    return v;
  };
  if (arg === '--expect-commit') expectCommit = next();
  else if (arg === '--expect-check-revision') revisionFile = next();
  else if (arg === '--expect-contract-digest') expectContractDigest = next();
  else if (arg === '--allow-control-change') allowControlChange = true;
  else if (arg.startsWith('--')) usage(`unknown flag ${arg}`);
  else if (file === null) file = arg;
  else usage(`unexpected argument ${arg}`);
}
if (!file) usage('missing <evidence.json>');
if (!expectCommit) usage('missing --expect-commit <sha>');

function readJson(path, what) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    fail([`cannot read ${what} ${path}: ${err.code ?? err.message}`]);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    fail([`${what} ${path} is not valid JSON: ${err.message}`]);
  }
}

const evidence = readJson(file, 'evidence file');
const expectations = { expectCommit, allowControlChange };
if (expectContractDigest !== null) expectations.expectContractDigest = expectContractDigest;
if (revisionFile) {
  const trusted = readJson(revisionFile, 'trusted checkRevision file');
  // Accept either a bare checkRevision object or a whole evidence file.
  expectations.expectCheckRevision =
    trusted && typeof trusted === 'object' && trusted.checkRevision ? trusted.checkRevision : trusted;
}

const { verified, reasons } = verifyEvidence(evidence, expectations);
if (!verified) fail(reasons);
console.log(`evidence verified for commit ${evidence.candidate.commit} (${file})`);
