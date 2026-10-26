#!/usr/bin/env node
// Workspace setup for fresh cloud sessions (ENG-141). See docs/setup.md.
//
//   node scripts/session-setup.mjs --prepare   cloud environment setup script (cached snapshot):
//                                              install dependencies, check the tools run
//   node scripts/session-setup.mjs --hook      SessionStart hook (every session): reuse or
//                                              reinstall dependencies, start per-session
//                                              services, run readiness checks, record status
//   node scripts/session-setup.mjs --gate      PreToolUse hook: when the guard is on, block
//                                              edits and shell commands unless this
//                                              session's setup succeeded
//
// --hook and --gate do nothing outside cloud sessions (CLAUDE_CODE_REMOTE != "true"),
// unless --force is given. The guard is on only when FACTORY_SETUP_GATE=enforce, which the
// factory's cloud environment sets for worker sessions; other cloud sessions still run
// setup and see its result, but are never blocked. Local fallback is out of scope (ENG-154).

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Loaded dynamically so the gate can still block if the helper file is missing or broken:
// a failed static import would exit 1, which Claude Code treats as "let the call through".
let lib;
let libError;
try {
  lib = await import('./lib/session-setup.mjs');
} catch (e) {
  libError = e;
}
if (libError && !process.argv.includes('--gate')) throw libError;
const {
  STATUS_SCHEMA_VERSION,
  decideInstall,
  gateDecision,
  gateMode,
  secretLikeContent,
  secretLikePaths,
  sessionContext,
  sha256,
  waitForReady,
} = lib ?? {};

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATUS_PATH = join(ROOT, '.factory', 'setup-status.json');
const STAMP_PATH = join(ROOT, 'node_modules', '.factory-setup-stamp.json');
// The hook entry in .claude/settings.json allows 300 s. If the steps together run longer, the
// hook is killed, its status stays "running" and the gate blocks (fails closed).
const INSTALL_TIMEOUT_MS = 240_000;
const TOOL_TIMEOUT_MS = 30_000;
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

// Per-session services: started on every session start, because the environment cache
// keeps files only, never running processes. This app needs none (data lives in the
// browser, unit tests run in node and browser tests start their own vite preview server). To add one, give it a start command and a
// readiness probe; setup fails if it is not ready within its timeout.
//   { name: 'db', command: ['docker', 'compose', 'up', '-d', 'db'], ready: () => portOpen(5432), timeoutMs: 60_000 }
const SERVICES = [];

// Every tool the check needs must actually run, not just be on disk.
const READINESS = [
  { name: 'typescript', args: ['node_modules/typescript/bin/tsc', '--version'] },
  { name: 'vitest', args: ['node_modules/vitest/vitest.mjs', '--version'] },
  { name: 'vite', args: ['node_modules/vite/bin/vite.js', '--version'] },
  { name: 'eslint', args: ['node_modules/eslint/bin/eslint.js', '--version'] },
  { name: 'prettier', args: ['node_modules/prettier/bin/prettier.cjs', '--version'] },
  { name: 'playwright', args: ['node_modules/@playwright/test/cli.js', '--version'] },
];

const args = new Set(process.argv.slice(2));
const mode = ['--prepare', '--hook', '--gate'].find((m) => args.has(m));
const remote = process.env.CLAUDE_CODE_REMOTE === 'true' || args.has('--force');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

// Hook input from Claude Code (JSON on stdin); {} when absent or unreadable.
function readInput() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function tail(text, n = 400) {
  const t = String(text ?? '').trim();
  return t.length > n ? `...${t.slice(-n)}` : t;
}

function stepNode() {
  const wanted = readFileSync(join(ROOT, '.nvmrc'), 'utf8').trim().replace(/^v/, '');
  const major = process.versions.node.split('.')[0];
  if (wanted.split('.')[0] !== major)
    throw new Error(`node ${process.version} does not match .nvmrc (${wanted})`);
  return `node ${process.version}, .nvmrc ${wanted}`;
}

function stepSecrets() {
  const ls = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
  if (ls.status !== 0) throw new Error(`git ls-files failed: ${tail(ls.stderr)}`);
  const files = ls.stdout.split('\0').filter(Boolean);
  const badPaths = secretLikePaths(files);
  const badContent = [];
  for (const f of files) {
    let text;
    try {
      text = readFileSync(join(ROOT, f), 'utf8');
    } catch {
      continue; // deleted in the working tree
    }
    const hits = secretLikeContent(text);
    if (hits.length) badContent.push(`${f} (${hits.join(', ')})`);
  }
  if (badPaths.length || badContent.length)
    throw new Error(
      `secret-like files are tracked: ${[...badPaths, ...badContent].join('; ')}. Remove them; this repo holds no secrets.`,
    );
  return `${files.length} tracked files, no secret-like files or tokens`;
}

