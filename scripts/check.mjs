#!/usr/bin/env node
// The one trusted check command for this repo (ENG-140, governance G-B1/G-B5).
//
//   npm run check [-- --out <path>] [-- --contract-digest <sha256 hex>]
//                 [-- --contract-claim-from-event]
//
// --contract-claim-from-event (CI, pull_request events): read the PR title/body
// from the GitHub event payload (GITHUB_EVENT_PATH) and record the contract
// digest the PR CLAIMS (a "Contract-Digest: <hex>" body line, which must match
// the title's factory marker when there is one). A malformed claim fails the
// check (step "contract"). The claim is not trusted: the controller compares it
// with its approval record via verify-evidence --expect-contract-digest.
//
// Runs a fixed list of steps (format, lint, typecheck, test, build, e2e), each with a
// fixed timeout, always running every step so the evidence shows every failure.
// Writes an evidence JSON (schemaVersion 1) and full per-step logs to check-logs/.
// Exits 0 only when every step passed AND the working tree is clean (a dirty
// tree is not a candidate commit).
//
// Deliberately NOT supported: narrowing the step list (--only) or changing
// timeouts from the environment. The command must not be able to redefine its
// own evidence. Changes to this file are flagged as a control change.

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isControlPath } from './lib/control-change.mjs';
import { parseContractClaim } from './lib/contract-claim.mjs';

const CHECK_VERSION = '1';
const SCHEMA_VERSION = 1;
const LOG_TAIL_LINES = 200;
const DRAIN_MS = 2_000; // wait for output after a step exits before destroying its pipes
const KILL_GRACE_MS = 5_000; // SIGTERM -> SIGKILL on timeout

// Kills the running step's process group; set while a step runs.
let currentKill = null;

// Environment for steps: NODE_OPTIONS can inject code (--require/--import) into
// every tool, so it is never passed through.
const CLEARED_ENV = ['NODE_OPTIONS', 'npm_config_node_options', 'NPM_CONFIG_NODE_OPTIONS'];
function childEnv() {
  const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };
  for (const k of CLEARED_ENV) delete env[k];
  return env;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'ci.yml');

// Fixed step list and timeouts. Order matters only for display.
const STEPS = [
  { name: 'format', bin: 'prettier', args: ['--check', '.'], timeoutMs: 120_000 },
  { name: 'lint', bin: 'eslint', args: ['.'], timeoutMs: 180_000 },
  { name: 'typecheck', bin: 'tsc', args: ['--noEmit'], timeoutMs: 180_000 },
  { name: 'test', bin: 'vitest', args: ['run'], timeoutMs: 300_000 },
  { name: 'build', bin: 'vite', args: ['build'], timeoutMs: 180_000 },
  // Browser tests run against the built game (playwright.config.ts serves dist/ with vite preview).
  // 15 minutes: Session 0's suite plays the surge and the whole night on software WebGL (~10 min).
  { name: 'e2e', bin: 'playwright', args: ['test'], timeoutMs: 900_000 },
];

function usage(message) {
  if (message) console.error(`check: ${message}`);
  console.error(
    'usage: node scripts/check.mjs [--out <path>] [--contract-digest <sha256 hex>] [--contract-claim-from-event]',
  );
  process.exit(1);
}

function parseArgs(argv) {
  const envDigest = process.env.FACTORY_CONTRACT_DIGEST || null;
  const opts = {
    out: 'check-evidence.json',
    contractDigest: envDigest,
    contractDigestSource: envDigest ? 'env' : null,
    contractClaimFromEvent: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [flag, inline] = arg.startsWith('--') && arg.includes('=') ? arg.split(/=(.*)/s) : [arg, undefined];
    const value = () => {
      const v = inline ?? argv[++i];
      if (v === undefined || v === '') usage(`${flag} needs a value`);
      return v;
    };
    if (flag === '--out') opts.out = value();
    else if (flag === '--contract-digest') {
      opts.contractDigest = value();
      opts.contractDigestSource = 'flag';
    } else if (flag === '--contract-claim-from-event' && inline === undefined)
      opts.contractClaimFromEvent = true;
    else usage(`unknown argument: ${arg} (the step list and timeouts are fixed)`);
  }
  if (opts.contractDigest !== null) {
    opts.contractDigest = opts.contractDigest.toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(opts.contractDigest)) {
      usage('--contract-digest / FACTORY_CONTRACT_DIGEST must be a 64-character sha256 hex string');
    }
  }
  return opts;
}

