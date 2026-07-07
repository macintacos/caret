# OpenCode Integration (the spike)

Load this when working on caret's OpenCode support — the adapter
(`src/adapters/opencode/`), the plugin (`opencode/`), or the install path
(`caret install-opencode`, `scripts/install.sh`). It records the spike EXC-339 ran (a
review of OpenCode's plugin docs + source against what caret does in Claude Code) so the
"is this even possible, and how" reasoning is not lost.

## The headline: OpenCode is plugin-shaped, not command-hook-shaped

caret's Claude (and modelled Codex) adapters share a command-hook shape: the agent runs
`caret review`, pipes a hook payload on stdin, and reads a decision JSON on stdout (see
`architecture-rules.md` § the adapter axis). OpenCode does **not** fit that mold. It loads
an **in-process JS/TS plugin** — a module under `{plugin,plugins}/*.{ts,js}` in a config
dir — that registers tools and mutates config inside OpenCode's own Bun runtime. There is
no per-event command hook to hang `caret review` off.

Crucially, **OpenCode has no `ExitPlanMode` equivalent to intercept.** It ships a stable
Plan agent and an experimental, CLI-only `plan_exit` tool, but neither is a robust,
version-stable gate a plugin can sit in front of. So caret cannot reuse its "intercept the
plan-approval event" trick here.

## The model caret uses: register a plan-review tool

The robust, version-stable way to gate on a plan in OpenCode is to
**register a dedicated plan-review tool** and steer the Plan agent to call it. caret does
this:

- The plugin registers a `caret_review_plan` tool
  (`tool({ description, args, execute })`).
- An `experimental.chat.system.transform` hook injects a planning steer telling the Plan
  agent to call `caret_review_plan` (and a `tool.definition` hook redirects the native
  `plan_exit` description toward it).
- The tool's `execute()` runs the review **synchronously and blocks** until the human
  decides, then returns an approval string or a change-request string (the reviewer
  feedback plus a resubmit instruction; the plan itself is not echoed back — the agent
  already has it in its own `caret_review_plan` args) as the tool result — the agent
  revises and resubmits on a change request. Returning the string *is* the block; OpenCode
  has no separate "pause" primitive.

This matches caret's "review the whole plan" semantic far better than OpenCode's
per-action `permission.ask` hook, which fires per edit/bash and would gate individual
actions, not the plan.

## The bridge: the plugin spawns `caret review`

caret does **not** re-implement the daemon round-trip inside the plugin. The tool's
`execute()` builds a small caret-defined envelope
(`{ session_id, cwd, tool_input: { plan, title } }`) and
**spawns `caret review` with `CARET_AGENT=opencode`**, piping the envelope on stdin and
reading the flat decision JSON (`{ behavior, feedback? }`) on stdout. That reuses the
entire existing daemon/review pipeline unchanged — the OpenCode plugin is the
OpenCode-side counterpart to Claude Code's `hooks.json`, which likewise spawns
`caret review`.

Because both ends of this wire are caret-owned (the plugin writes the envelope, the
`opencode` adapter renders the decision the plugin reads), the OpenCode adapter is the
*least* speculative of the three — there is no foreign agent wire format to model. The
pure logic (envelope build, fail-safe decision parse, config mutation, the spawn bridge)
lives in `opencode/caret.plugin.ts` behind a `createCaretPlugin({ run })` DI seam and is
unit-tested in `test/opencode/`.

## The subagent bypass, and how caret mitigates it

OpenCode's `tool.execute.before` hook **does not fire for tool calls made by subagents**
(the `task` tool) — a known gap (sst/opencode#5894). A gate that relies only on that hook
can be bypassed by delegating to a subagent. caret therefore does **not** rely on a hook
firing for subagents. The `config` hook restricts the review tool to primary agents — it
adds `caret_review_plan` to `experimental.primary_tools` (blocking subagents) and sets
per-agent `permission` (`allow` on `plan`, `deny` on `build`) — and the tool body
re-checks the caller (`isPlanningAgent`). Defense in depth: even if a future OpenCode
version changes hook propagation, the primary-tools restriction plus the in-body check
still hold.

`applyCaretConfig` is idempotent and preservation-safe (it keeps existing `primary_tools`,
agent modes, and other permissions) and normalizes the degenerate "permission is a bare
string" shape before writing, so it can't corrupt a user's config.

## How it maps onto caret's two-layer split

- **Adapter (`src/adapters/opencode/`)** — the wire + probe, mirroring
  `src/adapters/codex/`: `parseHookInput` (the envelope), `emitDecision` (the flat
  decision), a single `default` approve variant, `fatalDenyLine`, and
  `readOpencodeInstallState` (a read-only probe of OpenCode's config dir). Registered in
  `src/adapters/index.ts`; selectable via `CARET_AGENT=opencode`. Claude stays the
  default.
- **Packaging (`opencode/`)** — the deployable plugin (`caret.plugin.ts`) and command
  files (`commands/*.md`), with `__CARET_VERSION__` / `__CARET_BIN__` markers substituted
  at install time.
- **Install (`caret install-opencode` + `scripts/install.sh`)** — drops caret's plugin and
  command files as auto-loaded **files** into OpenCode's config dir,
  **plus a `package.json`** declaring the plugin's one npm dependency (see § The
  dependency manifest), and **never mutates the user's `plugin` config array**, so a
  pre-existing array of third-party plugins is untouched. The `package.json` is
  merge-safe: caret owns only its single `dependencies` entry and `--uninstall` removes
  just that (deleting the file only when caret's dep was the only thing in it). `paths.ts`
  is the single source of truth both the probe (reader) and the deploy (writer) resolve
  through.

## Distribution choice

The plugin is shipped as a single self-contained `.ts` file (OpenCode loads `.ts`
directly) that imports only `node:child_process` and `@opencode-ai/plugin`. `src/` never
imports `@opencode-ai/plugin` (it is caret's only `devDependency`, for typecheck/tests
only), so the compiled caret binary stays lean — caret installs that dependency into
OpenCode's config dir at install time (see § The dependency manifest). Using OpenCode's
own `tool.schema` (zod) is deliberate: zod schemas are not cross-instance-compatible, so
the tool's `plan` arg must be declared with OpenCode's zod, not a bundled copy.

This was chosen over (a) a `permission.ask` per-edit gate (wrong semantic), (b)
re-implementing the daemon round-trip in the plugin (duplication), and (c) publishing a
second npm package + mutating the user's `plugin` array (heavier, and publish is a release
step).

## The dependency manifest (how the plugin's import resolves)

A local plugin file is not magically given its npm imports. OpenCode's contract for a
plugin that imports an npm package is: declare it in a
**`package.json` in the config dir**, which a `bun install` then fetches. So
`caret install-opencode` writes that manifest (pinning `@opencode-ai/plugin`) and
**runs `bun install` in the config dir itself** — best-effort, degrading to a printed
instruction if `bun` is absent.

**Why caret installs it rather than letting OpenCode.** OpenCode does run a startup
"background dependency install", but in practice it pins `@opencode-ai/plugin` to its OWN
version (e.g. `1.17.7`) and resolves against a **date-capped registry snapshot**, so that
version can fail to resolve —
`"No matching version found for @opencode-ai/plugin@1.17.7 with a date before <date>"` —
leaving the import unresolvable and the plugin unloaded (the agent then reports it has no
`caret_review_plan` tool). This was a live EXC-339 bug. caret's own `bun install` of the
pinned manifest sidesteps the date-cap; the manifest pins an
**older, already-published exact version** (`OPENCODE_PLUGIN_DEP_VERSION` in `paths.ts`).
A version skew between the pinned `@opencode-ai/plugin` and the running OpenCode is fine:
`tool()` is an identity function, `tool.schema` is just zod, and the hook names caret uses
are stable.

A fresh install still needs **one OpenCode restart** (plugins load at startup). The
npm-package distribution (publish + add to the `plugin` array) remains the documented
hardening path if this approach ever proves insufficient on a target OpenCode version.

## The export surface: a plugin module may export ONLY Plugin functions

OpenCode's plugin loader iterates a module's exports (`Object.values(mod)`) and throws
`TypeError("Plugin export is not a function")` on the FIRST export it cannot coerce to a
Plugin (a function, or a `{ server }` object) — one bad export rejects the whole module.
caret's plugin SOURCE exports constants (`CARET_PLUGIN_VERSION`, `REVIEW_TOOL`,
`PLANNING_AGENTS`) and pure helpers so `test/opencode/` can unit-test them; deployed
verbatim, the first string export made OpenCode reject the plugin and the tool never
registered (a second live EXC-339 bug, surfaced by the OpenCode log line
`failed to load plugin … "Plugin export is not a function"`).

So the install step renders the source and then
**strips every `export` keyword except `export default`** (`stripNonDefaultExports` in
`deploy.ts`), leaving the helpers as module-private locals — the deployed artifact exports
only its default Plugin function, its runtime behaviour unchanged. A test replicates
OpenCode's loader invariant against the real rendered source.

## Verified vs. follow-up

**Verified in this repo (unit + integration tests, no live OpenCode required):** the
adapter's parse/emit/probe/fatal-deny, the plugin's pure logic + the tool's `execute()`
through a stubbed spawn runner (approve / deny / subagent-refusal), the config-hook
restriction, `renderPlugin` ↔ install-probe agreement, and the installer's per-target
register selection (dry-run).

**Confirmed against a live OpenCode (1.17.x):** that a local plugin file resolves
`@opencode-ai/plugin` only when the config-dir `package.json` manifest is present (its
absence was the load failure documented in § The dependency manifest), and that with the
manifest in place the plugin loads, registers `caret_review_plan`, and applies its config
hook.

**Documented manual follow-up (needs a live OpenCode + a model provider):** a real
in-OpenCode agentic round-trip — confirming the exact `ctx`/`tool`/`config` shapes against
the installed OpenCode version and that the planning steer actually routes the Plan agent
to `caret_review_plan` end-to-end. This mirrors the Codex adapter's live-contract
follow-up (EXC-549) and the upgrade story tracked in EXC-383.

## Sources

- OpenCode plugin API: `@opencode-ai/plugin` (`packages/plugin/src/index.ts`, `tool.ts`) —
  `Plugin`, `Hooks`, `tool()`, `ToolContext`.
- OpenCode loaders: `packages/opencode/src/config/plugin.ts`
  (`{plugin,plugins}/*.{ts,js}`), `config/command.ts` (`{command,commands}/**/*.md`).
- OpenCode config: per-agent `permission`, `experimental.primary_tools`
  (`packages/core/src/v1/config/*`).
- Subagent bypass: sst/opencode#5894.
