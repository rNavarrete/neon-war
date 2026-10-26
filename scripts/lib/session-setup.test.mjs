import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  STATUS_SCHEMA_VERSION,
  decideInstall,
  gateDecision,
  gateMode,
  secretLikeContent,
  secretLikePaths,
  sessionContext,
  sha256,
  waitForReady,
} from './session-setup.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOCK = 'f'.repeat(64);
const MANIFEST = 'a'.repeat(64);
// Built by concatenation so this file never contains a token-shaped string itself.
const FAKE_ANTHROPIC = 'sk-' + 'ant-' + 'x'.repeat(40);
const FAKE_GITHUB = 'gh' + 'p_' + 'A'.repeat(36);

// ---- decideInstall ----

test('install when there is no stamp (cold start)', () => {
  const d = decideInstall({ stamp: null, lockSha256: LOCK, manifestSha256: MANIFEST, nodeMajor: '22' });
  assert.equal(d.action, 'install');
});

test('reuse node_modules when the stamp matches the lockfile and Node major (cache hit)', () => {
  const d = decideInstall({
    stamp: { lockSha256: LOCK, manifestSha256: MANIFEST, nodeMajor: '22' },
    lockSha256: LOCK,
    manifestSha256: MANIFEST,
    nodeMajor: '22',
  });
  assert.equal(d.action, 'reuse');
});

test('reinstall when the lockfile changed after the cached install', () => {
  const d = decideInstall({
    stamp: { lockSha256: 'e'.repeat(64), manifestSha256: MANIFEST, nodeMajor: '22' },
    lockSha256: LOCK,
    manifestSha256: MANIFEST,
    nodeMajor: '22',
  });
  assert.equal(d.action, 'install');
  assert.match(d.reason, /package-lock\.json changed/);
});

test('reinstall when package.json changed but the lockfile did not', () => {
  const d = decideInstall({
    stamp: { lockSha256: LOCK, manifestSha256: 'e'.repeat(64), nodeMajor: '22' },
    lockSha256: LOCK,
    manifestSha256: MANIFEST,
    nodeMajor: '22',
  });
  assert.equal(d.action, 'install');
  assert.match(d.reason, /package\.json changed/);
});

test('a stamp from before package.json was recorded is not a cache hit', () => {
  const d = decideInstall({
    stamp: { lockSha256: LOCK, nodeMajor: '22' },
    lockSha256: LOCK,
    manifestSha256: MANIFEST,
    nodeMajor: '22',
  });
  assert.equal(d.action, 'install');
});

test('reinstall when the Node major changed', () => {
  const d = decideInstall({
    stamp: { lockSha256: LOCK, manifestSha256: MANIFEST, nodeMajor: '20' },
    lockSha256: LOCK,
    manifestSha256: MANIFEST,
    nodeMajor: '22',
  });
  assert.equal(d.action, 'install');
});

// ---- secrets ----

test('secret-like paths are found; .env.example is allowed', () => {
  const found = secretLikePaths([
    'src/main.ts',
    '.env',
    'config/.env.production',
    '.env.example',
    'certs/server.pem',
    'deploy/id_ed25519',
    '.npmrc',
  ]);
  assert.deepEqual(found, [
    '.env',
    'config/.env.production',
    'certs/server.pem',
    'deploy/id_ed25519',
    '.npmrc',
  ]);
});

test('token-shaped content is found and named without echoing the value', () => {
  assert.deepEqual(secretLikeContent(`key=${FAKE_ANTHROPIC}`), ['Anthropic API or OAuth token']);
  assert.deepEqual(secretLikeContent(`t: ${FAKE_GITHUB}`), ['GitHub token']);
  assert.deepEqual(secretLikeContent('-----BEGIN OPENSSH ' + 'PRIVATE KEY-----'), ['private key']);
  assert.deepEqual(secretLikeContent('plain text about sk-ant- prefixes'), []);
});

// ---- gate ----

const okStatus = (over = {}) => ({
  schemaVersion: STATUS_SCHEMA_VERSION,
  sessionId: 's1',
  status: 'ok',
  ...over,
});

test('guard is on only for FACTORY_SETUP_GATE=enforce; unknown values fail closed', () => {
  assert.equal(gateMode(undefined).enforce, false);
  assert.equal(gateMode('').enforce, false);
  assert.equal(gateMode('off').enforce, false);
  assert.equal(gateMode('enforce').enforce, true);
  assert.equal(gateMode(' enforce\n').enforce, true);
  assert.equal(gateMode('Enforce').enforce, true); // not a known value, so fails closed
  assert.match(gateMode('yes').reason, /unknown value/);
});

