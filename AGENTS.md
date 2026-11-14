# AGENTS.md

caret is a tool-agnostic core plus one adapter axis — the coding agent it speaks to. It
routes that agent's plan to a human for review; a loopback daemon serves a Svelte UI.
Detailed contributor rules live in [`docs/agents/`](docs/agents/) and load **on demand**.
This file is the router that decides which ones a given change needs.

## Routing

Walk the `router` fence from `@working-on`, starting from the change you're about to make.
`what-does` fans out, so take **every exit whose label matches** — a change that spans
areas pulls in several. Load each matching file into context *before* you edit that area,
not after.

```router
@working-on: Working on caret
  > what-does
what-does: Load the file for every area the change touches
  core/adapter boundary, daemon routing and lifecycle (the service supervisor, bin/caret-launcher), @core shared modules > architecture-rules
  TS module shape: DI, file-split seams, zod boundaries, helpers, import aliases (@/) > typescript-rules
  Svelte UI in ui/: components, runes, state factories, CSS tokens > svelte-rules
  composing UI from shadcn-svelte components: compose-first norm, token bridge, icon swap, what stays custom > shadcn-rules
  how a plan is rendered: ui/src/lib/diffview/, the layer pipeline and its invariants, the preview renderer ui/src/lib/planMarkdown.ts, its source-line map ui/src/lib/planSourceMap.ts, its code-block highlight pass ui/src/lib/previewCode.ts, its reference-tagging pass ui/src/lib/previewRefs.ts, its comment slots ui/src/lib/previewComments.ts, its search ui/src/lib/previewSearch.ts, its mount ui/src/components/PlanPreview.svelte, the source/preview surface table ui/src/lib/planView.ts and the outline peek's copy of either surface ui/src/lib/peekSnippet.ts > plan-render-rules
  testing browser behavior: e2e vs. unit, the e2e harness > browser-testing
  where a backend test suite belongs under test/ > test-layout
  logging: levels, message style, redaction > logging-rules
  adding a config.toml key or CARET_* env var > settings-rules
  package.json: adding, moving, removing, or pinning a dependency > dependency-rules
  adding or working with vendored icons > icon-rules
  OpenCode adapter, plugin, or install (caret install) > opencode-integration
  pi adapter, extension, or install (caret install) > pi-integration
  rumdl: bumping its version, touching any of its three configs or invocations (repo hygiene, plan formatting, release notes), or scripts/tasks/dev/fake-plan.md > rumdl-rules
  documentation: which doc to update — README, the docs site's pages and nav (`zensical.toml`), the contributor pages (ARCHITECTURE, DEVELOPMENT), CONTRIBUTING, the docs/ router, or the doc map itself; whether a change needs a site page, and the docs-not-needed label > documentation-rules
  how caret looks, moves, sounds, or prints: colour, type, radius, motion, sound, empty/loading/error states, CLI and task output layout > readme
architecture-rules!: Load docs/agents/architecture-rules.md
typescript-rules!: Load docs/agents/typescript-rules.md
svelte-rules!: Load docs/agents/svelte-rules.md
shadcn-rules!: Load docs/agents/shadcn-rules.md
plan-render-rules!: Load docs/agents/plan-render-rules.md
browser-testing!: Load docs/agents/browser-testing.md
test-layout!: Load docs/agents/test-layout.md
logging-rules!: Load docs/agents/logging-rules.md
settings-rules!: Load docs/agents/settings-rules.md
dependency-rules!: Load docs/agents/dependency-rules.md
icon-rules!: Load docs/agents/icon-rules.md
opencode-integration!: Load docs/agents/opencode-integration.md
pi-integration!: Load docs/agents/pi-integration.md
rumdl-rules!: Load docs/agents/rumdl-rules.md
documentation-rules!: Load docs/agents/documentation-rules.md
readme!: Load design/README.md
```

## Verifying changes

`mise run preflight` is the fast local pre-push gate — lint, unit + shell tests, build,
the docs site build, and artifact smoke, run concurrently; it never runs e2e. The full
gate is the PR checks: CI runs all nine tasks, the whole e2e suite included, on every PR.
So when you change browser behaviour, run the affected spec yourself with
`mise run test e2e --json <path>` — preflight will not. When **you** (an agent) run
preflight, pass `--json`. `mise run preflight --json` replaces the live human display with
two compact JSON documents on stdout, one per line: a `start` document (the planned tasks,
why that set, plus the filters in effect) and a `result` document carrying each task's
status and `durationMs` and an overall `ok` boolean. The exit code is unchanged (`0` pass,
`1` fail).

**The gate scopes itself to your diff, so `ok` does not always mean all eight tasks ran.**
A change where every path is Markdown runs `lint` alone — plus `test unit` when it touches
one of the Markdown files a test reads from disk (listed in `MARKDOWN_READ_BY_TESTS` in
`scripts/preflight.ts`), and `docs:build` when it touches anything under `docs/`. Anything
else runs the full eight, as does an empty or unreadable diff. Read the `start` document's
`selection` object before you report a run as green: `{"narrowed": true, "reason": "…"}`
means you proved less than the whole gate, and `schemaVersion` is `2` precisely because
`ok` now means "every task that ran passed". `--full` forces all eight — it is the one
preflight flag that works without `--json` too. Note that `lint` always scans the whole
tree even when the gate narrows, so cross-file link fragments stay checked.

