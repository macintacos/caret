# OpenCode Integration (the spike)

Load this when working on caret's OpenCode support — the adapter
(`src/adapters/opencode/`), the plugin (`opencode/`), or the install path
(`caret install --target opencode`). It records the spike EXC-339 ran (a review of
OpenCode's plugin docs + source against what caret does in Claude Code) so the "is this
even possible, and how" reasoning is not lost.

## The headline: OpenCode is plugin-shaped, not command-hook-shaped

caret's Claude (and modelled Codex) adapters share a command-hook shape: the agent runs
`caret review`, pipes a hook payload on stdin, and reads a decision JSON on stdout (see
`architecture-rules.md` § the adapter axis). OpenCode does **not** fit that mold. It loads
an **in-process JS/TS plugin** — an npm package in the config's `plugin` array (how caret
installs; see § Distribution choice) or a module file under `{plugin,plugins}/` in a
config dir — that registers tools and mutates config inside OpenCode's own Bun runtime.
There is no per-event command hook to hang `caret review` off.

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

## Daemon warm-up: plan-agent parity, not session start (EXC-838)

The plugin warms caret's daemon by fire-and-forget spawning `caret prewarm` from its
`chat.message` hook whenever the message is addressed to a planning agent — the same
`isPlanningAgent` guard the review tool's `execute()` uses. It is the counterpart to
Claude Code's `PostToolUse`/`EnterPlanMode` prewarm hook, for which OpenCode offers no
equivalent event: absent this hook the daemon only comes up when the first
`caret_review_plan` call spawns `caret review`.

**Why not a plugin-load (session-start) warm.** EXC-838 proposed warming at true session
start — a `SessionStart` hook for Claude Code, a plugin-load warm here. Two measurements
killed it: a cold daemon spawn costs ~0.4 s (`caret prewarm` cold 0.52 s vs. warm 0.13 s),
and a warmed daemon **idle-exits after `[daemon].idle_ms`** (60 s by default; the value
lives in `src/config/settings.ts`, the timer in `src/daemon/server.ts`). A session-start
warm therefore only pays off when a plan is submitted within 60 s of session start — in
any real session the daemon has already exited and `caret review` re-spawns cold anyway.
The proposal bought ~0.4 s in a window that essentially never applies, at the cost of a
process spawn on every start / resume / clear / compact. Rejected for **both**
integrations: `hooks/hooks.json` deliberately has no `SessionStart` entry.

**Why per-message and unthrottled.** The same 60 s idle-exit rules out a once-per-session
warm here — it would be dead long before the plan lands. Warming on every plan-agent
message keeps the daemon up for the turn most likely to end in a `caret_review_plan` call,
and a detached `caret prewarm` against an already-warm daemon costs ~0.13 s in a
background process. No throttle, no per-session state.

**Two things the warm spawn must not get wrong.** It carries `CARET_AGENT=opencode` just
as the `review` spawn does — the warm is what stands the daemon up, and the daemon picks
its adapter from that env, so omitting it yields a claude-flavored daemon that the later
`caret review` reuses (`ensureDaemon` matches on build/version/state dir, not adapter),
offering OpenCode reviewers Claude's approve variants. And it registers its own `'error'`
handler: `spawn` emits `'error'` **asynchronously** (ENOENT on a bad `CARET_OPENCODE_BIN`
or a partial install), so the hook's synchronous `try`/`catch` cannot see it and an
unhandled `'error'` event would take OpenCode's whole process down.

Past that, the warm is best-effort in the same sense as `showToast` and
`realUpdateChecker` — a failure is a non-event, because the review path spawns the daemon
itself regardless. The spawn sits behind a `WarmRunner` DI seam beside `SpawnRunner` so
the hook's gating is unit-testable without a process; the two properties above live in the
production runner the seam hides, so `test/opencode/` pins them by driving the real runner
against a bad path and against a recording shim.

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
- **Packaging (`opencode/`)** — the plugin (`caret.plugin.ts`), its package entrypoint
  (`index.ts`, see § The export surface), and command files (`commands/*.md`). The plugin
  ships in the `@macintacos/caret` npm package and resolves its binary and version at
  runtime from that package (§ Runtime resolution + update check); only the command files
  still carry a substituted `__CARET_BIN__` marker.
