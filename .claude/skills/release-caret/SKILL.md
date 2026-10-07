---
name: release-caret
description: Cut a caret release. Computes the next version with the deterministic release script, confirms it once, composes the GitHub Release notes, then drives the flow end-to-end — phase 1 opens a PR with the version bump, merges it, then phase 2 tags trunk, drafts the GitHub Release, and waits while CI stages the npm version; once the operator approves it with npm 2FA and npm serves it, the Release is published. Triggers on "/release-caret", "release caret", "cut a caret release", "ship a caret version".
argument-hint: "[patch|minor|major] [dry run]"
---

# Release caret

Cut a caret release by orchestrating the release subcommand group of the caret tasks CLI
(`bun scripts/tasks/cli.ts release <subcommand>`). The script owns every judgment-free
step — version math, version-file edits, the commit range, all `git`/`gh` operations — and
is the **sole source of the version number**. Your only jobs are: (1) confirm the version
the script computes — the single gate — (2) compose the release-notes body, and (3)
orchestrate the full flow end-to-end: open the release PR, merge it, then finalize (tag,
draft GitHub Release, and wait while CI stages the npm version), pause for the operator to
approve the staged version with npm 2FA, and publish the Release once npm serves it. Once
the version is confirmed, the only later stop is that approval pause (or an error).
**Never invent, compute, or alter the version yourself** — always take it from the
script's JSON.

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
- **`ok: true` and `currentVersion === previousVersion`** → first run
  `gh release view <previousTag> --json isDraft -q .isDraft`. `true` means that release is
  paused mid-Phase 2: resume at **Phase 2 step 2**, whose `finalize` result decides the
  rest (a non-null `approval` → step 3's pause, where the operator may already have
  approved and just says "continue"; `npmLive: true` → step 4). Otherwise the manifests
  still match the latest release tag, so no prepared bump is merged → run **Phase 1**.
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
- **The release notes go in the plan, not on disk yet.** Plan mode can't write files, so
  put the full proposed notes (theme line, category sections, compare link) in the plan
  for review. Write them for real **after** exiting plan mode, to a temp file outside the
  repo, before `prepare`.
- **Plan approval authorizes everything except the npm approval pause.** Once you've
  exited plan mode and written the notes to their temp file, proceed straight through
  `prepare` → merge the PR → `finalize`, handing `finalize` that file through
  `--notes-file` and passing `--yes` to the mutating calls. The npm approval pause (Phase
  2 step 3) and its "continue" always stop the run, plan mode included. Otherwise stop
  only on a script or `gh` error.

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
keep: `currentVersion`, `version`, `tag`, `previousTag`, `repoSlug`, `commits[]`,
`manifests`. (`commits[]` is the raw material for the release notes; `manifests` lists the
version-bearing files the script mutates, so you never have to grep `steps.ts` for them.)

### 2. Confirm the version — the single gate

This is the **one** confirmation a real release asks for. Accepting the version authorizes
the entire remainder of the flow — `prepare --yes`, merging the PR, `finalize --yes`, and
`publish --yes`. The only later stop is the npm approval pause (Phase 2 step 3). Surface
the **script-computed** version for explicit confirmation. Show the concrete numbers —
never paraphrase them:

> **Release `<version>`?** Bumping `<currentVersion>` → `<version>` (`<bump>`), covering
> `<N>` commits since `<previousTag>`. Accepting runs the whole release end-to-end: opens
> the PR, merges it, tags trunk, drafts the GitHub Release, waits for you to approve the
> npm stage with 2FA, then publishes the Release.
>
> - **Release `<version>`** (Recommended)
> - **Cancel the release**

Use the version verbatim from the JSON. If the user cancels, stop. After this point the
skill stops again only for the npm approval pause or an error.

### 3. Compose the release notes

The notes body's first line is the **theme line**: one or two sentences, read from
`commits[]`, saying what this release ships and what is worth trying. Name the net-new
features users haven't seen yet first, ahead of fixes and polish. It is a plain-language
digest, not a re-listing of the category sections under it.

Write it tight and direct, the way the category entries under it read. Lead with
`caret <version>` and a plain verb for what the release does — *adds*, *ships*, *fixes* —
then name the headline changes concretely, by what they are and what they now do. If a
second batch of changes is worth calling out, attach it as a second sentence stated just
as plainly (`It also …: a, b, c`); where a change's point isn't self-evident, pin it with
an em-dash or a `so` clause. Keep the register even and professional — the theme line
reports what shipped, so it needs no launch framing to sell it. Keep any metaphor or
filler clause written only to sound like an announcement out of it.

Given what shipped in v0.5.0, this reads in the right register:

> caret 0.5.0 adds first-run onboarding, a notification bell that flags a waiting plan and
> clears once you open it, and a confirmation step before you approve. It also polishes
> the review surface: steadier hover previews, a refined inline comment card, warmer
> light-theme greys, and room to scroll past the end of a plan.

