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

## The model caret uses: register a plan-review tool (the plannotator pattern)

[plannotator](https://github.com/backnotprop/plannotator) — a cross-agent plan-review tool
with a working OpenCode plugin — solves the no-gate problem by
**registering its own tool** and steering the Plan agent to call it. caret adopts the same
shape:

- The plugin registers a `caret_review_plan` tool
  (`tool({ description, args, execute })`).
- An `experimental.chat.system.transform` hook injects a planning steer telling the Plan
  agent to call `caret_review_plan` (and a `tool.definition` hook redirects the native
  `plan_exit` description toward it).
- The tool's `execute()` runs the review **synchronously and blocks** until the human
  decides, then returns an approval string or a change-request string (with a
  line-numbered plan) as the tool result — the agent revises and resubmits on a change
  request. Returning the string *is* the block; OpenCode has no separate "pause"
  primitive.

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
  command files as auto-loaded **files** into OpenCode's config dir, and
  **never mutates the user's `plugin` config array**, so a pre-existing array of
  third-party plugins is untouched. `paths.ts` is the single source of truth both the
  probe (reader) and the deploy (writer) resolve through.

## Distribution choice (and its one live-verification risk)

The plugin is shipped as a single self-contained `.ts` file (OpenCode loads `.ts`
directly) that imports only `node:child_process` and `@opencode-ai/plugin`. The one
runtime dependency, `@opencode-ai/plugin`, is resolved by **OpenCode** at load time (it is
caret's only `devDependency` for typecheck/tests, and `src/` never imports it, so the
compiled caret binary stays lean). Using OpenCode's own `tool.schema` (zod) is deliberate:
zod schemas are not cross-instance-compatible, so the tool's `plan` arg must be declared
with OpenCode's zod, not a bundled copy.

This was chosen over (a) a `permission.ask` per-edit gate (wrong semantic), (b)
re-implementing the daemon round-trip in the plugin (duplication), and (c) publishing a
second npm package + mutating the user's `plugin` array (heavier, and publish is a release
step). The npm-package distribution remains the documented hardening path if local-file
resolution of `@opencode-ai/plugin` ever proves unreliable on a target OpenCode version.

## Verified vs. follow-up

**Verified in this repo (unit + integration tests, no live OpenCode required):** the
adapter's parse/emit/probe/fatal-deny, the plugin's pure logic + the tool's `execute()`
through a stubbed spawn runner (approve / deny / subagent-refusal), the config-hook
restriction, `renderPlugin` ↔ install-probe agreement, and the installer's per-target
register selection (dry-run).

**Documented manual follow-up (needs a live OpenCode + a model provider):** a real
in-OpenCode agentic round-trip — confirming the exact `ctx`/`tool`/`config` shapes against
the installed OpenCode version, that a local plugin file resolves `@opencode-ai/plugin` at
runtime, and that the planning steer actually routes the Plan agent to
`caret_review_plan`. This mirrors the Codex adapter's live-contract follow-up (EXC-549)
and the upgrade story tracked in EXC-383.

## Sources

- OpenCode plugin API: `@opencode-ai/plugin` (`packages/plugin/src/index.ts`, `tool.ts`) —
  `Plugin`, `Hooks`, `tool()`, `ToolContext`.
- OpenCode loaders: `packages/opencode/src/config/plugin.ts`
  (`{plugin,plugins}/*.{ts,js}`), `config/command.ts` (`{command,commands}/**/*.md`).
- OpenCode config: per-agent `permission`, `experimental.primary_tools`
  (`packages/core/src/v1/config/*`).
- Subagent bypass: sst/opencode#5894.
- plannotator's OpenCode plugin: `apps/opencode-plugin/` (the working precedent).
