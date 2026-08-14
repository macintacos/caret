# rumdl Rules

*Audience: coding agents and contributors touching anything rumdl — its version, one of
its configs, or one of its invocations.*

caret runs `rumdl` in **three roles**, under **three separate configs**. Only the
*version* is shared between them. The two most confusable are the rumdl that lints
**this repo's** markdown and the rumdl caret **downloads and ships to users** to format
their plans: same version, different binary, different config, different invocation — and
near-identical 90-column MD013 shapes, which is what makes them easy to mistake for one
setup. Work out which role you are in before you change anything — a divergence between
these configs is almost always deliberate, and "fixing" one breaks the reader it was tuned
for.

## The three roles

|  | Repo hygiene | Plan formatting | Release notes |
| --- | --- | --- | --- |
| **Who sees it** | contributors, CI, the pre-commit hook | **end users** — every plan caret renders for review | readers of a GitHub Release |
| **Binary** | mise-provisioned, on `PATH` | downloaded at runtime into `$XDG_STATE_HOME/caret/rumdl/`, sha256-verified, deliberately **off** `PATH` | mise-provisioned, reached via `mise x rumdl` so it resolves the same binary the format task uses |
| **Config** | `.rumdl.toml` — lint **and** format | `RUMDL_CONFIG`, a string constant in `src/plan/rumdl.ts`, rewritten into caret's state dir on every `ensureRumdl()` | inline `--config` flags only, no file |
| **Invocation** | `rumdl fmt {{ files }}` (format) and `rumdl check {{ files }}` (lint), both driven by `hk.pkl` over `**/*.md` and `**/*.markdown` | `rumdl fmt - --config <config>` over stdin | `mise x rumdl -- rumdl fmt - --config MD013.reflow=true --config MD013.line_length=9999999` over stdin |
| **Owns the detail** | `.rumdl.toml`, `hk.pkl` | `src/plan/rumdl.ts`, [`../CONFIGURING.md`](../CONFIGURING.md#plan-formatting-rumdl) | `scripts/tasks/release/rumdl.ts` |

Each of those files explains its own half well; this one exists for the *relationship*
between them, so read the owner for detail rather than expecting it restated here.

## Shared: the version, and only the version

`RUMDL_VERSION` in `src/plan/rumdl.ts` must equal the version `mise.lock` resolved for
`[[tools.rumdl]]`, and the four per-platform `ASSETS` checksums beside it must mirror
`mise.lock`'s. Note that `mise.toml` only asks for `rumdl = "latest"` — `mise.lock`, not
`mise.toml`, is what actually pins the repo-side binary.

They must agree because plan formatting is *tested* against one binary and *ships* with
another: the plan-formatter suite runs the **mise** one (`test/support/rumdl-preload.ts`
points `CARET_RUMDL_BIN` at whatever `rumdl` is on `PATH`, so unit tests skip the download
whenever that binary is the pinned one), while production runs the **downloaded** one. A
divergence lets a plan-formatting change pass its tests against a version end users never
receive.

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

`mise run dev` feeds this fixture through the plan-formatting role above, so it has to
keep the shape an agent actually writes: paragraphs and list items on single long lines.
Three `exclude` entries keep the repo-hygiene role away from it — one in `.rumdl.toml`,
one on each of the two rumdl steps in `hk.pkl` — so it never reaches that config at all.
`.rumdl.toml`'s own comment carries the rationale where a reader of that file needs it.

What belongs here is why the exclusion cannot be relaxed: the two configs do not
round-trip. `.rumdl.toml` measures link URLs, so it isolates a link-carrying line onto its
own line; the plan config exempts URLs from measurement and so never has cause to rejoin
it. Format the fixture under the repo config once and the plan config's output stops
matching what it produces from the agent's original — the fixture still looks fine and
silently stops exercising the divergence it exists to catch.

The exclusion holds even when the file is named directly: `rumdl check` on that path
reports it filtered out by exclude patterns and does nothing. `--no-exclude` is the one
way past — don't. If a format run ever rewraps the fixture, one of the three entries has
been dropped: revert the hunk and restore it.

## Bumping the version

One version moves; the three configs do not move with it.

```bash
mise up rumdl                                  # moves mise.lock's [[tools.rumdl]]
mise run test test/structure/rumdl-pin.test.ts # red once the lock actually moved
```

Then, in `src/plan/rumdl.ts`, set `RUMDL_VERSION` to the resolved version and replace all
four `ASSETS` checksums — darwin and linux, each arm64 and x64 — with the ones `mise.lock`
now carries. mise says `macos` where node says `darwin`, which is why `rumdl-pin.test.ts`
writes that mapping out rather than deriving it. Update the hard-coded version in
`doc/CONFIGURING.md` too — it appears in the `CARET_RUMDL_BIN` row and again in § Plan
formatting (rumdl).

Re-run the pin suite until green, then `mise run preflight --json --full`. A rumdl bump
can reformat markdown across the whole tree, and the whole-tree lint is what surfaces
that; when it does, `mise run format` applies the new binary's output and that reformat is
committed **with** the bump rather than left for the next change to trip over. The same
run also proves the new binary still produces the plan shape `test/core/plan/` pins.

## The file map

| File | What it carries |
| --- | --- |
| `mise.lock` | the real pin — `[[tools.rumdl]]` version plus per-platform checksums |
| `mise.toml` | `rumdl = "latest"`; the lock is what pins |
| `.rumdl.toml` | the repo-hygiene config, lint and format |
| `hk.pkl` | the repo-hygiene invocations, and the fake-plan exclusion |
| `src/plan/rumdl.ts` | `RUMDL_VERSION`, the `ASSETS` checksums, `RUMDL_CONFIG`, the download |
| `src/config/paths.ts` | where the downloaded binary and its config live |
| `src/commands/install/index.ts` | warms the download at install time, off the first plan's critical path |
| `scripts/tasks/release/rumdl.ts` | the release-notes invocation and its inline config |
| `doc/CONFIGURING.md` | the user-facing story, including hard-coded version mentions |
| `test/structure/rumdl-pin.test.ts` | the standing gate on the shared version |
| `test/support/rumdl-preload.ts` | points unit tests at the mise binary so they run offline |
| `bunfig.toml` | the `[test] preload` entry that actually runs that preload |
| `test/e2e/support/fixtures.ts` | hands e2e daemons a pinned binary; hard-fails on a mismatch |
