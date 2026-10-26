# Workspace setup

Every cloud session on this repo starts from a fresh clone. This page says what the session needs, how it gets
it, and what happens when setup fails. The script is `scripts/session-setup.mjs`; the hooks that run it are in
`.claude/settings.json`.

## What the workspace needs

- **Node 22**, pinned in `.nvmrc`. Setup fails if the running Node has a different major version.
- **npm 10** (ships with Node 22).
- **Dependencies** installed exactly from `package-lock.json` with `npm ci --ignore-scripts`, as in CI (setup also
  passes `--prefer-offline --no-audit --no-fund`, which only skip network extras). Dependencies cannot run code
  while they install.
- **No services and no seed data.** The game runs entirely in the browser. Unit tests run in node; browser tests start their own `vite preview` server.
  If a service is ever added, it goes in the `SERVICES` list in the script with a readiness probe; it is started
  on every session start, because the environment cache keeps files, not running processes.

## Environment variables

None are required.

| Variable                  | Set by                       | Meaning                                                                    |
| ------------------------- | ---------------------------- | -------------------------------------------------------------------------- |
| `CLAUDE_CODE_REMOTE`      | Claude Code cloud sessions   | `true` in a cloud session. Outside one, the hooks do nothing.              |
| `FACTORY_SETUP_GATE`      | The factory cloud environment | `enforce` turns the setup guard on (see below). Unset or `off`: guard off. |
| `FACTORY_CONTRACT_DIGEST` | The factory controller       | Optional. The task contract digest that `npm run check` records.           |

Any other value of `FACTORY_SETUP_GATE` is treated as `enforce`, so a typo cannot silently switch the guard off.

## Secrets

This repo holds no secrets and needs none to build or test. Setup scans every tracked file before installing
anything and fails if it finds a secret-like file (`.env`, `.npmrc`, `*.pem`, `*.key`, SSH keys) or a token-shaped
string (Anthropic, GitHub, npm, AWS, private keys). It names the file and the kind of token, never the value.
`.env.example` is allowed. Never put keys in the cloud environment's setup script or in this repo.

## What runs when

1. **Environment setup script** (once per cached snapshot). Installs dependencies and checks the tools run. Its
   result is cached with the environment.
2. **Session start hook** (every session, `--hook`). Checks Node, scans for secrets, reuses `node_modules` if it
   matches `package.json`, the lockfile and the Node version (otherwise reinstalls), checks that TypeScript, Vitest, Vite, ESLint,
   Prettier and Playwright actually run, and starts services. It writes the result to `.factory/setup-status.json` and
   tells Claude the outcome and whether the guard is on. After a context compaction it keeps the same session's
   good result instead of running setup again.
3. **Tool guard** (`--gate`). Runs before shell commands, file edits, sub-agents and every connector (MCP) tool,
   such as GitHub. Only when the guard is on: blocks the call unless setup succeeded in this same session.
   Read-only built-in tools (reading and searching files) stay allowed so the worker can report what happened.

`node_modules/.factory-setup-stamp.json` records the `package.json` and lockfile hashes and the Node version of the
last good install. A changed `package.json` or lockfile, a different Node major or an interrupted install all mean no stamp match, so a reinstall.

## The setup guard

The guard exists for factory workers: a worker must not start a task in a broken workspace and then report task
failures that are really infrastructure failures. It is **off unless `FACTORY_SETUP_GATE=enforce`**, so people's
own cloud sessions on this repo are never locked.

| Setup result          | Guard on (factory worker)                                 | Guard off (anyone else)              |
| --------------------- | --------------------------------------------------------- | ------------------------------------ |
| Succeeded             | Tools allowed                                             | Tools allowed                        |
| Failed                | Asked to stop the session; tools blocked; told to report an infrastructure failure | Failure reported; nothing blocked |
| Killed or timed out   | Blocked (status still says "running")                     | Nothing blocked                      |
| Status from another session, missing, or unreadable | Blocked                     | Nothing blocked                      |
| Guard script errors, or its helper file is missing | Blocked (exit 2)             | Nothing blocked                      |

Not covered: if `node` itself cannot start, or the guard exceeds its 15 s hook limit, Claude Code lets the call
through. Both mean the workspace is far more broken than this guard is for, and the session start hook will
already have failed.

It fails closed in practice: an earlier cloud session that turned the guard on mid-session, without its start-up
check having run, was locked out of every shell command and edit and had to be handed over to a fresh session.

## Cloud environment setup script

For the factory's cloud environment. Paste as the environment's setup script and set the environment variable
`FACTORY_SETUP_GATE=enforce`. It finds the clone, then runs the prepare step with a time limit. If the repo is not
cloned yet when the script runs, it exits 0 and the session start hook does the install instead.

```bash
#!/bin/bash
set -u
REPO=""
for d in "$PWD" "$HOME"/factory-pilot-demo /home/*/factory-pilot-demo /workspace/factory-pilot-demo; do
  if [ -f "$d/scripts/session-setup.mjs" ]; then REPO="$d"; break; fi
done
if [ -z "$REPO" ]; then
  echo "factory-pilot-demo is not cloned yet; the session start hook will install dependencies."
  exit 0
fi
cd "$REPO" && timeout 240 node scripts/session-setup.mjs --prepare
```

No secrets go in this script.

## Measured times

Clean clones on a cloud session, Node 22.22, npm 10.9 (`scripts/session-setup.mjs` on this branch):

| Case                                                     | Result                                      | Time         |
| -------------------------------------------------------- | ------------------------------------------- | ------------ |
| Cold start: fresh clone, empty npm cache, session hook   | Fresh install, guard unlocks                | 3.3 to 3.6 s |
| Cache build: environment setup script on a fresh clone   | Install plus tool checks                    | 3.2 to 3.5 s |
| Cache hit: new session on the cached snapshot            | Reused, guard unlocks for that session only | 0.9 s        |
| Stale lockfile: lockfile changed after the snapshot      | Detected, reinstalled                       | 2.7 to 3.4 s |
| `package.json` changed, lockfile not updated            | No cache hit; `npm ci` refuses; worker blocked | about 1 s |
| Re-clone with a warm npm cache                           | Fresh install from cache                    | 2.4 to 2.7 s |
| Registry unreachable, empty cache                        | Fails at "dependencies"; worker blocked     | about 71 s   |
| Hook killed mid-install                                  | Status stays "running"; worker blocked      | n/a          |
| Not a cloud session                                      | Hooks do nothing                            | n/a          |

`npm run check` passes after setup (about 4 s). The install may take up to 240 s and the session start hook's
limit is 300 s. If setup runs past that limit the hook is killed, its status stays "running", and the guard
blocks.

## Not covered here

Running the same setup on a laptop (a local fallback) is out of scope; on a laptop, run `npm ci` and
`npm run check` as the README says.