The wordier alternative — opening on a metaphor ("rolls out the welcome mat") and closing
on a frame that carries no information ("a round of polish … rounds it out") — is what to
avoid.

Under the theme line, group the work into the standard keep-a-changelog categories
(`Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`) as `###` sections —
write human-readable entries derived from `commits[]`, not raw commit subjects.

A subject undersells its change, so read each PR's body
(`gh pr view <prNumber> --json title,body`, one per `commits[]` entry) for what a user now
sees. Then judge each change by what a user of the **published package** gets:

- **Gated work stays out.** A commit can keep shipped code dormant — v1.2.0's #643 kept
  OpenCode v2 out of the npm package while its code sat on trunk — so look for one before
  writing, and leave out everything it withholds.
- **A fix to a feature new in this release is not a `Fixed` entry.** Users never saw the
  bug; fold the fixed behavior into the feature's `Added` entry, or drop it.
- **Internal-only commits are omitted** — refactors, path aliases, dev dependencies, test
  and tooling changes — unless they change what a user sees.

The notes body's last line is the **compare link**, built from `compute`'s `repoSlug`,
`previousTag`, and `tag`:

```md
**Full Changelog**: https://github.com/<repoSlug>/compare/<previousTag>...<tag>
```

The tag doesn't exist yet while you write it; `finalize` pushes it before publishing, so
the link resolves on the published Release.

Write the whole body — theme line on top, then the category sections, then the compare
link — to one markdown file **outside the repo**: the session's scratchpad directory when
it has one, else `/tmp/caret-release-notes-<version>.md`. `finalize` guards on a clean
working tree with no allowlist, so an untracked notes file inside the repo would trip
`DIRTY_TREE` and abort the release. Phase 2 step 2 hands that path to `finalize` through
`--notes-file`.

### 4. Run prepare

The version gate (step 2) already authorized this — no separate confirmation. The script
titles the commit, the PR, the tag, and the GitHub Release `v<version>`.

```sh
bun scripts/tasks/cli.ts release prepare <bump> --yes      # real
bun scripts/tasks/cli.ts release prepare <bump> --dry-run  # dry run (no --yes)
```

Parse the result and keep `prNumber` and `prUrl`. Report the `prUrl`, then continue to
step 5 to merge it. (On a **dry run**, `prepare` opens no real PR — `prNumber` is null —
so skip step 5 and stop here.)

### 5. Merge the release PR

The skill merges its own release PR; there is no human-merge handoff. caret has no PR CI
to wait on, release does not gate on `mise run preflight` (verify locally before
releasing), and the repo merges via squash, so merge immediately:

```sh
gh pr merge <prNumber> --squash --delete-branch
```

If GitHub reports the PR's mergeability is still computing, wait briefly and retry once.
On a real merge failure (merge conflict, branch protection, not mergeable, auth),
**abort**: surface the `gh` error and work with the operator to resolve — do not force or
`--admin` around it. The squash lands the bump on `trunk`; Phase 2 picks it up from
`origin/trunk`. Skip this step entirely on a dry run.

---

## Phase 2 — tag, stage on npm, and publish

`finalize` tags `origin/trunk`'s merged HEAD after an unconditional fetch, so it runs from
**any** branch — including the `release/<tag>` branch Phase 1 leaves you on. You don't
need to switch back to trunk first. The publish-safety gates are a clean working tree and
the `NOT_MERGED` check that the bump is actually on trunk, not the working branch.

The GitHub Release body is the notes file you composed in Phase 1 step 3, passed through
`--notes-file` (step 2) and reflowed with `rumdl` to single-line paragraphs (the source is
hard-wrapped, which renders as awkward mid-sentence breaks on GitHub). A re-run
**without** `--notes-file` leaves an existing Release's notes untouched; a re-run with the
same file regenerates a byte-identical body, so nothing ever doubles.

`finalize` pushes the tag and creates the Release as a **draft**. The tag push triggers
the CI publish workflow, which builds and smoke-tests the bundle and **stages** the
version on npm (`@macintacos/caret`) over trusted publishing; `finalize` follows that run.
The Release stays a draft until npm serves the version, because the OpenCode update toast
reads `releases/latest` and must never announce a version OpenCode can't install.

### 1. Preview the finalize

```sh
bun scripts/tasks/cli.ts release finalize --dry-run --notes-file <path>
```

