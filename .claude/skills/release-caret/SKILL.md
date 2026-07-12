---
name: release-caret
description: Cut a caret release. Computes the next version with the deterministic release script, confirms it once, authors the keepachangelog CHANGELOG entry under a themed release name, then drives the flow end-to-end — phase 1 opens a PR with the version bump + changelog, merges it, then phase 2 tags trunk, publishes the GitHub Release, and publishes the plugin to npm. Triggers on "/release-caret", "release caret", "cut a caret release", "ship a caret version".
argument-hint: "[patch|minor|major] [dry run]"
---

# Release caret

Cut a caret release by orchestrating the release subcommand group of the caret tasks CLI
(`bun scripts/tasks/cli.ts release <subcommand>`). The script owns every judgment-free
step — version math, version-file edits, the commit range, all `git`/`gh` operations — and
is the **sole source of the version number**. Your only jobs are: (1) confirm the version
the script computes — the single gate — (2) author the `CHANGELOG.md` prose, and (3)
orchestrate the full flow end-to-end: open the release PR, merge it, then finalize (tag,
GitHub Release, npm). Once the version is confirmed, everything after it runs without
further prompts. **Never invent, compute, or alter the version yourself** — always take it
from the script's JSON.

The script is invoked directly so its stdout is pure JSON:

```sh
bun scripts/tasks/cli.ts release <subcommand> [args]
```

Every invocation prints exactly one JSON object on stdout. Parse it. A
`{ "ok": false, "errorCode": "...", "message": "..." }` object (or a non-zero exit) means
**abort**: surface `message` to the user and stop. Never proceed past a failed script
call.

## Arguments

`/release-caret [patch|minor|major] [dry run]`

- The bump level (`patch`/`minor`/`major`) is required for a phase-1 release; it is
  ignored in phase 2 (the script derives the finalized version from trunk).
- If the user says "dry run" (or passes `--dry-run`), pass `--dry-run` through to every
  mutating call and **never** pass `--yes`. A dry run prints what would happen and changes
  nothing.

## Which phase am I in?

Releases run in two phases, both started from a clean, **up-to-date** `trunk`. In the
normal flow a **single invocation** runs both phases end-to-end — Phase 1 opens the PR,
the skill merges it (Phase 1 step 5), then Phase 2 tags and publishes — so no second
invocation is needed. Phase detection still matters for **resuming** an interrupted run:
`compute` reads local state, so pull trunk before releasing. Detect the phase by running
the version oracle once:

```sh
bun scripts/tasks/cli.ts release compute <bump>
```

- **`ok: false` with `errorCode: "NO_BASELINE"`** → no release tags exist yet → run
  **Phase 1**, starting at step 1 (offer to lay down the baseline), then re-run `compute`.
- **`ok: false` with any other `errorCode`** (`DIRTY_TREE`, `WRONG_BRANCH`,
  `DETACHED_HEAD`, `MANIFEST_DRIFT`, `NO_GH`, `NOT_A_REPO`) → surface `message` and stop;
  fix the precondition (usually clean or pull trunk) first.
- **`ok: true` and `currentVersion === previousVersion`** → the manifests still match the
  latest release tag, so no prepared bump is merged → run **Phase 1**.
- **`ok: true` and `currentVersion !== previousVersion`** → the manifests are ahead of the
  latest tag, i.e. a prepared bump is already merged on trunk awaiting its tag → run
  **Phase 2**.

`compute` is the phase oracle, but it needs a clean, up-to-date `trunk` (it guards the
branch and reads local state). When you're **resuming Phase 2** — e.g. still on the
`release/<tag>` branch Phase 1 left you on — `finalize --dry-run` is a valid alternative
probe: it tags `origin/trunk` regardless of your local branch, so it reports `NOT_MERGED`
while the bump isn't merged yet and `ok: true` (with the concrete `tag`/`taggedSha`) once
it is. Use it to detect Phase-2 readiness without switching back to trunk first.

---

## Running under plan mode

`/release-caret` mutates state behind a single confirmation gate — the version — so its
flow maps cleanly onto plan mode's single `ExitPlanMode` approval.
**Outside plan mode this section does not apply** — the version gate fires as the normal
`AskUserQuestion` written below. When you are invoked **under plan mode**, remap as
follows:

- **Version confirmation (Phase 1 step 2) folds into `ExitPlanMode`.** Don't raise a
  separate `AskUserQuestion` for the version — present the script-computed version
  (verbatim from `compute`'s JSON) inside the plan, and let plan approval stand in for
  that gate.
- **The changelog goes in the plan, not on disk yet.** Plan mode can't write
  `CHANGELOG.md`, so put the full proposed changelog (heading + entries) in the plan for
  review. Author it to disk for real **after** exiting plan mode, before `prepare`.
- **Plan approval IS authorization for the whole release.** There is no separate
  remote-mutation gate. Once you've exited plan mode and written the changelog to disk,
  proceed straight through `prepare` → merge the PR → `finalize`, passing `--yes` to the
  mutating calls — no further prompt. (Stop only on a script or `gh` error.)

---

## Phase 1 — open the release PR

### 1. Baseline (first release only)

If phase detection returned `NO_BASELINE`, there are no release tags yet — the first
release needs `v0.0.1` on the repository's initial commit so future releases have a range
to bump from. This first-release bootstrap is the **one** exception to the single-gate
rule (there is no computed version to confirm yet), so it asks its own one-time question:

> **No baseline tag exists yet.** The first release tags the repository's initial commit
> as `v0.0.1` so future releases have a range to bump from.
>
> - **Tag the initial commit as v0.0.1** — runs `baseline`, pushing the tag.
> - **Cancel**

On confirmation, run `bun scripts/tasks/cli.ts release baseline --yes` (or `--dry-run` for
a dry run), then re-run `compute <bump>`.

Otherwise you already have the successful `compute` result from phase detection. From it,
keep: `currentVersion`, `version`, `tag`, `date`, `commits[]`, `compareUrl`,
`unreleasedCompareUrl`, `manifests`. (`date` stamps the changelog heading; `manifests`
lists the version-bearing files the script mutates, so you never have to grep `steps.ts`
for them.)

### 2. Confirm the version — the single gate

This is the **one** confirmation a real release asks for. Accepting the version authorizes
the entire remainder of the flow — `prepare --yes`, merging the PR, and `finalize --yes` —
with no further prompts. Surface the **script-computed** version for explicit
confirmation. Show the concrete numbers — never paraphrase them:

> **Release `<version>`?** Bumping `<currentVersion>` → `<version>` (`<bump>`), covering
> `<N>` commits since `<previousTag>`. Accepting runs the whole release end-to-end: opens
> the PR, merges it, tags trunk, and publishes the GitHub Release + npm.
>
> - **Release `<version>`** (Recommended)
> - **Cancel the release**

Use the version verbatim from the JSON. If the user cancels, stop. After this point the
skill does not prompt again unless a step errors.

### 3. Author the changelog

Pick a short, evocative **theme** for the release by reading `commits[]` — the one or two
words that capture what this release is really about (e.g. "Foundations", "Plan Review",
"Polish"). Then author `CHANGELOG.md` in
[Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) format.

The section heading **must** be exactly this shape so the script can parse the themed
title back out for the commit, PR, and GitHub Release:

```text
## [<version>] - <YYYY-MM-DD> - The <Theme> Release
```

- If `CHANGELOG.md` does not exist, create it with the standard header (title, intro line
  linking Keep a Changelog and semver, and an `## [Unreleased]` section).
- Move the `[Unreleased]` entries under the new
  `## [<version>] - <DATE> - The <Theme> Release` heading, stamping `<DATE>` from
  `compute`'s `date` field verbatim. It is already UTC `YYYY-MM-DD` in the heading's
  required shape — never hand-pick, paraphrase, or recompute it.
- Group the work under the standard categories (`Added`, `Changed`, `Deprecated`,
  `Removed`, `Fixed`, `Security`) — write human-readable entries derived from `commits[]`,
  not raw commit subjects.
- Reseed a fresh, empty `## [Unreleased]` above the new section.
- Maintain the link-reference footers at the bottom, using the URLs from the script:
  - `[Unreleased]: <unreleasedCompareUrl>`
  - `[<version>]: <compareUrl>`

Author this **before** the next step — `prepare` aborts with `CHANGELOG_MISSING` if the
`[<version>]` section is absent.

### 4. Run prepare

The version gate (step 2) already authorized this — no separate confirmation. With the
changelog on disk, run:

```sh
bun scripts/tasks/cli.ts release prepare <bump> --yes      # real
bun scripts/tasks/cli.ts release prepare <bump> --dry-run  # dry run (no --yes)
```

Parse the result and keep `prNumber` and `prUrl`. Report the `prUrl`, then continue to
step 5 to merge it. (On a **dry run**, `prepare` opens no real PR — `prNumber` is null —
so skip step 5 and stop here.)

### 5. Merge the release PR

The skill merges its own release PR; there is no human-merge handoff. caret has no CI to
wait on, release does not gate on `mise run preflight` (verify locally before releasing),
and the repo merges via squash, so merge immediately:

```sh
gh pr merge <prNumber> --squash --delete-branch
```

If GitHub reports the PR's mergeability is still computing, wait briefly and retry once.
On a real merge failure (merge conflict, branch protection, not mergeable, auth),
**abort**: surface the `gh` error and work with the operator to resolve — do not force or
`--admin` around it. The squash lands the bump on `trunk`; Phase 2 picks it up from
`origin/trunk`. Skip this step entirely on a dry run.

---

## Phase 2 — tag, publish, and ship to npm

`finalize` tags `origin/trunk`'s merged HEAD after an unconditional fetch, so it runs from
**any** branch — including the `release/<tag>` branch Phase 1 leaves you on. You don't
need to switch back to trunk first. The publish-safety gates are a clean working tree and
the `NOT_MERGED` check that the bump is actually on trunk, not the working branch.

After tagging and creating the GitHub Release, `finalize` builds the run-from-source
bundle and **publishes the plugin to npm** (`@macintacos/caret`), because the
marketplace's plugin source is an npm source — that publish is what makes
`/plugin marketplace add macintacos/caret` resolve the new version (EXC-643). The npm step
is resume-aware: it is skipped when the version is already on the registry, so a re-run
after a partial failure completes cleanly. It needs the operator's existing `npm` auth
(e.g. `~/.npmrc` with publish rights to the `@macintacos` scope); if publish fails on
auth, set that up and re-run `finalize` — it reuses the existing tag/release and retries
only the publish.

### 1. Preview the finalize

```sh
bun scripts/tasks/cli.ts release finalize --dry-run
```

This fetches `origin/trunk` and returns the concrete `version`, `tag`, `title`, and
`taggedSha` (trunk's merged HEAD), and previews the npm publish, without mutating
anything. It confirms the squash-merge from Phase 1 step 5 actually landed: `ok: true`
means proceed. If it returns `ok: false` with `NOT_MERGED`, the merge didn't reach
`origin/trunk` (the `gh pr merge` failed or is still settling) — surface that and work
with the operator before continuing; do not run `finalize --yes`.

### 2. Run finalize

The version gate (Phase 1 step 2) already authorized this — no separate confirmation.
Provided the dry-run probe returned `ok: true`, run:

```sh
bun scripts/tasks/cli.ts release finalize --yes      # real
bun scripts/tasks/cli.ts release finalize --dry-run  # dry run
```

Parse the result and report the `releaseUrl` and whether `npmPublished` is true. The
release is live. After a real release (`--yes`), return the checkout to a clean, updated
`trunk`:

```sh
git switch trunk && git pull --ff-only
```

---

## Guardrails

- The script computes and owns the version; you only confirm it. If a script call fails,
  stop and surface its `message` — do not retry with a hand-edited version or work around
  the guard.
- Author the changelog heading in the exact
  `## [<version>] - <DATE> - The <Theme> Release` shape, or `prepare`/`finalize` cannot
  recover the themed title.
- One confirmation gates a real release — the version (Phase 1 step 2). Accepting it
  authorizes the entire remainder: `prepare --yes`, merging the PR
  (`gh pr merge --squash`), and `finalize --yes`, with no further prompts. A dry run skips
  `--yes` entirely and merges nothing. Stop only on a script or `gh` error.
- The script is safe to re-run after a partial failure — it detects an existing branch,
  PR, tag, or release and resumes or no-ops. If a run is interrupted, just invoke
  `/release-caret` again.