// Read the PR title/body from the GitHub event payload file. Title and body are
// only ever handled as data here; they never pass through a shell.
function readPrFromEvent() {
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path) return { error: 'GITHUB_EVENT_PATH is not set; cannot read the PR contract claim' };
  let event;
  try {
    event = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    return { error: `cannot read GitHub event payload ${path}: ${err.code ?? err.message}` };
  }
  const pr = event && typeof event === 'object' ? event.pull_request : null;
  if (!pr || typeof pr !== 'object') {
    return { error: 'GitHub event payload has no pull_request; cannot read the PR contract claim' };
  }
  return {
    title: typeof pr.title === 'string' ? pr.title : '',
    body: typeof pr.body === 'string' ? pr.body : '',
  };
}

// Resolve the recorded contract digest: explicit (--contract-digest / env) wins,
// otherwise the PR body claim. Any claim error or explicit/claim mismatch fails.
function resolveContract(opts) {
  const started = Date.now();
  let digest = opts.contractDigest;
  let source = opts.contractDigestSource;
  const errors = [];
  let log;
  if (!opts.contractClaimFromEvent) {
    return { digest, source, errors, step: null };
  }
  const pr = readPrFromEvent();
  if (pr.error) {
    errors.push(pr.error);
  } else {
    const claim = parseContractClaim(pr);
    errors.push(...claim.reasons);
    if (claim.reasons.length === 0 && claim.digest !== null) {
      if (digest === null) {
        digest = claim.digest;
        source = 'pr-body';
      } else if (digest !== claim.digest) {
        errors.push(
          `${source === 'env' ? 'FACTORY_CONTRACT_DIGEST' : '--contract-digest'} ${digest} differs from PR body Contract-Digest ${claim.digest}`,
        );
      }
    }
  }
  if (errors.length > 0) {
    log = errors.join('\n');
  } else {
    log =
      digest === null
        ? 'no contract claim in PR (ordinary PR)'
        : `contract digest ${digest} (source: ${source})`;
  }
  return {
    digest,
    source,
    errors,
    step: {
      name: 'contract',
      command: 'parse PR title/body contract claim (GITHUB_EVENT_PATH)',
      status: errors.length === 0 ? 'pass' : 'fail',
      exitCode: errors.length === 0 ? 0 : 1,
      durationMs: Date.now() - started,
      timeoutMs: 0,
      logTail: log,
    },
  };
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

function fileSha256(path) {
  return existsSync(path) ? sha256(readFileSync(path)) : null;
}

// Hash of every tracked file that is NOT plain allowlisted content: the same
// predicate control-change uses ("would be flagged if changed"). Covers scripts,
// workflows, package files, all config and dotfiles, CLAUDE.md, etc.
function configSha256() {
  const r = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) return null;
  const names = r.stdout
    .split('\0')
    .filter((n) => n !== '' && isControlPath(n))
    .sort();
  const h = createHash('sha256');
  for (const name of names) {
    const p = join(ROOT, name);
    h.update(`${name}\0`);
    h.update(existsSync(p) ? readFileSync(p) : '<missing>');
    h.update('\0');
  }
  return h.digest('hex');
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function treeIsClean() {
  const r = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 && r.stdout.trim() === '';
}

function candidate() {
  let branch = process.env.GITHUB_HEAD_REF || null;
  if (!branch) {
    const b = git(['rev-parse', '--abbrev-ref', 'HEAD']);
    branch = b && b !== 'HEAD' ? b : process.env.GITHUB_REF_NAME || null;
  }
  return { commit: git(['rev-parse', 'HEAD']), treeClean: treeIsClean(), branch };
}

function runner() {
  const forced = process.env.FACTORY_RUNNER;
  if (forced === 'github-actions' || forced === 'local' || forced === 'cloud-worker') return forced;
  return process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local';
}

function environment() {
  const npm = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version'], {
    encoding: 'utf8',
  });
  return {
    node: process.version,
    npm: npm.status === 0 ? npm.stdout.trim() : null,
    platform: process.platform,
    arch: process.arch,
    ci: process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true',
    runner: runner(),
    nodeOptionsCleared: true,
  };
}

function tail(text, lines = LOG_TAIL_LINES) {
  const all = text.split('\n');
  if (all.length && all[all.length - 1] === '') all.pop();
  return all.slice(-lines).join('\n');
}