This fetches `origin/trunk` and returns the concrete `version`, `tag`, and `taggedSha`
(trunk's merged HEAD) without mutating anything. Pass the **same** `--notes-file` you will
pass for real, so a mistyped path fails here as `NOTES_MISSING` instead of on the real
run. It confirms the squash-merge from Phase 1 step 5 actually landed: `ok: true` means
proceed. If it returns `ok: false` with `NOT_MERGED`, the merge didn't reach
`origin/trunk` (the `gh pr merge` failed or is still settling) — surface that and work
with the operator before continuing; do not run `finalize --yes`.

A skill **dry run stops here**: `publish`'s preview needs the tag, which a dry run never
pushes.

### 2. Run finalize

The version gate (Phase 1 step 2) already authorized this — no separate confirmation.
Provided the dry-run probe returned `ok: true`, run it in the foreground with
`timeout: 600000`, since it waits on the CI run:

```sh
bun scripts/tasks/cli.ts release finalize --yes --notes-file <path>
```

On `ok: false`:

- **`CI_TIMEOUT`** — the run is still going; re-run the same command to resume.
- **`STAGE_ID_MISSING`** — the version is staged; only reading its id failed. Relay
  `message`. Re-running `finalize` retries the read; otherwise the operator approves with
  the id from the run page, then says "continue" and you go on to step 4.
- **`CI_FAILED`** or **`CI_NO_RUN`** — surface `message` verbatim: it names the run (when
  there is one) and the way out. Then stop.

On `ok: true`, `npmLive: true` means the version is already served (a resumed run); skip
to step 4.

### 3. Pause for npm approval

When `approval` is non-null, print:

- the exact command `npm stage approve <approval.stageId>`
- the `version`
- `approval.builtSha` beside `taggedSha`, for the record (the run is matched by that
  commit, so they always agree)
- `approval.runUrl`

Note that it can be run here as `! npm stage approve <stageId> --otp=<code>`, or in any
terminal. Then **wait for the operator to say "continue"**. This pause always stops the
run, under plan mode too. An approve the operator ran here that printed
`approved and published successfully` counts as "continue".

npm runs an automated review on a staged version before it accepts an approval, and an
approve sent too early fails with `E409 … automated review hasn't finished`, wasting the
operator's one-time code. `npm stage view <stageId> --json` reports
`"status": "validating"` while that review runs (several minutes for v1.2.0) and
`"staged"` once it can be approved. So check it before you print the approve command.
While it reads `validating`, say so, then poll in a background Bash command
(`run_in_background`) that exits on any other status:

```sh
bash -c 'while true; do s=$(npm stage view <stageId> --json 2>/dev/null | jq -r ".status // empty"); if [ -n "$s" ] && [ "$s" != validating ]; then echo "status: $s"; exit 0; fi; sleep 60; done'
```

On `staged`, tell the operator it is ready, with a push notification when that tool is
available, since they have likely stepped away. On any other status, surface it and stop.

### 4. Publish the Release

Run it in the foreground with `timeout: 600000`, since it waits on the registry to serve
the version:

```sh
bun scripts/tasks/cli.ts release publish --yes
```

On `NOT_LIVE`, tell the operator the version isn't live on npm yet and wait for "continue"
again, then re-run. On `ok: true`, report the published `releaseUrl`. The release is live.
Return the checkout to a clean, updated `trunk`:

```sh
git switch trunk && git pull --ff-only
```

### 5. Close the release's Linear ticket

A Linear automation mints an issue for the release PR — the one PR caret opens with no
`EXC-` ref in its title or branch — within a minute of `prepare`. It is born
**In Progress**, labelled `chore`, and carries the release PR (attachment title
`v<version>`) as its only attachment. Neither its creator nor its title identifies it: the
Linear MCP lists the operator as its creator, and the title wording drifts
(`Bump caret plugin version to 1.2.0`, `… to 1.1.0 in all manifests`,
`… to 1.0.0 for the release`). Which automation is not determinable from the API, and
Linear's docs describe no such feature; what IS established is that it never closes
itself. Across v0.11.0, v0.11.1 and v0.12.0 every one sat In Progress until a human
noticed — 21h, 1d19h, 2d11h. Closing it is this skill's job.

Find it by version and confirm it is the right one — its attachment URL must be the
release PR `prepare` reported — then transition it:

- `list_issues` with `query: "<version>"`, `label: "chore"` and `createdAt: "-P1D"`.
  `list_issues` returns no attachments, so for each candidate call `get_issue` with
  `fields: ["attachments"]` and keep the one whose attachment URL is `prUrl`.
- `save_issue` with that id and `state: "Done"`.

The version gate already authorized this; do not prompt. If no such issue exists, say so
and stop — do not close anything whose attachment is not the release PR. Skip this step
entirely on a dry run, which opens no PR for Linear to see.

---

## Guardrails

- The script computes and owns the version; you only confirm it. If a script call fails,
  stop and surface its `message` — do not retry with a hand-edited version or work around
  the guard.
- One up-front confirmation gates a real release — the version (Phase 1 step 2). Accepting
  it authorizes the entire remainder: `prepare --yes`, merging the PR
  (`gh pr merge --squash`), `finalize --yes`, and `publish --yes`. The one later stop
  besides a script or `gh` error is the npm approval pause (Phase 2 step 3). A dry run
  skips `--yes` entirely and merges nothing.
- Linear's auto-created release ticket is closed by Phase 2 step 5, never left open.
- The script is safe to re-run after a partial failure — it detects an existing branch,
  PR, tag, or release and resumes or no-ops. If a run is interrupted, just invoke
  `/release-caret` again.