- **Install (`caret install --target opencode`)** — adds `@macintacos/caret` to the user's
  OpenCode `plugin` array (comment-preserving, via `jsonc-parser` in `config-plugin.ts`)
  and deploys the `/caret:*` command **files**; `--uninstall` reverses both. OpenCode
  itself installs the package and its deps into its cache on the next start — caret writes
  no config-dir manifest and runs no `bun install`. `caret install --target claude`
  registers caret with Claude Code via its plugin CLI. The command lives in
  `src/commands/install/`: `index.ts` is the orchestrator (it parses `--target` — a comma
  list of the registry's ids — resolves the targets, and dispatches), beside the target
  registry, the chooser, the terminal reporter, and one module per target runner.
  `paths.ts` is the single source of truth both the probe (reader) and the writer resolve
  through.

## Distribution choice (amended by EXC-794)

caret installs into OpenCode as a first-class `plugin` array entry —
`plugin: ["@macintacos/caret"]` — which OpenCode `bun install`s (package + deps) into its
own cache and loads. The **package entrypoint is the plugin** (`package.json` `exports`
`.` → `opencode/index.ts`), so a **bare** specifier loads it: Bun's dynamic `import()`
does not support subpath imports, and OpenCode's `parsePluginSpecifier` yields only
`{ pkg, version }`, so a `@macintacos/caret/opencode` subpath is not viable. The plugin's
runtime import (`@opencode-ai/plugin`, for `tool.schema`'s zod — zod is not
cross-instance-compatible, so the `plan` arg must use OpenCode's zod) is a real
`dependency` now, so OpenCode's install provides it. The compiled caret binary stays lean
regardless: `src/` never imports `@opencode-ai/plugin`, so the bundler doesn't pull it in.

**EXC-794 amended the original decision.** The spike had rejected option (c) — "publishing
a second npm package + mutating the user's `plugin` array" — as too heavy. But caret
already publishes `@macintacos/caret`, so the array path needs **no second package**: that
one package's entrypoint is the OpenCode plugin, and it ships the whole caret runtime
(`bin/caret`, `dist/`, `ui/dist/`), so an array install is self-contained. This retired
the file-deploy machinery (the config-dir manifest, the caret-run `bun install`, and
`stripNonDefaultExports`). The other two rejected options still stand: (a) a
`permission.ask` per-edit gate (wrong semantic) and (b) re-implementing the daemon
round-trip in the plugin (duplication).

## Runtime resolution + update check (EXC-794)

The array install has no marker-substitution step, so the plugin resolves what it needs at
runtime from the package it ships in:

- **Binary** (`resolveCaretBin`): `CARET_OPENCODE_BIN` env override → a substituted marker
  (only the retired file-deploy set one) → `new URL("../bin/caret", import.meta.url)` (the
  `bin/caret` shim shipped beside the plugin in the package).
- **Version** (`resolveCaretVersion`): a substituted marker if present → the sibling
  `../package.json`'s `version`. Used by the update check.
- **Update check** (`realUpdateChecker`, wired only into the production default export):
  on load, fetch caret's latest GitHub release and toast a nudge when the running version
  is behind. Best-effort — a network error, a non-200, or the
  `CARET_OPENCODE_NO_UPDATE_CHECK` opt-out is silent. An inline semver compare keeps the
  plugin self-contained.

**How deps resolve now (vs. the retired manifest).** OpenCode installs the array package
and its declared `dependencies` into its cache, so `@opencode-ai/plugin` resolves because
caret's `package.json` declares it as a real dependency — no config-dir `package.json`
manifest and no caret-run `bun install`. The old manifest existed to sidestep a live
EXC-339 bug: OpenCode's startup dependency install pinned `@opencode-ai/plugin` to its OWN
version against a **date-capped registry snapshot** and could fail to resolve
(`"No matching version found … with a date before <date>"`), so caret wrote its own pinned
manifest. Installing the package as a normal array entry sidesteps that path entirely (a
version skew between the pinned `@opencode-ai/plugin` and the running OpenCode is
harmless: `tool()` is identity, `tool.schema` is just zod, the hook names are stable). A
fresh install still needs **one OpenCode restart** (packages install/load at startup).

## The export surface: a plugin module may export ONLY Plugin functions

OpenCode's plugin loader iterates a module's exports (`Object.values(mod)`) and throws
`TypeError("Plugin export is not a function")` on the FIRST export it cannot coerce to a
Plugin (a function, or a `{ server }` object) — one bad export rejects the whole module.
caret's plugin SOURCE (`caret.plugin.ts`) exports constants (`CARET_PLUGIN_VERSION`,
`REVIEW_TOOL`, `PLANNING_AGENTS`) and pure helpers so `test/opencode/` can unit-test them,
so it can't be OpenCode's entrypoint directly — the first non-Plugin export would reject
it (a live EXC-339 bug, log line
`failed to load plugin … "Plugin export is not a function"`).

So the package's entrypoint is a tiny dedicated re-export, `opencode/index.ts`:
`export { default } from "./caret.plugin.ts"` — its module namespace is exactly
`{ default }`, so `Object.values` yields only the Plugin function, and `package.json`
`exports` `.` points at it. (Before EXC-794 the file-deploy path instead stripped every
non-default export at deploy time via `stripNonDefaultExports`; the re-export entrypoint
isolates the invariant without a build step.) `test/opencode/entrypoint.test.ts` asserts
it.

## Verified vs. follow-up

**Verified in this repo (unit + integration tests, no live OpenCode required):** the
adapter's parse/emit/probe/fatal-deny; the plugin's pure logic + the tool's `execute()`
through a stubbed spawn runner (approve / deny / subagent-refusal); the config-hook
restriction; the `chat.message` warm hook (warms for the plan agent, not for a
build/unknown caller) and the production warm runner it hides (survives a bad binary's
async spawn error, and runs `prewarm` with `CARET_AGENT=opencode`); the entrypoint's
`Object.values`-single-Plugin invariant; the config-array editor (add/remove,
comment-preserving); `--target` parsing + dispatch; the `claude` target's CLI command
sequence; the runtime bin/version resolvers; and the update check (toasts when behind,
silent on error / opt-out).

**Confirmed against a live OpenCode (1.17.x) — pre-EXC-794 (file-deploy path):** that a
local plugin file resolves `@opencode-ai/plugin` only when a config-dir `package.json`
manifest is present. The array install's live round-trip (below) supersedes this.

**Documented manual follow-up (needs a live OpenCode + a model provider):** the array
install's live round-trip — add `@macintacos/caret` to a real OpenCode `plugin` array (or
run `caret install --target opencode`), restart 1.17.x, and confirm the package resolves,
`caret_review_plan` registers, the planning steer routes the Plan agent to it end-to-end,
and the update toast fires when the plugin is behind. This mirrors the Codex adapter's
live-contract follow-up (EXC-549) and the upgrade story tracked in EXC-383.

## Sources

- OpenCode plugin API: `@opencode-ai/plugin` (`packages/plugin/src/index.ts`, `tool.ts`) —
  `Plugin`, `Hooks`, `tool()`, `ToolContext`.
- OpenCode loaders: `packages/opencode/src/config/plugin.ts`
  (`{plugin,plugins}/*.{ts,js}`), `config/command.ts` (`{command,commands}/**/*.md`).
- OpenCode config: per-agent `permission`, `experimental.primary_tools`
  (`packages/core/src/v1/config/*`).
- Subagent bypass: sst/opencode#5894.