function environmentStep() {
  const started = Date.now();
  const nvmrcPath = join(ROOT, '.nvmrc');
  const wanted = existsSync(nvmrcPath) ? readFileSync(nvmrcPath, 'utf8').trim().replace(/^v/, '') : null;
  const wantedMajor = wanted ? wanted.split('.')[0] : null;
  const actualMajor = process.versions.node.split('.')[0];
  const ok = wantedMajor !== null && wantedMajor === actualMajor;
  const log = ok
    ? `node ${process.version} matches .nvmrc (${wanted})`
    : wantedMajor === null
      ? 'cannot read .nvmrc; refusing to run checks without a pinned Node version'
      : `node ${process.version} does not match .nvmrc (${wanted}); install Node ${wantedMajor} (e.g. nvm use) and rerun`;
  return {
    name: 'environment',
    command: 'node --version (must match .nvmrc major)',
    status: ok ? 'pass' : 'fail',
    exitCode: ok ? 0 : 1,
    durationMs: Date.now() - started,
    timeoutMs: 0,
    logTail: log,
  };
}

function runStep(step, logDir) {
  const command = `${step.bin} ${step.args.join(' ')}`;
  const binPath = join(ROOT, 'node_modules', '.bin', step.bin);
  const started = Date.now();
  return new Promise((resolveStep) => {
    let output = '';
    let timedOut = false;
    let settled = false;
    // Every timer this step schedules; all are cleared when the step settles so a
    // late timer can never act on (or clear currentKill for) the next step.
    const timers = new Set();
    const later = (fn, ms) => {
      const t = setTimeout(() => {
        timers.delete(t);
        fn();
      }, ms);
      timers.add(t);
      return t;
    };
    // Kill function owned by this step; currentKill is only cleared while it is still ours.
    let myKill = null;
    const releaseKill = () => {
      if (myKill !== null && currentKill === myKill) currentKill = null;
    };
    const finish = (status, exitCode, extra = '') => {
      if (settled) return;
      settled = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      releaseKill();
      if (extra) output += `${output.endsWith('\n') || output === '' ? '' : '\n'}${extra}\n`;
      writeFileSync(join(logDir, `${step.name}.log`), `$ ${command}\n${output}`);
      resolveStep({
        name: step.name,
        command,
        status,
        exitCode,
        durationMs: Date.now() - started,
        timeoutMs: step.timeoutMs,
        logTail: tail(output),
      });
    };

    if (!existsSync(binPath)) {
      writeFileSync(join(logDir, `${step.name}.log`), `$ ${command}\nmissing ${binPath}; run npm ci\n`);
      resolveStep({
        name: step.name,
        command,
        status: 'error',
        exitCode: null,
        durationMs: Date.now() - started,
        timeoutMs: step.timeoutMs,
        logTail: `missing ${binPath}; run npm ci`,
      });
      return;
    }

    const child = spawn(binPath, step.args, {
      cwd: ROOT,
      env: childEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const onData = (chunk) => {
      output += chunk.toString();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);

    const killTree = (signal) => {
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, signal);
        else child.kill(signal);
      } catch {
        // already gone
      }
    };
    myKill = () => killTree('SIGKILL');
    currentKill = myKill;

    // Resolve on 'exit', not 'close': a grandchild that escaped the process group
    // (setsid) can hold the pipes open forever. Give output DRAIN_MS to arrive,
    // then destroy the pipes and settle.
    let exitInfo = null;
    // Idempotent: runs from the 'close' event, the post-exit drain timer or the
    // hard-stop timer, whichever comes first; later calls are no-ops.
    const settleAfterExit = () => {
      if (settled) return;
      child.stdout.destroy();
      child.stderr.destroy();
      const { code, signal } = exitInfo ?? { code: null, signal: null };
      if (timedOut) {
        finish('timeout', code, `check: ${step.name} exceeded ${step.timeoutMs}ms and was killed`);
      } else if (code === 0) {
        finish('pass', 0);
      } else {
        finish('fail', code, signal ? `check: ${step.name} terminated by ${signal}` : '');
      }
    };

    later(() => {
      timedOut = true;
      killTree('SIGTERM');
      later(() => killTree('SIGKILL'), KILL_GRACE_MS).unref();
      // Hard stop even if the direct child somehow never reports exit.
      later(settleAfterExit, KILL_GRACE_MS + DRAIN_MS + 1_000).unref();
    }, step.timeoutMs);

    child.on('error', (err) => {
      finish('error', null, `check: failed to start ${command}: ${err.message}`);
    });
    child.on('exit', (code, signal) => {
      exitInfo = { code, signal };
      // Reap anything the step left behind in its own process group.
      killTree('SIGKILL');
      if (!settled) later(settleAfterExit, DRAIN_MS).unref();
    });
    child.on('close', () => {
      if (exitInfo) settleAfterExit();
    });
  });
}

function pad(s, n) {
  return String(s).padEnd(n);
}

