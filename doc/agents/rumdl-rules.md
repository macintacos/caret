# rumdl Rules

*Audience: coding agents and contributors touching anything rumdl — its version, one of
its configs, or one of its invocations.*

caret runs `rumdl` in **three roles**, under **three separate configs**. Only the
*version* is shared between them. The two most confusable are the rumdl that lints
**this repo's** markdown and the rumdl caret **downloads and ships to users** to format
their plans: same version, different binary, different config, different invocation. Work
out which role you are in before you change anything — a divergence between these configs
is almost always deliberate, and "fixing" one breaks the reader it was tuned for.

## The three roles

|  | Repo hygiene | Plan formatting | Release notes |
| --- | --- | --- | --- |
| **Who sees it** | contributors, CI, the pre-commit hook | **end users** — every plan caret renders for review | readers of a GitHub Release |
| **Binary** | mise-provisioned, on `PATH` | downloaded at runtime into `$XDG_STATE_HOME/caret/rumdl/`, sha256-verified, deliberately **off** `PATH` | mise-provisioned, via `mise x rumdl` |
| **Config** | `.rumdl.toml` — lint **and** format | `RUMDL_CONFIG`, a string constant in `src/plan/rumdl.ts`, rewritten into caret's state dir on every `ensureRumdl()` | inline `--config` flags only, no file |
| **Invocation** | `rumdl fmt {{ files }}` (format) and `rumdl check` (lint), both driven by `hk.pkl` over `**/*.md` | `rumdl fmt - --config <config>` over stdin | `mise x rumdl -- rumdl fmt -` over stdin |
| **Owns the detail** | `.rumdl.toml`, `hk.pkl` | `src/plan/rumdl.ts`, [`../CONFIGURING.md`](../CONFIGURING.md#plan-formatting-rumdl) | `scripts/tasks/release/rumdl.ts` |

Each of those files explains its own half well; this one exists for the *relationship*
between them, so read the owner for detail rather than expecting it restated here.

## Shared: the version, and only the version

`RUMDL_VERSION` in `src/plan/rumdl.ts` must equal the version `mise.lock` resolved for
`[[tools.rumdl]]`, and the four per-platform `ASSETS` checksums beside it must mirror
`mise.lock`'s. Note that `mise.toml` only asks for `rumdl = "latest"` — `mise.lock`, not
`mise.toml`, is what actually pins the repo-side binary.

They must agree because the two halves are tested against different binaries: the
plan-formatter suite runs the **mise** one (`test/support/rumdl-preload.ts` points
`CARET_RUMDL_BIN` at whatever `rumdl` is on `PATH`, so unit tests never download), while
production runs the **downloaded** one. A divergence lets a plan-formatting change pass
its tests against a version end users never receive.

`test/structure/rumdl-pin.test.ts` is the standing gate that makes the lockstep
falsifiable: a `mise up rumdl` that moves the lock without moving `RUMDL_VERSION` and the
checksums fails `bun test` on the spot. `test/e2e/support/fixtures.ts` leans on the same
pin from the other side — it hands every e2e daemon a pre-resolved binary and
**hard-fails** when no `rumdl` reporting `RUMDL_VERSION` is available, rather than letting
each test download the release into its own state dir.

## Not shared: the configs, deliberately

Do not reconcile these. Each answers a different reader:

- **Plans exempt link URLs from measurement; the repo does not.** Both use a 90-column
  MD013 with `reflow-mode = "normalize"`, but `RUMDL_CONFIG` adds
  `reflow-length-exemptions = true` and `ignore-link-urls = true` (EXC-931). Plans are
  read in caret's review UI, which does not wrap, so a URL nobody can break only fragments
  the sentence around it; the repo's own markdown is read and edited in a text editor, so
  `.rumdl.toml` keeps measuring URLs.
- **The plan config carries no `[global]` lint rules at all.** It is formatting-only by
  construction — `rumdl fmt` applies fixes and won't fail on leftover lint. `.rumdl.toml`
  carries the lint half as well (`disable = ["MD033", "MD034", "MD041"]`,
  `respect-gitignore`, an `exclude` list) because `hk.pkl` drives a read-only
  `rumdl check` step from it.
- **Release notes are effectively unbounded.** `line_length = 9999999` with
  `reflow = true` collapses the agent's hard-wrapped body into single-line paragraphs,
  because GitHub renders hard wraps as awkward mid-sentence breaks.

## `scripts/tasks/dev/fake-plan.md` must stay un-rumdl'd

It is excluded twice — in `.rumdl.toml`'s `exclude`, and on **both** rumdl steps in
`hk.pkl` — so it never reaches rumdl at all. It stands in for a plan as an agent actually
writes one, paragraphs and list items on single long lines, and `mise run dev` feeds it
through the plan-formatting role above — caret's own reflow, not rumdl's repo config.
Formatting it here would pre-wrap it at 90 columns under a config with no reflow
exemptions, and caret's reflow never rejoins a line something else already broke, so the
fixture would silently stop testing the thing it exists to test.

The exclusion holds even when you name the file directly:
`rumdl check scripts/tasks/dev/fake-plan.md` reports `1 file found was filtered out` and
does nothing. `--no-exclude` is the one way past it — don't. If a format run ever rewraps
the fixture anyway, one of the two exclusions has been dropped: revert the hunk and
restore it.

## Bumping the version

One version moves; the three configs do not move with it.

```bash
mise up rumdl                                  # moves mise.lock's [[tools.rumdl]]
mise run test test/structure/rumdl-pin.test.ts # now red — that is the point
```

Then, in `src/plan/rumdl.ts`, set `RUMDL_VERSION` to the resolved version and replace all
four `ASSETS` checksums — darwin and linux, each arm64 and x64 — with the ones `mise.lock`
now carries. mise says `macos` where node says `darwin`, which is why `rumdl-pin.test.ts`
writes that mapping out rather than deriving it. Update the hard-coded version in
`doc/CONFIGURING.md` too — it appears in the `CARET_RUMDL_BIN` row and again in § Plan
formatting (rumdl).

Re-run the pin suite until green, then `mise run preflight --json --full`. A rumdl bump
can reformat markdown across the whole tree, and the whole-tree lint is what surfaces
that; the same run also proves the new binary still produces the plan shape
`test/core/plan/` pins.

## Where rumdl state lives

| File | What it carries |
| --- | --- |
| `mise.lock` | the real pin — `[[tools.rumdl]]` version plus per-platform checksums |
| `mise.toml` | `rumdl = "latest"`; the lock is what pins |
| `.rumdl.toml` | the repo-hygiene config, lint and format |
| `hk.pkl` | the repo-hygiene invocations, and the fake-plan exclusion |
| `src/plan/rumdl.ts` | `RUMDL_VERSION`, the `ASSETS` checksums, `RUMDL_CONFIG`, the download |
| `src/config/paths.ts` | where the downloaded binary and its config live |
| `scripts/tasks/release/rumdl.ts` | the release-notes invocation and its inline config |
| `doc/CONFIGURING.md` | the user-facing story, including hard-coded version mentions |
| `test/structure/rumdl-pin.test.ts` | the standing gate on the shared version |
| `test/support/rumdl-preload.ts` | points unit tests at the mise binary so they run offline |
| `test/e2e/support/fixtures.ts` | hands e2e daemons a pinned binary; hard-fails on a mismatch |
