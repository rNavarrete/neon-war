#!/usr/bin/env node
// Flag control changes between two refs (ENG-140, G-B3/G-B4). Detective only:
// always exits 0 (an uncomputable diff is reported as flagged), writes a JSON report and prints reasons.
//
//   node scripts/control-change.mjs --base <ref> --head <ref> [--repo <path>] [--out <json>]
//
// In CI this runs from a checkout of the BASE commit (trusted/) against the head
// repo (--repo), so a PR cannot redefine its own classifier.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { classifyDiff } from './lib/control-change.mjs';

function usage(message) {
  console.error(`control-change: ${message}`);
  console.error(
    'usage: node scripts/control-change.mjs --base <ref> --head <ref> [--repo <path>] [--out <json>]',
  );
  process.exit(2);
}

const argv = process.argv.slice(2);
const opts = { base: null, head: null, repo: '.', out: 'control-change.json' };
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  const v = argv[i + 1];
  if (!['--base', '--head', '--repo', '--out'].includes(arg)) usage(`unknown argument ${arg}`);
  if (v === undefined || v === '') usage(`${arg} needs a value`);
  opts[arg.slice(2)] = v;
  i++;
}
if (!opts.base || !opts.head) usage('--base and --head are required');

function git(args) {
  const r = spawnSync('git', args, { cwd: opts.repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || '').trim()}`);
  }
  return r.stdout;
}

const range = `${opts.base}...${opts.head}`;
let files = [];
let result;
let report;
try {
  const fields = git(['diff', '--name-status', '-z', '-M', range]).split('\0');
  files = [];
  for (let i = 0; i < fields.length - 1;) {
    const status = fields[i++];
    if (status.startsWith('R') || status.startsWith('C')) {
      const oldPath = fields[i++];
      const path = fields[i++];
      files.push({ path, oldPath, status: status[0] });
    } else {
      files.push({ path: fields[i++], status });
    }
  }
  for (const f of files) {
    const paths = f.oldPath ? [f.oldPath, f.path] : [f.path];
    f.patch = git(['diff', '-M', '--no-color', '--unified=0', range, '--', ...paths]);
  }

  result = classifyDiff(files);
  report = {
    base: opts.base,
    head: opts.head,
    baseCommit: git(['rev-parse', opts.base]).trim(),
    headCommit: git(['rev-parse', opts.head]).trim(),
    files: files.map(({ path, oldPath, status }) => (oldPath ? { path, oldPath, status } : { path, status })),
    ...result,
  };
} catch (err) {
  // Detective control: never fail the job, but an uncomputable diff is itself flagged.
  result = { flagged: true, reasons: [`could not compute diff: ${err.message}`] };
  report = { base: opts.base, head: opts.head, baseCommit: null, headCommit: null, files, ...result };
}
writeFileSync(opts.out, `${JSON.stringify(report, null, 2)}\n`);

if (result.flagged) {
  console.log(`CONTROL CHANGE: needs Rolando's explicit review (${result.reasons.length} reason(s))`);
  for (const r of result.reasons) console.log(`  - ${r}`);
} else {
  console.log(`no control change in ${range} (${files.length} file(s))`);
}

if (process.env.GITHUB_ACTIONS === 'true') {
  if (result.flagged) {
    for (const r of result.reasons)
      console.log(`::warning title=Control change::${r.replace(/\r?\n/g, ' ')}`);
  }
  // The workflow writes the step summary from the JSON report (it also covers
  // the case where the base branch has no trusted classifier).
}
