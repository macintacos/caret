---
name: release-caret
description: Cut a caret release. Computes the next version with the deterministic release script, confirms it, authors the keepachangelog CHANGELOG entry under a themed release name, then drives the two-phase script flow — phase 1 opens a PR with the version bump + changelog; after merge, phase 2 tags trunk and publishes the GitHub Release. Triggers on "/release-caret", "release caret", "cut a caret release", "ship a caret version".
---

# Release caret

Cut a caret release by orchestrating `scripts/release/cli.ts`. The script owns every judgment-free step — version math, version-file edits, the commit range, all `git`/`gh` operations — and is the **sole source of the version number**. Your only jobs are: (1) confirm the version the script computes, (2) author the `CHANGELOG.md` prose, and (3) orchestrate the two phases. **Never invent, compute, or alter the version yourself** — always take it from the script's JSON.

The script is invoked directly so its stdout is pure JSON:

```sh
bun scripts/release/cli.ts <subcommand> [args]
```

Every invocation prints exactly one JSON object on stdout. Parse it. A `{ "ok": false, "errorCode": "...", "message": "..." }` object (or a non-zero exit) means **abort**: surface `message` to the user and stop. Never proceed past a failed script call.

## Arguments

`/release-caret [patch|minor|major] [dry run]`

- The bump level (`patch`/`minor`/`major`) is required for a phase-1 release; it is ignored in phase 2 (the script derives the finalized version from trunk).
- If the user says "dry run" (or passes `--dry-run`), pass `--dry-run` through to every mutating call and **never** pass `--yes`. A dry run prints what would happen and changes nothing.

## Which phase am I in?

Releases run in two phases across two separate invocations, both started from a clean, **up-to-date** `trunk`. `compute` reads local state, so pull trunk before releasing — and again after the PR merges, before Phase 2. Detect the phase by running the version oracle once:

```sh
bun scripts/release/cli.ts compute <bump>
```

- **`ok: false` with `errorCode: "NO_BASELINE"`** → no release tags exist yet → run **Phase 1**, starting at step 1 (offer to lay down the baseline), then re-run `compute`.
- **`ok: false` with any other `errorCode`** (`DIRTY_TREE`, `WRONG_BRANCH`, `DETACHED_HEAD`, `MANIFEST_DRIFT`, `NO_GH`, `NOT_A_REPO`) → surface `message` and stop; fix the precondition (usually clean or pull trunk) first.
- **`ok: true` and `currentVersion === previousVersion`** → the manifests still match the latest release tag, so no prepared bump is merged → run **Phase 1**.
- **`ok: true` and `currentVersion !== previousVersion`** → the manifests are ahead of the latest tag, i.e. a prepared bump is already merged on trunk awaiting its tag → run **Phase 2**.

---

## Phase 1 — open the release PR

### 1. Baseline (first release only)

If phase detection returned `NO_BASELINE`, there are no release tags yet — the first release needs `v0.0.1` on the repository's initial commit so future releases have a range to bump from. Ask:

> **No baseline tag exists yet.** The first release tags the repository's initial commit as `v0.0.1` so future releases have a range to bump from.
>
> - **Tag the initial commit as v0.0.1** — runs `baseline`, pushing the tag.
> - **Cancel**

On confirmation, run `bun scripts/release/cli.ts baseline --yes` (or `--dry-run` for a dry run), then re-run `compute <bump>`.

Otherwise you already have the successful `compute` result from phase detection. From it, keep: `currentVersion`, `version`, `tag`, `commits[]`, `compareUrl`, `unreleasedCompareUrl`.

### 2. Confirm the version (AskUserQuestion #1)

Surface the **script-computed** version for explicit confirmation. Show the concrete numbers — never paraphrase them:

> **Release `<version>`?** Bumping `<currentVersion>` → `<version>` (`<bump>`), covering `<N>` commits since `<previousTag>`.
>
> - **Release `<version>`** (Recommended)
> - **Cancel the release**