function printTable(evidence) {
  const rows = evidence.steps.map((s) => [s.name, s.status, s.exitCode ?? '-', `${s.durationMs}ms`]);
  console.log('');
  console.log(`${pad('step', 12)}${pad('status', 10)}${pad('exit', 6)}duration`);
  for (const r of rows) console.log(`${pad(r[0], 12)}${pad(r[1], 10)}${pad(r[2], 6)}${r[3]}`);
  console.log('');
  console.log(`commit:     ${evidence.candidate.commit ?? '(none)'}`);
  console.log(`tree clean: ${evidence.candidate.treeClean}`);
  console.log(
    `contract:   ${evidence.contractDigest ?? '(none)'}${evidence.contractDigestSource ? ` (${evidence.contractDigestSource})` : ''}`,
  );
  console.log(`outcome:    ${evidence.outcome.toUpperCase()} (${evidence.durationMs}ms)`);
  if (!evidence.candidate.treeClean) {
    console.log('            working tree is dirty: commit your changes; a dirty tree is not a candidate');
  }
}

function appendStepSummary(evidence, outPath) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  const lines = [
    `### npm run check: ${evidence.outcome === 'pass' ? 'pass' : 'FAIL'}`,
    '',
    `Commit \`${evidence.candidate.commit}\`, tree clean: ${evidence.candidate.treeClean}, evidence: \`${outPath}\``,
    '',
    '| step | status | exit | duration |',
    '| --- | --- | --- | --- |',
    ...evidence.steps.map((s) => `| ${s.name} | ${s.status} | ${s.exitCode ?? '-'} | ${s.durationMs}ms |`),
    '',
  ];
  try {
    appendFileSync(file, lines.join('\n'));
  } catch (err) {
    console.error(`check: could not write GITHUB_STEP_SUMMARY: ${err.message}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const outPath = resolve(process.cwd(), opts.out);
  const logDir = join(ROOT, 'check-logs');
  mkdirSync(logDir, { recursive: true });
  // Never leave an older evidence file behind for an interrupted run to be mistaken for.
  rmSync(outPath, { force: true });

  const startedAt = new Date();
  const cand = candidate();
  const checkRevision = {
    checkVersion: CHECK_VERSION,
    checkScriptSha256: fileSha256(SCRIPT_PATH),
    workflowSha256: fileSha256(WORKFLOW_PATH),
    configSha256: configSha256(),
  };

  const steps = [];
  const contract = resolveContract(opts);
  if (contract.step) {
    steps.push(contract.step);
    writeFileSync(join(logDir, 'contract.log'), `${contract.step.logTail}\n`);
    if (contract.step.status !== 'pass') console.error(`check: contract claim: ${contract.step.logTail}`);
  }
  const env = environmentStep();
  steps.push(env);
  writeFileSync(join(logDir, 'environment.log'), `${env.logTail}\n`);
  if (env.status !== 'pass') {
    console.error(`check: ${env.logTail}`);
  } else {
    for (const step of STEPS) {
      process.stdout.write(`check: ${step.name} ... `);
      const result = await runStep(step, logDir);
      console.log(`${result.status} (${result.durationMs}ms)`);
      steps.push(result);
    }
  }

  // Re-check after the steps: a step that dirties the tree also invalidates the candidate.
  cand.treeClean = cand.treeClean && treeIsClean();
  const allPassed =
    steps.every((s) => s.status === 'pass') && STEPS.every((d) => steps.some((s) => s.name === d.name));
  const finishedAt = new Date();
  const evidence = {
    schemaVersion: SCHEMA_VERSION,
    command: 'npm run check',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    candidate: cand,
    // On failure (claim errors) no digest is recorded.
    contractDigest: contract.errors.length === 0 ? contract.digest : null,
    contractDigestSource: contract.errors.length === 0 && contract.digest !== null ? contract.source : null,
    ...(contract.errors.length > 0 ? { contractClaimErrors: contract.errors } : {}),
    checkRevision,
    environment: environment(),
    steps,
    outcome: allPassed && cand.treeClean && cand.commit ? 'pass' : 'fail',
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`);
  printTable(evidence);
  console.log(`evidence:   ${outPath}`);
  console.log(`logs:       ${logDir}`);
  appendStepSummary(evidence, opts.out);
  process.exitCode = evidence.outcome === 'pass' ? 0 : 1;
}

// Ctrl-C / runner cancellation: kill the running step's whole process group and
// exit nonzero. No evidence is written for an interrupted run.
for (const [signal, code] of [
  ['SIGINT', 130],
  ['SIGTERM', 143],
]) {
  process.on(signal, () => {
    console.error(`\ncheck: received ${signal}; stopping the running step`);
    if (currentKill) currentKill();
    process.exit(code);
  });
}

main().catch((err) => {
  console.error(`check: internal error: ${err?.stack ?? err}`);
  process.exitCode = 1;
});