function stepDependencies() {
  const lockSha256 = sha256(readFileSync(join(ROOT, 'package-lock.json')));
  const manifestSha256 = sha256(readFileSync(join(ROOT, 'package.json')));
  const nodeMajor = process.versions.node.split('.')[0];
  const decision = decideInstall({ stamp: readJson(STAMP_PATH), lockSha256, manifestSha256, nodeMajor });
  if (decision.action === 'reuse') return { detail: decision.reason, install: 'cache hit' };
  const started = Date.now();
  // --ignore-scripts: same as CI, dependencies cannot run code during install.
  const r = spawnSync(NPM, ['ci', '--ignore-scripts', '--prefer-offline', '--no-audit', '--no-fund'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: INSTALL_TIMEOUT_MS,
    killSignal: 'SIGKILL',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error?.code === 'ETIMEDOUT') throw new Error(`npm ci timed out after ${INSTALL_TIMEOUT_MS / 1000} s`);
  if (r.status !== 0) {
    // npm puts the reason first and its usage text after, so keep the start of the output.
    const out = String(r.stderr || r.stdout || '').trim();
    throw new Error(`npm ci exited ${r.status}: ${out.length > 400 ? `${out.slice(0, 400)}...` : out}`);
  }
  writeFileSync(
    STAMP_PATH,
    JSON.stringify(
      { lockSha256, manifestSha256, nodeMajor, installedAt: new Date().toISOString() },
      null,
      2,
    ) + '\n',
  );
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  return { detail: `npm ci in ${secs} s (${decision.reason})`, install: 'fresh install' };
}

function stepTools() {
  for (const t of READINESS) {
    const r = spawnSync(process.execPath, t.args, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: TOOL_TIMEOUT_MS,
    });
    if (r.status !== 0)
      throw new Error(`${t.name} is not runnable: ${tail(r.stderr || r.stdout || r.error)}`);
  }
  return READINESS.map((t) => t.name).join(', ') + ' run';
}

async function stepServices() {
  if (SERVICES.length === 0) return 'none needed';
  const started = [];
  for (const s of SERVICES) {
    const child = spawn(s.command[0], s.command.slice(1), {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    const r = await waitForReady(s.ready, { timeoutMs: s.timeoutMs });
    if (!r.ready) throw new Error(`service ${s.name} not ready after ${r.waitedMs} ms`);
    started.push(`${s.name} ready in ${r.waitedMs} ms`);
  }
  return started.join(', ');
}

async function runSteps(steps, status, onProgress) {
  for (const [name, fn] of steps) {
    try {
      const out = await fn();
      const detail = typeof out === 'string' ? out : out.detail;
      if (out && typeof out === 'object' && out.install) status.install = out.install;
      status.steps.push({ name, status: 'pass', detail });
    } catch (e) {
      status.steps.push({ name, status: 'fail', detail: e.message });
      status.status = 'failed';
      status.failedStep = name;
      onProgress?.();
      return;
    }
    onProgress?.();
  }
  status.status = 'ok';
}

function writeStatus(status) {
  mkdirSync(dirname(STATUS_PATH), { recursive: true });
  writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2) + '\n');
}

async function prepare() {
  const status = { status: 'running', steps: [] };
  await runSteps(
    [
      ['node', stepNode],
      ['dependencies', stepDependencies],
      ['tools', stepTools],
    ],
    status,
  );
  for (const s of status.steps) console.log(`${s.name}: ${s.status} (${s.detail})`);
  process.exit(status.status === 'ok' ? 0 : 1);
}

async function hook() {
  if (!remote) process.exit(0);
  const input = readInput();
  // After a context compaction the workspace is unchanged; keep this session's good result
  // instead of re-running setup and risking a transient failure in a working session.
  const previous = readJson(STATUS_PATH);
  if (input.source === 'compact' && previous?.status === 'ok' && previous.sessionId === input.session_id) {
    const out = {
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: sessionContext(previous) },
    };
    process.stdout.write(JSON.stringify(out) + '\n');
    process.exit(0);
  }
  const status = {
    schemaVersion: STATUS_SCHEMA_VERSION,
    sessionId: input.session_id ?? null,
    source: input.source ?? null,
    gate: gateMode(process.env.FACTORY_SETUP_GATE),
    status: 'running',
    startedAt: new Date().toISOString(),
    steps: [],
  };
  // Written first: if the hook is killed by its timeout, the gate sees "running" and blocks.
  writeStatus(status);
  await runSteps(
    [
      ['node', stepNode],
      ['secrets', stepSecrets],
      ['dependencies', stepDependencies],
      ['tools', stepTools],
      ['services', stepServices],
    ],
    status,
    () => writeStatus(status),
  );
  status.finishedAt = new Date().toISOString();
  writeStatus(status);
  const out = {
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: sessionContext(status) },
  };
  // Only a worker session (guard on) is stopped; anyone else just sees the failure.
  if (status.status !== 'ok' && status.gate.enforce) {
    out.continue = false;
    out.stopReason = `Infrastructure failure: workspace setup failed at "${status.failedStep}". The task was not started.`;
  }
  process.stdout.write(JSON.stringify(out) + '\n');
  process.exit(0);
}

function gate() {
  let d;
  try {
    if (libError) {
      // Same rule as gateMode, inlined because the helpers failed to load.
      const v = (process.env.FACTORY_SETUP_GATE ?? '').trim();
      if (!remote || v === '' || v === 'off') process.exit(0);
      throw libError;
    }
    const { enforce } = gateMode(process.env.FACTORY_SETUP_GATE);
    if (remote && !enforce) process.exit(0); // guard off: skip reading the status file
    const input = readInput();
    d = gateDecision({ remote, enforce, status: readJson(STATUS_PATH), sessionId: input.session_id });
  } catch (e) {
    // Any other exit code would let the tool call through, so an internal error blocks too.
    d = { allow: false, reason: `setup gate error: ${e.message}` };
  }
  if (d.allow) process.exit(0);
  // Exit 2 blocks the tool call and shows this to Claude.
  process.stderr.write(
    `Blocked: ${d.reason}. This is an infrastructure failure. Do not work on the task; ` +
      'end the attempt and report an infrastructure failure. Details: .factory/setup-status.json\n',
  );
  process.exit(2);
}

if (mode === '--prepare') await prepare();
else if (mode === '--hook') await hook();
else if (mode === '--gate') gate();
else {
  console.error('usage: node scripts/session-setup.mjs --prepare | --hook | --gate [--force]');
  process.exit(64);
}