Use the version verbatim from the JSON. If the user cancels, stop.

### 3. Author the changelog

Pick a short, evocative **theme** for the release by reading `commits[]` — the one or two words that capture what this release is really about (e.g. "Foundations", "Plan Review", "Polish"). Then author `CHANGELOG.md` in [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) format.

The section heading **must** be exactly this shape so the script can parse the themed title back out for the commit, PR, and GitHub Release:

```text
## [<version>] - <YYYY-MM-DD> - The <Theme> Release
```

- If `CHANGELOG.md` does not exist, create it with the standard header (title, intro line linking Keep a Changelog and semver, and an `## [Unreleased]` section).
- Move the `[Unreleased]` entries under the new `## [<version>] - <DATE> - The <Theme> Release` heading; use today's date.
- Group the work under the standard categories (`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`) — write human-readable entries derived from `commits[]`, not raw commit subjects.
- Reseed a fresh, empty `## [Unreleased]` above the new section.
- Maintain the link-reference footers at the bottom, using the URLs from the script:
  - `[Unreleased]: <unreleasedCompareUrl>`
  - `[<version>]: <compareUrl>`

Author this **before** the next step — `prepare` aborts with `CHANGELOG_MISSING` if the `[<version>]` section is absent.

### 4. Confirm the remote mutation (AskUserQuestion #2)

This is the second, separate gate the release contract requires — beyond the version confirmation:

> **Open the release PR for `<title>`?** This bumps the three manifests, commits the bump + changelog, pushes `release/<tag>`, and opens a PR against `trunk`.
>
> - **Push and open the PR** (Recommended)
> - **Cancel**

(`<title>` is `v<version> - The <Theme> Release`.) Only after the user confirms do you pass `--yes`.

### 5. Run prepare

```sh
bun scripts/release/cli.ts prepare <bump> --yes      # real
bun scripts/release/cli.ts prepare <bump> --dry-run  # dry run (no --yes)
```

Parse the result and report the `prUrl`. Tell the user: once the PR is reviewed and merged, re-run `/release-caret` to finalize (tag trunk + publish the GitHub Release).

---

## Phase 2 — tag and publish

### 1. Preview the finalize

```sh
bun scripts/release/cli.ts finalize --dry-run
```

This fetches `origin/trunk` and returns the concrete `version`, `tag`, `title`, and `taggedSha` (trunk's merged HEAD) without mutating anything. If it instead returns `ok: false` with `NOT_MERGED`, the bump isn't on `origin/trunk` yet — tell the user to merge the Phase 1 PR (and pull trunk) first, then stop.

### 2. Confirm the remote mutation (AskUserQuestion)

> **Tag and publish `<title>`?** This tags trunk's merged HEAD (`<taggedSha>`) as `<tag>`, pushes the tag, and creates the GitHub Release from the `[<version>]` changelog section.
>
> - **Tag and publish** (Recommended)
> - **Cancel**

### 3. Run finalize

```sh
bun scripts/release/cli.ts finalize --yes      # real
bun scripts/release/cli.ts finalize --dry-run  # dry run
```

Parse the result and report the `releaseUrl`. The release is live.

---

## Guardrails

- The script computes and owns the version; you only confirm it. If a script call fails, stop and surface its `message` — do not retry with a hand-edited version or work around the guard.
- Author the changelog heading in the exact `## [<version>] - <DATE> - The <Theme> Release` shape, or `prepare`/`finalize` cannot recover the themed title.
- Two confirmations gate a real release — the version (Phase 1 step 2) and the remote mutation (Phase 1 step 4 / Phase 2 step 2). Pass `--yes` only after the remote-mutation confirmation. A dry run skips `--yes` entirely.
- The script is safe to re-run after a partial failure — it detects an existing branch, PR, tag, or release and resumes or no-ops. If a run is interrupted, just invoke `/release-caret` again.