test('gate allows everything outside cloud sessions', () => {
  assert.equal(
    gateDecision({ remote: false, enforce: true, status: null, sessionId: undefined }).allow,
    true,
  );
});

test('gate allows everything in cloud sessions when the guard is off', () => {
  const failed = okStatus({ status: 'failed', failedStep: 'dependencies' });
  for (const status of [null, failed, okStatus({ status: 'running' })]) {
    const d = gateDecision({ remote: true, enforce: false, status, sessionId: 's1' });
    assert.equal(d.allow, true);
    assert.match(d.reason, /guard is off/);
  }
});

test('gate allows only a successful setup from this session', () => {
  assert.equal(
    gateDecision({ remote: true, enforce: true, status: okStatus(), sessionId: 's1' }).allow,
    true,
  );
});

test('gate fails closed: missing, foreign, unfinished, failed or unknown-format status all block', () => {
  const cases = [
    [null, 's1', /has not run/],
    [okStatus(), 's2', /different session/],
    [okStatus(), undefined, /different session/],
    [okStatus({ status: 'running' }), 's1', /did not finish/],
    [okStatus({ status: 'failed', failedStep: 'dependencies' }), 's1', /failed at step "dependencies"/],
    [okStatus({ schemaVersion: 99 }), 's1', /unknown format/],
  ];
  for (const [status, sessionId, re] of cases) {
    const d = gateDecision({ remote: true, enforce: true, status, sessionId });
    assert.equal(d.allow, false, `${JSON.stringify(status)} / ${sessionId}`);
    assert.match(d.reason, re);
  }
});

// ---- readiness ----

function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => void (t += ms) };
}

test('a service is ready once its probe passes', async () => {
  let calls = 0;
  const r = await waitForReady(() => ++calls >= 3, { timeoutMs: 10_000, intervalMs: 100, ...fakeClock() });
  assert.deepEqual(r, { ready: true, attempts: 3, waitedMs: 200 });
});

test('a service that never becomes ready fails at its timeout; a throwing probe counts as not ready', async () => {
  const r = await waitForReady(
    () => {
      throw new Error('connection refused');
    },
    { timeoutMs: 1_000, intervalMs: 250, ...fakeClock() },
  );
  assert.equal(r.ready, false);
  assert.ok(r.waitedMs <= 1_000);
});

test('a failed setup tells the worker it is an infrastructure failure', () => {
  const text = sessionContext({
    status: 'failed',
    failedStep: 'dependencies',
    gate: gateMode('enforce'),
    steps: [],
  });
  assert.match(text, /^INFRASTRUCTURE FAILURE/);
  assert.match(text, /Do not work on the task/);
  assert.match(text, /Setup guard: on/);
});

test('with the guard off, a failed setup is reported without telling anyone to stop', () => {
  const text = sessionContext({
    status: 'failed',
    failedStep: 'dependencies',
    gate: gateMode(undefined),
    steps: [],
  });
  assert.match(text, /^Workspace setup failed at step "dependencies"/);
  assert.match(text, /Setup guard: off/);
  assert.doesNotMatch(text, /INFRASTRUCTURE FAILURE|Do not work on the task/);
});

// ---- CLI, on a throwaway copy of the repo's setup files ----

function fixture({ nvmrc = '22', extraFiles = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'session-setup-'));
  mkdirSync(join(root, 'scripts', 'lib'), { recursive: true });
  copyFileSync(join(REPO, 'scripts', 'session-setup.mjs'), join(root, 'scripts', 'session-setup.mjs'));
  copyFileSync(
    join(REPO, 'scripts', 'lib', 'session-setup.mjs'),
    join(root, 'scripts', 'lib', 'session-setup.mjs'),
  );
  copyFileSync(join(REPO, 'package-lock.json'), join(root, 'package-lock.json'));
  copyFileSync(join(REPO, 'package.json'), join(root, 'package.json'));
  writeFileSync(join(root, '.nvmrc'), `${nvmrc}\n`);
  for (const [p, text] of Object.entries(extraFiles)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  // node_modules: links to the real packages plus a matching stamp, so the hook takes the
  // cache-hit path and the real repo's node_modules is never touched.
  mkdirSync(join(root, 'node_modules'));
  for (const name of readdirSync(join(REPO, 'node_modules'))) {
    if (name.startsWith('.factory')) continue;
    symlinkSync(join(REPO, 'node_modules', name), join(root, 'node_modules', name));
  }
  writeFileSync(
    join(root, 'node_modules', '.factory-setup-stamp.json'),
    JSON.stringify({
      lockSha256: sha256(readFileSync(join(root, 'package-lock.json'))),
      manifestSha256: sha256(readFileSync(join(root, 'package.json'))),
      nodeMajor: process.versions.node.split('.')[0],
    }),
  );
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  return root;
}

