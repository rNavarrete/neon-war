# Checks

## The one command

```sh
npm run check
```

This runs `scripts/check.mjs`. It always runs the same steps, in this order, each with a fixed timeout:

1. format (`prettier --check .`)
2. lint (`eslint .`)
3. typecheck (`tsc --noEmit`)
4. test (`vitest run`)
5. build (`vite build`)
6. e2e (`playwright test`: builds the game, serves it with `vite preview` and runs `tests/browser/`)

It first checks that Node matches `.nvmrc` (22). Every step runs even if an earlier one fails, so you see all
failures at once. It exits 0 only when every step passes and the git tree is clean. There are no flags to skip
or narrow steps.

## What it records

`check-evidence.json` (gitignored) holds:

- the command (`npm run check`)
- the candidate commit, branch, and whether the tree was clean
- the contract digest and where it came from: `--contract-digest <sha256>`, `FACTORY_CONTRACT_DIGEST`, or, in CI
  on a pull request, the PR's own `Contract-Digest:` line (see Contract claim); `null` if none was given
- any problems with the PR's contract claim (`contractClaimErrors`)
- the check revision: check version, and SHA-256 hashes of the check script, the CI workflow, and every tracked
  file outside the content folders (see Control changes), so any config or tooling change shows up
- the environment: Node, npm, OS, and runner (`github-actions`, `local` or `cloud-worker`)
- each step's status, exit code, time, timeout and the end of its log
- the outcome: `pass` or `fail`

Full logs go to `check-logs/<step>.log`.

## How CI makes it authoritative

The CI workflow (`.github/workflows/ci.yml`) checks out the exact candidate commit (the PR head, not the merge
commit), runs `node scripts/check.mjs` directly with `NODE_OPTIONS` cleared (so nothing is preloaded into the
run), then runs `scripts/verify-evidence.mjs` against that commit. Verification fails
if the outcome is not `pass`, a required step is missing or did not pass (skipped or neutral count as missing),
the commit does not match (stale evidence), or the tree was dirty. The evidence and logs are uploaded as the
`check-evidence-<sha>` artifact.

In CI the e2e step is not run inside the `check` job: four shard jobs run it in parallel and the `check` job
records it from their results (see Sharded e2e). The evidence file looks the same either way.

Only a clean CI run on the exact candidate commit counts. A local run is useful, but it is not evidence.

## Contract claim

A pull request says which approved contract it is for by putting one line in its body:

```text
Contract-Digest: <64 hex characters, the SHA-256 of the contract>
```

A factory PR title starts with a marker such as `[ENG-12 a1 0123456789ab]`. The 12 hex characters in that marker
must be the start of the `Contract-Digest` value. The claim is rejected when:

- the title has a marker but the body has no valid `Contract-Digest` line
- the digest does not start with the marker's 12 hex characters
- the body has more than one `Contract-Digest` line

A value that is not exactly 64 hex characters never counts as a claim.

On pull requests CI runs the check with `--contract-claim-from-event`, which reads the PR title and body from
the GitHub event. A valid claim is recorded as the evidence's contract digest (source `pr-body`). A rejected
claim makes the check fail, and evidence with claim errors never verifies. A PR with no marker and no
`Contract-Digest` line simply records no digest.

The claim is only what the PR says about itself. CI records it; it does not decide whether it is the right one.

CI does not tie the evidence to an approved task. The controller does that by comparing the recorded digest
against the one it approved: it knows the approved contract digest
and runs `scripts/verify-evidence.mjs --expect-contract-digest <sha256>`. Verification then fails if the
evidence's contract digest is missing, `null` or different (the comparison ignores case). Without that flag a
`null` digest is accepted, so a CI pass on its own says nothing about which task it was for.

## Sharded e2e

The browser tests take about 27 minutes in one job, so CI splits them across four parallel `e2e` jobs (a matrix,
`shard: [1, 2, 3, 4]`). Playwright splits by test file.

1. Each shard job checks out the exact candidate commit and runs
   `node scripts/check.mjs --e2e-shard <n>/4`. That runs only the Node version check and
   `playwright test --shard=<n>/4`, and writes `check-evidence-e2e-shard-<n>.json`: the commit, whether the tree
   was clean, the check revision hashes, the shard number, both steps' results and the full e2e log. It uploads
   that file and `check-logs/` as `e2e-shard-<n>-<sha>`, and its screenshots as `screenshots-shard-<n>-<sha>`.
2. The `check` job waits for all four (it also runs when one failed, so the failure is recorded). It downloads
   the shard artifacts and runs `node scripts/check.mjs --e2e-from-shards <dir>`. Every other step runs there as
   usual. The e2e step is recorded as passed only if:
   - the set is complete: shards 1 to n, each exactly once, all saying the same n
   - every shard is for the same commit as this run
   - every shard has the same check revision (check script, workflow and config hashes) as this run
   - every shard had a clean tree, and its Node check and e2e step passed

   Anything else (a missing or duplicate shard, a file that cannot be read or parsed, another commit or config)
   fails the step, and its log says why. The step's command says it was merged from n shards, its time is the
   slowest shard's, and `check-logs/e2e.log` holds every shard's log in order.
3. The `check` job then verifies and uploads `check-evidence-<sha>` exactly as before, and merges the shard
   screenshots into one `screenshots-<sha>` artifact.

So the factory still gets one `check-evidence.json` with every step, and `verify-evidence.mjs` is unchanged. A
shard file is never accepted as check evidence on its own: it has no format, lint, typecheck, test or build
step.