`mise run preflight --json` is the call you want almost every time.
**Failures show their output by default**, so you can act immediately — and if a task's
output is large it's abbreviated to its last 20 lines with `totalLines` and
`"truncated": true` so you know there's more. Passing tasks carry only their status and
`durationMs`, to keep the result small. The flags below turn that up; they compose and
only apply with `--json`:

- `-v` / `-vv` — turn up verbosity. `-v` makes any **truncated** failure full and adds a
  snippet of each passing task; `-vv` shows every task's full output. Reach for `-v` when
  a failure's tail was truncated and you need the whole log, or when you want to inspect a
  passing task.
- `--grep <regex>` — replace `output` with only the lines matching the pattern (plus
  `matchedLines`), scanning every in-scope task. Reach for it to pull specific lines (an
  error code, a file path) out of a large log without `-v`.
- `--task <name>` (repeatable) — scope output to the named task(s); they show full output
  (or, with `--grep`, the matching lines) and other tasks report status only. Reach for it
  when you know which task you're debugging.

An invalid `--grep` pattern emits an `{"event":"error"}` document and exits `2` without
running. Plain `mise run preflight`, the human-readable form, is the one documented in
`CONTRIBUTING.md`.

### Running a suite on its own

`mise run test` (unit), `mise run test e2e` (Playwright) and `mise run test bats` (the
hermetic shell suites under `scripts/`) are the entry points, and all three forward their
arguments, so `mise run test <path>` scopes the run to one file. On `bats` a named suite
replaces the default `scripts/` rather than joining it; `--filter <regex>` narrows within
whatever is selected. `mise run test mod` runs the Claude Code mod's kit tests under
`mod/` (`claude plugin test mod`) and forwards nothing; preflight skips it when `claude`
is not on PATH.

**`mise run test --json` is the call you want when you only need the verdict.** It emits
one JSON document on stdout and nothing else — every child, the UI build included, runs
captured — and the exit code is unchanged (`0` pass, non-zero fail):

```text
{"schemaVersion": 1, "target": "unit"|"e2e"|"bats"|"mod", "ok", "passed", "failed", "durationMs", "report"}
```

`ok` is the runner's own exit code, never re-derived from the counts.

**What rides along depends on the verdict**, the same discipline `preflight --json`
applies. A **passing** run is that envelope and nothing else — about 120 bytes, whether it
ran one file or all 4900. A **failing** run adds two fields: `report`, the runner's native
report nested unnormalised (JUnit XML as a string for `unit` and `bats`, Playwright's json
report as an object for `e2e`), and `output`, everything the runner wrote. Read `output`
first: it is the human-formatted stream. Both runners put the diagnosis in their XML too,
but out of `&#10;`-escaped attributes. `report` is `null` when the runner produced none,
and `output` still carries what it wrote, so a run that died early stays diagnosable.

A failing whole-suite run is large — the native report grows with the number of tests, so
scope the run when you can. `--verbose` restores the full stream; `--quiet` is a dot per
test plus failures in full, and is the default at a terminal — those dots are for a human
watching, so an agent piping the output wants `--json` or the `verbose` default instead.

**Caret's flags must precede the forwarded ones.** `mise run test --json <path>` is
parsed; `mise run test <path> --json` hands `--json` to `bun test`, because the forwarding
contract stops caret's own parsing at the first operand.

**Never bare `bun test`.** Those entry points carry `--conditions browser`, which bun
accepts only on the CLI; without it svelte resolves its server runtime and every UI
component file aborts at import, while the backend suite still passes — so a bare run
reports dozens of failures that have nothing to do with your change. They also carry
`--parallel`, which implies `--isolate`: each file gets a fresh global, where a bare run
shares one across files, so a file can pass under one form and fail under the other on
cross-file state. `bun run test` (the `package.json` script) carries both flags and is
fine; `bun test --conditions browser <path>` is the direct form. Why the flag cannot move
into `bunfig.toml`, and the guard that raises the actionable error:
`docs/agents/svelte-rules.md` § One runner.

### The docs gate

The `docs gate` PR check fails a PR that changes a user-visible path but no page the docs
site publishes. A change needs a site page when it changes something a page describes: a
CLI command, flag, help text, or output; what `caret install` sets up; a config key,
default, or `CARET_*` variable; the review page; the `/caret` command or a host plugin;
the theme file format; plan formatting; diagnostics; or the background service. Update
that page in the same change. Apply `docs-not-needed` only when the change leaves every
page accurate (a refactor, an internal subcommand, a test helper, a typo no page quotes),
with `gh pr edit <number> --add-label docs-not-needed`, and say in the PR body why no page
changed. Which paths count:
[`docs/agents/documentation-rules.md` § The docs gate](docs/agents/documentation-rules.md#the-docs-gate).