function cli(root, args, input, env = {}) {
  const base = { ...process.env };
  delete base.CLAUDE_CODE_REMOTE;
  delete base.FACTORY_SETUP_GATE;
  return spawnSync(process.execPath, [join(root, 'scripts', 'session-setup.mjs'), ...args], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...base, ...env },
    timeout: 120_000,
  });
}

const readStatus = (root) => JSON.parse(readFileSync(join(root, '.factory', 'setup-status.json'), 'utf8'));

test('CLI: outside cloud sessions the hook and gate do nothing', () => {
  const root = fixture();
  try {
    const h = cli(root, ['--hook'], { session_id: 's1' });
    assert.equal(h.status, 0);
    assert.equal(h.stdout, '');
    assert.equal(cli(root, ['--gate'], { session_id: 's1' }).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: with the guard on, the gate blocks with exit 2 before setup has run', () => {
  const root = fixture();
  try {
    const g = cli(
      root,
      ['--gate'],
      { session_id: 's1' },
      { CLAUDE_CODE_REMOTE: 'true', FACTORY_SETUP_GATE: 'enforce' },
    );
    assert.equal(g.status, 2);
    assert.match(g.stderr, /infrastructure failure/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: cache-hit setup succeeds and unlocks the gate for this session only', () => {
  const root = fixture();
  try {
    const h = cli(
      root,
      ['--hook'],
      { session_id: 's1', source: 'startup' },
      { CLAUDE_CODE_REMOTE: 'true', FACTORY_SETUP_GATE: 'enforce' },
    );
    assert.equal(h.status, 0, h.stderr);
    const out = JSON.parse(h.stdout);
    assert.match(out.hookSpecificOutput.additionalContext, /^Workspace setup succeeded \(cache hit\)/);
    assert.equal(out.continue, undefined);
    const status = readStatus(root);
    assert.equal(status.status, 'ok');
    assert.deepEqual(
      status.steps.map((s) => [s.name, s.status]),
      [
        ['node', 'pass'],
        ['secrets', 'pass'],
        ['dependencies', 'pass'],
        ['tools', 'pass'],
        ['services', 'pass'],
      ],
    );
    assert.equal(
      cli(
        root,
        ['--gate'],
        { session_id: 's1' },
        { CLAUDE_CODE_REMOTE: 'true', FACTORY_SETUP_GATE: 'enforce' },
      ).status,
      0,
    );
    assert.equal(
      cli(
        root,
        ['--gate'],
        { session_id: 's2' },
        { CLAUDE_CODE_REMOTE: 'true', FACTORY_SETUP_GATE: 'enforce' },
      ).status,
      2,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: wrong Node version is an infrastructure failure that stops the session and blocks tools', () => {
  const root = fixture({ nvmrc: '18' });
  try {
    const h = cli(root, ['--hook', '--force'], { session_id: 's1' }, { FACTORY_SETUP_GATE: 'enforce' });
    assert.equal(h.status, 0);
    const out = JSON.parse(h.stdout);
    assert.equal(out.continue, false);
    assert.match(out.stopReason, /Infrastructure failure/);
    assert.match(
      out.hookSpecificOutput.additionalContext,
      /^INFRASTRUCTURE FAILURE: workspace setup failed at step "node"/,
    );
    assert.equal(readStatus(root).failedStep, 'node');
    const g = cli(root, ['--gate', '--force'], { session_id: 's1' }, { FACTORY_SETUP_GATE: 'enforce' });
    assert.equal(g.status, 2);
    assert.match(g.stderr, /failed at step "node"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: a tracked secret fails setup before anything is installed', () => {
  const root = fixture({ extraFiles: { 'src/config.ts': `export const key = '${FAKE_ANTHROPIC}';\n` } });
  try {
    const h = cli(root, ['--hook', '--force'], { session_id: 's1' });
    const status = readStatus(root);
    assert.equal(status.failedStep, 'secrets');
    assert.match(status.steps.at(-1).detail, /src\/config\.ts \(Anthropic API or OAuth token\)/);
    assert.doesNotMatch(h.stdout + JSON.stringify(status), new RegExp(FAKE_ANTHROPIC));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: with the guard off, a failed setup is reported but never stops or blocks the session', () => {
  const root = fixture({ nvmrc: '18' });
  try {
    const h = cli(root, ['--hook'], { session_id: 's1' }, { CLAUDE_CODE_REMOTE: 'true' });
    assert.equal(h.status, 0);
    const out = JSON.parse(h.stdout);
    assert.equal(out.continue, undefined);
    assert.match(out.hookSpecificOutput.additionalContext, /^Workspace setup failed at step "node"/);
    assert.match(out.hookSpecificOutput.additionalContext, /Setup guard: off/);
    const status = readStatus(root);
    assert.equal(status.failedStep, 'node');
    assert.equal(status.gate.enforce, false);
    assert.equal(cli(root, ['--gate'], { session_id: 's1' }, { CLAUDE_CODE_REMOTE: 'true' }).status, 0);
    assert.equal(cli(root, ['--gate'], { session_id: 's2' }, { CLAUDE_CODE_REMOTE: 'true' }).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: an unknown FACTORY_SETUP_GATE value blocks like "enforce"', () => {
  const root = fixture();
  try {
    const g = cli(
      root,
      ['--gate'],
      { session_id: 's1' },
      { CLAUDE_CODE_REMOTE: 'true', FACTORY_SETUP_GATE: 'yes' },
    );
    assert.equal(g.status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: if the helper file cannot load, the gate blocks with the guard on and allows with it off', () => {
  const root = fixture();
  try {
    rmSync(join(root, 'scripts', 'lib', 'session-setup.mjs'));
    const on = cli(
      root,
      ['--gate'],
      { session_id: 's1' },
      { CLAUDE_CODE_REMOTE: 'true', FACTORY_SETUP_GATE: 'enforce' },
    );
    assert.equal(on.status, 2);
    assert.match(on.stderr, /setup gate error/);
    assert.equal(cli(root, ['--gate'], { session_id: 's1' }, { CLAUDE_CODE_REMOTE: 'true' }).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: after a context compaction, a good setup from this session is kept, not re-run', () => {
  const root = fixture();
  const env = { CLAUDE_CODE_REMOTE: 'true', FACTORY_SETUP_GATE: 'enforce' };
  try {
    assert.equal(cli(root, ['--hook'], { session_id: 's1', source: 'startup' }, env).status, 0);
    const before = readFileSync(join(root, '.factory', 'setup-status.json'), 'utf8');
    const h = cli(root, ['--hook'], { session_id: 's1', source: 'compact' }, env);
    assert.equal(h.status, 0);
    assert.match(JSON.parse(h.stdout).hookSpecificOutput.additionalContext, /^Workspace setup succeeded/);
    assert.equal(readFileSync(join(root, '.factory', 'setup-status.json'), 'utf8'), before);
    // A compaction in a different session is a fresh start and runs setup again.
    cli(root, ['--hook'], { session_id: 's2', source: 'compact' }, env);
    assert.equal(readStatus(root).sessionId, 's2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI: package.json changed without its lockfile is not a cache hit; npm ci rejects it and the worker is blocked', () => {
  const root = fixture();
  // Offline with an empty npm cache, so npm behaves the same on every machine. Which error
  // npm reports first (lockfile out of sync, or package not cached) depends on its version
  // and cache, so the test checks that a real install ran and failed, not npm's wording.
  const cache = mkdtempSync(join(tmpdir(), 'session-setup-npm-cache-'));
  const env = {
    CLAUDE_CODE_REMOTE: 'true',
    FACTORY_SETUP_GATE: 'enforce',
    npm_config_offline: 'true',
    npm_config_cache: cache,
  };
  try {
    // Control: unchanged files are a cache hit.
    assert.equal(cli(root, ['--hook'], { session_id: 's0' }, env).status, 0);
    assert.equal(readStatus(root).status, 'ok');
    assert.equal(readStatus(root).install, 'cache hit');

    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    manifest.devDependencies['left-pad'] = '^1.3.0';
    writeFileSync(join(root, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
    const h = cli(root, ['--hook'], { session_id: 's1' }, env);
    assert.equal(h.status, 0, h.stderr);
    assert.equal(JSON.parse(h.stdout).continue, false);
    const status = readStatus(root);
    assert.equal(status.failedStep, 'dependencies');
    // A cache hit would have passed this step; this detail only comes from a real npm ci that failed.
    assert.match(status.steps.at(-1).detail, /^npm ci exited [1-9]\d*: \S/);
    assert.equal(cli(root, ['--gate'], { session_id: 's1' }, env).status, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cache, { recursive: true, force: true });
  }
});