`--e2e-shard` takes only `i/n` with whole numbers, 1 ≤ i ≤ n ≤ 8. It cannot be combined with
`--e2e-from-shards` or a contract digest, and it changes no timeout. Without either flag, `npm run check` runs
every step itself, e2e included, as before. The selftest runs the shard flow too: one shard set that must pass
and one with a shard never run, which must fail the e2e step.

Expected time with four shards, from measured per-file times: about 6.4, 7.7, 8.5 and 4.2 minutes of tests
(Playwright splits by file, and `board-live` alone is over 4 minutes). Add about 2 to 3 minutes per shard job to
install, fetch the browser and build, then 2 to 4 minutes for the `check` job, which starts when the slowest shard
ends. So CI takes about 13 to 15 minutes instead of about 27.

## The job to require

ENG-142's ruleset must require the **`verified`** job. It passes only when `e2e` (every shard), `check` and
`check-selftest` all succeeded. Skipped, cancelled or neutral counts as a failure.

## Control changes

A control change is any change that could weaken or redefine the check. The rule is deny by default: a changed
file is flagged unless it is in the content allowlist:

- `src/**`, `tests/**`, `docs/**`, `README.md`, `index.html`

So `.github/`, `scripts/`, `package.json`, `CLAUDE.md`, `.gitignore`, `.npmrc`, any root config file and any new
top-level file are all flagged.

Inside the allowlist, files that look like config are still flagged: dotfiles (such as `.prettierrc`, `.npmrc`,
`.eslintrc`), `CODEOWNERS`, `package.json`, `tsconfig*.json`, `*.config.*` (such as `vitest.config.ts`) and
`vitest.workspace*`.

Test and code changes are also flagged when they:

- delete a test file
- change an existing test file in any way, even by only adding lines. An added line such as an early `return`
  can switch off every assertion after it, so edits to existing tests always need Rolando's review. Only
  brand-new files under `tests/**/*.test.ts` are safe
- rename or move a test file (either side of the rename counts)
- add a test file outside `tests/**/*.test.ts`, such as `src/new.test.ts`, because the suite would never run it
- add `.skip`, `.only`, `.todo`, `.fails`, `skipIf`, `runIf` or `.concurrent.skip` / `.concurrent.only`
- add `@ts-nocheck`, `@ts-ignore`, `@ts-expect-error` or `eslint-disable` in any file

Plain edits to source, docs, `README.md` or `index.html`, and brand-new test files added under
`tests/**/*.test.ts` (without skips or suppressions), are not flagged.

On pull requests, the `control-change` job runs the classifier from the base branch, not from the PR, so a PR
cannot change the rules it is judged by. If the base branch has no classifier yet (true for the first PR that adds
it), the PR is flagged with "no trusted classifier on base branch".

This job only reports. It does not fail CI. It writes a warning and a summary, and Rolando's review of a flagged
PR is the actual gate. That stays true until ENG-142 turns on the ruleset with required code-owner review;
`.github/CODEOWNERS` routes protected paths to him for that.

## Cloud worker parity

A cloud worker proves it gets the same results as CI by running:

```sh
npm ci
node scripts/check-selftest.mjs
```

The selftest runs the unit tests for the evidence, control-change and contract-claim logic, then runs the real check on seeded
copies of the repo in temp dirs: one that should pass, and ones with a format error, a lint error, a type error, a
failing test and a dirty tree that should each fail in the right step. Two more cases feed it a fake pull
request event: one with a matching contract claim, which must pass and record the claimed digest, and one whose
title marker does not match the claim, which must fail. It prints a table, writes
`check-selftest.json`, and exits nonzero on any mismatch. It does not change the repo. CI runs the same script in
the `check-selftest` job.

A local fallback (treating a non-CI run as evidence) stays off until the cloud worker's selftest matches CI.

## Runtime

Measured on a cloud worker (Node 22): `npm run check` about 5 s; full selftest (unit tests plus eight seeded cases) about 40 s.

## Governance map

| ID   | Control                                                                 | Where                                                   |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------------- |
| G-B1 | One check command, nonzero on failure, records evidence                 | `scripts/check.mjs`, `check-evidence.json`              |
| G-B2 | Evidence counts only from a clean CI run on the exact commit            | `ci.yml` `check` job, `scripts/verify-evidence.mjs`     |
| G-B3 | Changes to gates, workflows, config or test assertions are flagged      | `scripts/control-change.mjs`, `control-change` job      |
| G-B4 | A candidate cannot quietly redefine its own evidence                    | control-change flag, `CODEOWNERS`, check revision hash  |
| G-B5 | Cloud worker and CI agree on seeded examples; fixed env and timeouts    | `scripts/check-selftest.mjs`, `.nvmrc`, step timeouts   |

## Known limits

- G-B4: the `check` job runs the PR's own copy of the workflow and scripts. A PR could change the check and still
  go green. The classifier runs from the base branch, so such a PR is flagged, but the flag does not block merge.
  Human review of flagged PRs is the real control until ENG-142 turns on the ruleset and code-owner review.
- The classifier works on file paths and diff lines. It can be fooled by a change it does not recognise, for example
  weakening behaviour in `src/` that the tests do not cover.
- The check revision hash shows what ran, but nothing compares it to a trusted baseline in CI yet.
  `verify-evidence.mjs --expect-check-revision` supports that when a baseline is stored outside the PR.
