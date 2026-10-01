# OpenCode Integration (the spike)

Load this when working on caret's OpenCode support — the adapter
(`src/adapters/opencode/`), the plugin (`opencode/`), or the install path
(`caret install`). It records the spike EXC-339 ran (a review of OpenCode's plugin docs +
source against what caret does in Claude Code) so the "is this even possible, and how"
reasoning is not lost.

## The headline: OpenCode is plugin-shaped, not command-hook-shaped

caret's Claude (and modelled Codex) adapters share a command-hook shape: the agent runs
`caret review`, pipes a hook payload on stdin, and reads a decision JSON on stdout (see
`architecture-rules.md` § the adapter axis). OpenCode does **not** fit that mold. It loads
an **in-process JS/TS plugin** — an npm package in the config's plugin list — `plugin` on
v1, `plugins` on v2 (how caret installs; see § Distribution choice) or a module file under
`{plugin,plugins}/` in a config dir — that registers tools and mutates config inside
OpenCode's own Bun runtime. There is no per-event command hook to hang `caret review` off.

Crucially, **OpenCode has no `ExitPlanMode` equivalent to intercept.** It ships a stable
Plan agent and an experimental, CLI-only `plan_exit` tool, but neither is a robust,
version-stable gate a plugin can sit in front of. So caret cannot reuse its "intercept the
plan-approval event" trick here.

## The model caret uses: register a plan-review tool

The robust, version-stable way to gate on a plan in OpenCode is to
**register a dedicated plan-review tool** and steer the Plan agent to call it. caret does
this:

- The plugin registers a `caret_review_plan` tool. On v1 that is
  `tool({ description, args, execute })`; on v2 it is
  `ctx.tool.transform((tools) => tools.add({ name, description, input, options, execute }))`,
  with `input` a plain JSON Schema object (no zod at runtime) and
  `options: { codemode: false }`, without which v2 registers the tool only inside its Code
  Mode catalog. Both `execute`s are thin adapters over one host-neutral `runPlanReview`
  (`caret.plugin.ts`), which takes a small `ReviewHost` port — session id, base directory,
  `isSubagent`, `canEdit`, abort `signal`, `onUrl` — and both registrations read the same
  exported tool strings. v2's `execute` never throws: a rejection would skip v2's
  `execute.after` hooks, so every failure comes back as `{ content }` carrying the
  bridge's fail-safe deny.
- A hook injects a planning steer telling the Plan agent to call `caret_review_plan`. On
  v1 that is `experimental.chat.system.transform` (and a `tool.definition` hook redirects
  the native `plan_exit` description toward it); on v2 it is
  `ctx.session.hook("context")`, whose event carries the agent, so v2 needs no
  session→agent map and has no `plan_exit` to redirect. The session→agent map,
  `chat.message`, and the `plan_exit` rewrite are v1-only. The steer is pushed
  **only for the plan agent** — every other primary agent may call the tool but is not
  prompted toward it (§ The subagent bypass). Its text reads on both hosts: submit through
  `caret_review_plan` rather than end planning any other way, writing the plan file in the
  plans dir is the user's request (v2's own plan-mode reminder says not to create plan
  files unless asked), and pass the plan inline as `plan` when that file may not be
  written. With `path`, a change request means re-reading the file, revising it with
  targeted edits, and resubmitting the same `path`; an approved plan is already saved
  there.
- The tool's `execute()` runs the review **synchronously and blocks** until the human
  decides, then returns an approval string or a change-request string (the reviewer
  feedback plus a resubmit instruction; the plan itself is not echoed back — the agent
  already has it, in its own `caret_review_plan` args or its plan file) as the tool result
  — the agent revises and resubmits on a change request. Returning the string *is* the
  block; OpenCode has no separate "pause" primitive.
- The tool takes the plan as **exactly one of `path` or `plan`**. `path` is a `.md` file,
  resolved against the session directory. The steer asks for it and points the plan agent
  at a plans directory it may edit. The default is per host: on v1, OpenCode's data-dir
  `plans/` (OpenCode's `agent.ts` allows that and a project's `.opencode/plans/`); on v2,
  `~/.opencode/plan` — home-relative, not XDG — the only directory v2's plan agent may
  edit (`resolvePlansDir`'s `defaultDir`). caret's `[opencode] plans_dir` wins verbatim on
  both. The plugin reads that key from caret's `config.toml` itself when OpenCode loads it
  (`resolvePlansDir`, mirroring `configFile()`), since it cannot import `src/`. `plan` is
  the inline text. A `path` review gets the same plan-file treatment as Claude Code's:
  caret writes its canonical, reformatted text back onto the file at ingest and appends
  approval notes to it. So the change request tells the agent to re-read the file, edit
  it, and call again with the same `path`, and the approval tells it the plan is already
  saved. Each revision round then costs the agent targeted edits rather than a regenerated
  plan.

This matches caret's "review the whole plan" semantic far better than OpenCode's
per-action `permission.ask` hook, which fires per edit/bash and would gate individual
actions, not the plan.

### Why gating the steer needs a session→agent map

`experimental.chat.system.transform` receives only `{ sessionID?, model }` — **no agent**.
`chat.params` does carry `agent`, but fires **after** system.transform inside the same
`LLMRequestPrep.prepare`, so it cannot prime the current turn. The only hook carrying both
`sessionID` and `agent` *before* the transform is `chat.message`, which the plugin already
registers for the daemon prewarm. So `chat.message` records the session's agent into a
`Map` held in `createCaretPlugin`'s closure (injectable state, not a module global — see
`typescript-rules.md`), and system.transform reads it back. No eviction: one short string
per session, in a process already holding those sessions.

Two knock-on wins. OpenCode calls system.transform from a **second** site
(`Agent.generate`, generating an agent config) with no `sessionID` at all, so the gate
also stops the steer leaking into that unrelated prompt; and a session whose agent was
never observed gets *no* steer rather than a wrong one.

**Known gap, accepted.** A turn that reaches the model without a preceding `chat.message`
in this process — a resumed session's first synthetic turn — finds no map entry and skips
the steer. The safety net is already in place: the `tool.definition` hook rewrites
`plan_exit`'s description to point at `caret_review_plan`, and `plan_exit` is permitted
only on the `plan` agent, so the plan agent is still routed to caret even on a missed
steer.

That safety net does **not** make the steer redundant, and the two are not
interchangeable. The `plan_exit` rewrite is *reactive* — it only fires once the model has
already reached for `plan_exit`. The steer is *proactive*: it tells a model that would
otherwise just narrate its plan in prose to call the tool at all. Both are kept because a
model that never considers `plan_exit` is exactly the case the rewrite cannot catch.

## The bridge: the plugin spawns `caret review`

caret does **not** re-implement the daemon round-trip inside the plugin. The tool's
`execute()` builds a small caret-defined envelope
(`{ session_id, cwd, tool_input: { plan, planFilePath? } }`) and
**spawns `caret review` with `CARET_AGENT=opencode`**, piping the envelope on stdin and
reading the flat decision JSON (`{ behavior, feedback? }`) on stdout. That reuses the
entire existing daemon/review pipeline unchanged — the OpenCode plugin is the
OpenCode-side counterpart to Claude Code's `hooks.json`, which likewise spawns
`caret review`.

On a `path` call the plugin reads the file itself and sends its text along with the
resolved absolute path as `planFilePath`, which gives the envelope the same shape Claude
Code's hook sends. The core's plan-file guard, write-back, and notes append then run
unchanged. The plugin can't import `src/`, so it repeats the core's "`.md`, existing
regular file" check. It then checks `edit` permission on the file, the pattern being the
path relative to the session worktree: v1 asks OpenCode (`context.ask`); v2 evaluates
OpenCode's rules itself, as below. The core's plan-file guard assumes the agent wrote the
file itself, as Claude Code's does; here the model picks the string, so without that check
caret's write-back would bypass OpenCode's edit rules and rewrite a file the agent may not
edit. When the check fails or permission is refused, the plugin returns an error string to
the agent without spawning `caret review`. That is an error, not a deny: no review
happened.

**On v2 the check is evaluate-then-refuse**, because no v2 plugin API raises an
interactive permission ask. `opencode/permission.ts` copies OpenCode v2's `Wildcard.match`
and `Permission.evaluate` (its `*` crosses `/`, which `Bun.Glob` and `path.matchesGlob` do
not, and no published package exports the matcher) and mirrors the resource forming of
v2's `file-access.ts`. `editPermitted` evaluates the agent's rules (`ctx.agent.get`,
config `permission` already folded in), then the session's `permissions` — last matching
rule wins, default `ask` — for `edit` on the file, plus `external_directory` when the file
is outside the project, since that is OpenCode's own check for such a file. It permits
only when every evaluated effect is `allow`; a failed agent or session read refuses.
**An `ask` refuses** too, with the not-permitted text, which tells the agent to pass the
plan inline as `plan`: `ask` means "only with the user's consent", v2 gives a plugin no
way to obtain it, and proceeding would write without it.

Known limits of evaluate-then-refuse:

- **Stock v2 refuses a non-plan agent's out-of-project `path`.** Stock agent rules are
  `* * allow`, then `external_directory * ask`, so a `build` agent submitting
  `~/notes/plan.md` is refused and passes the plan inline — the review still happens,
  without the file write-back. In-project files fall through to `* allow`. v1 raises
  OpenCode's interactive ask instead.
- **Saved "always" grants are invisible to a plugin**, so caret may refuse a file OpenCode
  would allow; the inline hint applies.
- **Config and organization policy denies are invisible too**, so caret may proceed where
  a policy would deny.

All three close when upstream exposes a permission assert (anomalyco/opencode#46530).

Abort reaches the child on both hosts: `runPlanReview` passes the host's signal (v1's
`context.abort`, v2's `context.signal`) to the bridge, whose `spawn({ signal })` kills
`caret review`. An abort after the review-link toast replaces it with a neutral "caret:
review cancelled" toast — on v2 through the TUI half's `session.tool.failed` handler (§
The export surface).

Because both ends of this wire are caret-owned (the plugin writes the envelope, the
`opencode` adapter renders the decision the plugin reads), the OpenCode adapter is the
*least* speculative of the three — there is no foreign agent wire format to model. The
pure logic (envelope build, fail-safe decision parse, the spawn bridge) lives in
`opencode/review-bridge.ts`, which `opencode/caret.plugin.ts` wires behind a
`createCaretPlugin({ run })` DI seam, and is unit-tested in `test/opencode/`. The bridge
is shared: `caret mcp` (`src/commands/mcp.ts`) runs Claude Code's `review_plan` tool
through the same module, passing its own argv, `CARET_AGENT=claude-mcp`, and tool name, so
keep `review-bridge.ts` free of anything OpenCode-specific and of any import but node
builtins. `caret steer` (`src/adapters/claude/steer.ts`), Claude Code's title-steer hook,
is a third consumer: it imports only `PLAN_TITLE_INSTRUCTION`, the title steer the plugin
and `caret mcp` send too. The running-config mutation is `applyCaretConfig` in
`opencode/caret.plugin.ts`, and it is v1-only: v2 has no `config` hook (§ The subagent
bypass says what replaces it). `src/adapters/opencode/config-plugin.ts` edits the user's
config *file* at install time and is covered from `test/adapters/opencode/`.

## Daemon warm-up: plan-agent only, not session start (EXC-838)

The plugin warms caret's daemon by fire-and-forget spawning `caret prewarm` from its
`chat.message` hook whenever the message is addressed to a planning agent
(`isPlanningAgent`). It is the counterpart to Claude Code's `PostToolUse`/`EnterPlanMode`
prewarm hook, for which OpenCode offers no equivalent event: absent this hook the daemon
only comes up when the first `caret_review_plan` call spawns `caret review`.

On v2 the warm hangs off `ctx.session.hook("prompt")`. That event carries no agent, so the
hook reads it with `ctx.session.get` and calls the same production warm runner for a
planning agent — once per prompt. The hook is awaited, because the same pass writes the
plan-agent allow (§ The subagent bypass) and that must land before the step selects its
tools; the warm spawn itself is never awaited, so a prompt waits on in-process reads, not
on a process. The hook swallows every error: a rejected v2 hook fails the prompt that
triggered it. The warm runs in its own `try`, so a warm that throws still lets the allow
be written. v2 resolves a session's unset `agent` per step and never writes it back, so
the hook takes the first entry of `ctx.agent.list()` instead — v2 orders that list
default-first, by the same `selectedDefault` an unset session gets, though that order is
an implementation detail, not a contract — and a default `plan` warms and allows exactly
as an explicit one. A list that is unreadable or empty warms and allows nothing.

**Why the warm stays plan-only even though any primary agent may call the tool.** The plan
agent is the one whose turn *reliably* ends in a review; a `build`-agent review is an
explicit, occasional act. Warming on every `build` message would spawn a process on the
busiest traffic in the session to save ~0.4 s in the rare case — and the 60 s idle-exit
below means a warm triggered by an unrelated `build` message is usually dead before any
review lands anyway. So non-plan callers accept the cold spawn. `chat.message` therefore
does two things with different scopes: record the session's agent (always — that is what §
Why gating the steer needs a session→agent map reads back) and warm the daemon (plan
only).

**Why not a plugin-load (session-start) warm.** EXC-838 proposed warming at true session
start — a `SessionStart` hook for Claude Code, a plugin-load warm here. Two measurements
killed it: a cold daemon spawn costs ~0.4 s (`caret prewarm` cold 0.52 s vs. warm 0.13 s),
and a warmed daemon **idle-exits after `[daemon].idle_ms`** (60 s by default; the value
lives in `src/config/settings.ts`, the timer in `src/daemon/liveness.ts`). A resident
daemon — the service `caret install` registers, or `caret serve` — never idle-exits, and
that is orthogonal to the per-message-versus-session-start tradeoff below. A session-start
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
firing for subagents. Two mechanisms, both independent of hook propagation:

- **`experimental.primary_tools`** — the enforcing gate. The `config` hook adds
  `caret_review_plan` to that array, and OpenCode's `task` tool turns every entry into an
  explicit `{ permission, pattern: "*", action: "deny" }` rule injected into the
  subagent's session at creation. Subagents cannot call the tool at all.
- **The in-body session check** — second-line defense. `execute()` reads the calling
  session and refuses when it has a `parentID`. The signal is the session *shape*, not the
  agent name: `task` always creates a child session, so a `parentID` is an exact,
  mode-independent marker — where an agent-name test is not, since a user-defined agent
  defaults to `mode: "all"` and is legitimately both primary and subagent.

**The tool is available to every primary agent.** It grants no permission and gates no
edit, so a narrow permission never prevented unreviewed work — a `build` agent could
always ship without calling it. All a narrow permission did was stop an agent from
*voluntarily* asking for a review, which is the opposite of what caret wants. The workflow
this unblocks: skills that must run under `build` (they write outside what OpenCode's
`plan` agent permits) can hand their plan to caret's review UI. It stays a plan-review
tool: caret reflows what it receives into its plan layout, so other markdown does not
belong there.

**The in-body check's failure fallback is `allow`,** deliberately inverting this file's
usual fail-safe-deny rule. That rule governs review *decisions*, where a deny stops
unreviewed work from shipping. Here a refusal would not prevent unreviewed work; it would
only remove the review option from every primary caller the moment the SDK shifts — the
exact failure this widening exists to remove. So a missing client, an absent
`session.get`, an error payload, and a thrown request all fall through to permitting the
call, and `primary_tools` carries the enforcement.

**On v2 the enforcing gate is a per-request tool removal**, because v2 has no `config`
hook to write `primary_tools`. The #5894 gap is v1's `tool.execute.before`; v2's `context`
hook runs on every model request, child sessions included (live-verified), which is what
the removal relies on. The `context` hook reads the session and deletes
`caret_review_plan` from the request's `tools` when it has a `parentID`; v2 then neither
offers the tool nor accepts a call to it (both depend on `codemode: false`). It runs per
request, so it covers every agent mode and agents added later, with no creation-time race.
It fails open like the in-body check: an unreadable session keeps the tool, and the
in-body check still refuses a subagent call that slips through. The same hook then pushes
the planning steer, in a separate `try`, only while `caret_review_plan` is still in the
request's `tools`: a plan subagent loses the tool and gets no steer, a plan agent whose
tool the user disabled is not steered, and a failed steer cannot skip the removal. The
in-body check reads `ctx.session.get` once per call — `parentID` refuses, an unreadable
session allows — and that session's `location.directory` is the `path` base, falling back
to `ctx.location.directory`.

**On v2 the plan-agent allow is a session rule**, written by the awaited `prompt` hook (§
Daemon warm-up) for a plan-agent session. An agent-level transform would lose to a config
deny-all; a session rule is evaluated after the agent's rules, and v2 disables a tool only
when the *last* rule naming it is a `*` deny, so an appended
`{ action: "caret_review_plan", resource: "*", effect: "allow" }` outranks
`{ action: "*", resource: "*", effect: "deny" }`. `withPlanAllow` skips the write when the
agent's rules **or** the session's already name the tool by exact `action`: v2 folds the
user's config permissions into the agent's ruleset, so a session-only check would let
caret's allow override the user's own deny — what v1's `??=` prevents. A `*` catch-all
does not count; it is what the allow exists to override. The allow follows the session and
is never revoked: a plan session switched to `build` keeps the tool, which this section
already treats as wanted, and a revoke could not tell caret's rule from a user's identical
one. The awaited hook, not a `session.created` event, carries it because v2 activates a
cold location's plugins asynchronously, so the first session could be created before caret
subscribes. A default-agent session is resolved from `ctx.agent.list()` as § Daemon
warm-up describes; should v2 reorder that list, a non-plan first entry fails closed and a
`plan` one at worst grants the tool to one session, which this section already accepts for
a plan session switched to `build`.

On v1, `applyCaretConfig` writes exactly one per-agent permission: `allow` for
`caret_review_plan` on the `plan` agent, and only when the agent has no entry of its own.
Every other primary agent is left untouched — OpenCode's base ruleset permits an unknown
tool id, so the *absence* of an entry is what makes the tool available. The `plan` entry
is worth its one line because a user with a restrictive global
`permission: { "*": "deny" }` would otherwise lose the tool on the one agent that depends
on it; agent-level permission merges after the global ruleset, so the entry is what
rescues it. The helper stays idempotent and preservation-safe (it keeps existing
`primary_tools`, agent modes, other permissions, and any review-tool permission the user
set themselves) and normalizes the degenerate "permission is a bare string" shape before
writing, so it can't corrupt a user's config.

**One consequence, unresolved.** That rescue reaches `plan` and only `plan`. A user with a
global `permission: { "*": "deny" }` therefore keeps the tool on the plan agent and loses
it everywhere else — so "any primary agent can ask for a review" holds for the default
config but not for the very config the retained line exists to survive. Writing the allow
into the **global** `permission` map instead would cover every primary at the same cost,
and subagents should still be blocked (the `task` tool appends its `primary_tools` denies
ahead of inherited rules). "Should" is the reason this is not done here: that precedence
was not confirmable from the minified binary with the confidence the per-agent claim got,
so it wants the live check § Verified vs. follow-up already schedules.

## How it maps onto caret's two-layer split

- **Adapter (`src/adapters/opencode/`)** — the wire + probe, mirroring
  `src/adapters/codex/`: `parseHookInput` (the envelope), `emitDecision` (the flat
  decision), a single `default` approve variant, `fatalDenyLine`, and
  `readOpencodeInstallState` (a read-only probe of OpenCode's config dir). Registered in
  `src/adapters/index.ts`; selectable via `CARET_AGENT=opencode`. Claude stays the
  default.
- **Packaging (`opencode/`)** — the v1 plugin (`caret.plugin.ts`), the v2 plugin
  (`caret.plugin.v2.ts`) and its permission evaluator (`permission.ts`), the v2 TUI module
(`caret.tui.ts`, `exports["./tui"]`), their package entrypoint (`index.ts`, see § The
export surface), and command files (`commands/*.md`). The plugin ships in the
`@macintacos/caret` npm package and resolves its binary and version at runtime from that
package (§ Runtime resolution + update check); only the command files still carry
substituted markers — `__CARET_BIN__` and `__CARET_DEMO_TEMPLATE__`, the template embedded
rather than read because under `bunx` the install-time root is a temp dir.
- **Install (`caret install`)** — adds caret to the user's OpenCode config
  (comment-preserving, via `jsonc-parser` in `config-plugin.ts`) as either
  `@macintacos/caret` or, under `--from-local`, `file:<checkout>` (§ The local form) and
  deploys the `/caret:*` command **files**, which v2's command discovery reads from the
  same `commands/` dir; `--uninstall` reverses both. The key it writes follows the host (§
  Which key install writes). Both arms also sweep what the file-deploy era left in the
  config dir: caret's `caret.ts` in either plugin dir OpenCode scans (`plugins/`, and the
  singular `plugin/` it keeps as a back-compat alias) and any `caret:`-namespaced file in
  the singular `command/`. That is not tidiness — OpenCode loads a plugin out of either
  dir, so a leftover file registers a **second** `caret_review_plan` beside the array
  entry, and a leftover command file re-exposes `/caret:*` pointed at a substituted binary
  path nothing writes any more. The command sweep matches caret's namespace rather than
  the commands the package ships today, so an old install's file for a since-dropped
  command isn't stranded. The config dir's own `package.json` is deliberately **left**: it
  is inert, and another of the user's plugins may import `@opencode-ai/plugin` through it.
  The sweep runs after the upgrade check, so a plugin file is only dropped once the array
  entry exists and a stale cached copy has been offered a refresh — and it still runs when
  that refresh is declined, since two loaded caret plugins are worse than one
  stale-but-single plugin. OpenCode itself installs the package and its deps into its
  cache on the next start — caret writes no config-dir manifest and runs no `bun install`.
  Between the two writes it runs an upgrade check: OpenCode resolves an array entry once
  and caches it forever (§ The cache layout), so re-adding the entry never moves anyone
  off install-day's version. `upgrade.ts` weighs the entry and that cache against npm's
  `latest` — npm rather than GitHub releases, because `latest` is what OpenCode would
  re-resolve to — and a stale result offers to clear the cached copy, or to bump a
  user-authored pin. That offer is a prompt, since `~/.cache/opencode` is not caret's to
  delete unasked; `--refresh` pre-answers it, and off a TTY install names the gap and
  changes nothing. Clearing the cache leaves the service on caret's own copy under
  `~/.local/state/caret/roots/`, not an older agent root, until OpenCode's next start
  re-resolves. The same run also registers caret with Claude Code via its plugin CLI when
  Claude Code is among the selected targets. The command lives in `src/commands/install/`:
  `index.ts` is the orchestrator (it selects the targets — the chooser or detection — and
  dispatches), beside the target registry, the chooser, the terminal reporter, and one
  module per target runner. `paths.ts` is the single source of truth both the probe
  (reader) and the writer resolve through, and `entries.ts` the single answer to which
  entries, in either key, are caret's — each returned as a `CaretEntry` carrying its key
  and spec.

## Distribution choice (amended by EXC-794)

caret installs into OpenCode as a first-class plugin array entry —
`plugins: ["@macintacos/caret"]` when every `opencode` on `PATH` is v2, else
`plugin: ["@macintacos/caret"]` — which OpenCode installs (package + deps) into its own
cache and loads. The **package entrypoint is the plugin** (`package.json` `exports` `.` →
`opencode/index.ts`), so a **bare** specifier loads it: Bun's dynamic `import()` does not
support subpath imports, and OpenCode's `parsePluginSpecifier` yields only
`{ pkg, version }`, so a `@macintacos/caret/opencode` subpath is not viable. The plugin's
runtime import (`@opencode-ai/plugin`, for `tool.schema`'s zod — zod is not
cross-instance-compatible, so the tool's args must use OpenCode's zod) is a real
`dependency` now, so OpenCode's install provides it. The compiled caret binary stays lean
regardless: `src/` never imports `@opencode-ai/plugin`, so the bundler doesn't pull it in.

**EXC-794 amended the original decision.** The spike had rejected option (c) — "publishing
a second npm package + mutating the user's `plugin` array" — as too heavy. But caret
already publishes `@macintacos/caret`, so the array path needs **no second package**: that
one package's entrypoint is the OpenCode plugin, and it ships the whole caret runtime
(`bin/caret`, `dist/`, `ui/dist/`), so an array install is self-contained. This retired
the file-deploy machinery (the config-dir manifest, the caret-run `bun install`, and
`stripNonDefaultExports`), and install now cleans up after it — see the Install bullet in
§ How it maps onto caret's two-layer split. The other two rejected options still stand:
(a) a `permission.ask` per-edit gate (wrong semantic) and (b) re-implementing the daemon
round-trip in the plugin (duplication).

### The local form: `--from-local`

`caret install --from-local` writes `file:<checkout>` as the array entry instead of the
package name. That is what makes `mise run build --install` put the developer's build in
front of OpenCode: OpenCode hands the specifier to its package installer, which
**symlinks** the target into the cache
(`packages/file:/abs/path/node_modules/@macintacos/caret -> <checkout>`). The plugin
module OpenCode loads is therefore the checkout's own file, its `import.meta.url` sits in
the checkout, and the `../bin/caret` that `resolveCaretBin` falls back to is the
checkout's shim — so `bin/caret-native`, freshly compiled. Because it is a symlink, every
later rebuild is picked up with no reinstall. v2 hands a `plugins` `file:` entry to its
npm installer too, keyed verbatim as nested dirs
(`npm/file:/abs/path/<generation>/node_modules/@macintacos/caret -> <checkout>`), and that
too is a symlink — confirmed live. Install keeps the `file:` form on v2: a `file://` URL
or an absolute path would reach v2's local-directory loader, which ignores `package.json`
`exports`. `package.json` `main` is what makes OpenCode accept a directory as a plugin
("server target"); a bare `exports["."]` is rejected.

Caret owns **exactly one** entry across both keys, so install rewrites across forms:
`--from-local` drops a package or tarball entry, a published install drops a checkout or
tarball entry, and `--uninstall` removes any of them. Both present would load two caret
plugins, each registering the review tool. A `file:` entry is caret's when it names a
caret checkout (one with `opencode/caret.plugin.ts`) or a tarball `npm pack` made of caret
(`macintacos-caret-*.tgz`, judged by filename, never opened); any other `file:` entry
belongs to another plugin and is left alone. A version **pin** is not a different form —
`@macintacos/caret@0.8.1` is the user's pin and survives a re-install.

The upgrade check is skipped in local mode, and now for a load-bearing reason rather than
convenience: a checkout entry re-resolves to that checkout on every OpenCode start, so it
cannot go stale and npm's published version says nothing about it. A tarball entry is
skipped too: the check reads the package form only.

### Which key install writes

Install probes every `opencode` on `PATH` (`readOpencodeHosts` in `host.ts`). It skips
relative entries, probes two names for one file once under the first spelling, and runs
each binary's `--version` under its own 5 s bound, a `Bun.spawnSync` — synchronous because
an async spawn's timeout kills only the direct child, and npm v1's node wrapper leaves a
grandchild holding stdout. caret writes `plugins` only when every binary reads as v2.
Anything else writes `plugin`, which v2 also loads (`normalize.ts:185-190`, § Sources): a
v1 at any version, since v1 from 1.18.16 ignores `plugins`, a failed or hung probe,
unparseable output, or no binary at all. Install's host line names each binary and its
version, or the one it couldn't read, and a failed probe never aborts install. Uninstall
never probes: it removes caret from both keys of every global config file.

`readPlacement` picks the spec install writes with `keptEntry` — the first pinned entry of
the installed form, else the first, read from the files the host loads before any it
ignores — and `setCaretPluginEntry` writes that spec into the target's host key, swapping
a caret entry already in that key in place, so the key, its comment, and caret's array
slot stay where they are, and dropping every other caret item in that file, a pin
included. That move is load-bearing: v2 concatenates a leftover `plugin` array ahead of
`plugins`, and two caret entries fail with `Duplicate plugin ID: caret`. A removal that
empties `plugins` deletes the key, because v1 below 1.18.16 rejects any `plugins` key,
`[]` included; an emptied `plugin: []` stays. caret writes a bare string item, as v2's own
`opencode plugin add` does, and every reader also accepts a `{ "package": … }` object
item.

Unless every `opencode` on `PATH` reads as v1, install writes into the first of
`opencode.jsonc` and `opencode.json` that exists, else creates `opencode.json`, and never
into `config.json`, which v2 ignores; a `PATH` whose every `opencode` reads as v1 keeps
the first of all three (`resolveConfigFile`). A pin in a file the host loads wins over one
in a file it ignores. Every other existing global config loses caret's entry
(`stripCaret`), the other files first and the target last, so a failure in between leaves
no caret entry rather than two. `planConfigEdits` checks every file before
`writeConfigEdits` touches one. A file is uneditable when it fails to read or parse, or
when its edit does not re-parse to the intended value: a duplicate `plugins` key parses to
its last value while edits land on the first. Install's step then refuses and writes
nothing; uninstall clears every file it can and warns about each one it leaves. Two config
names that resolve to one file, a symlink alias, count once under the earlier name
(`existingConfigFiles`). The dry run lists the files that change, and a failed later write
names the files already changed. Doctor reads every existing global config; caret in a
file the host does not load fails `opencode-host`, and when caret sits only in such files
the `opencode-caret-version` check is skipped. Doctor counts a file as ignored only when
it finds a readable v2; with none, every file counts as loaded.

caret deletes a changed plugin array's elements one by one, with the same comment-keeping
range cut it uses for an emptied `plugins` key, because no jsonc-parser release deletes an
element without losing or moving a neighbour's comment. Every comment survives, except one
inside a deleted object item and one inside a `plugins` array that empties and is deleted.

### The cache layout, and what the probe may conclude from it

v1 and v2 lay the cache out differently.

v1 keys that cache by the **verbatim specifier string** from the `plugin` array, one
directory per entry under `packages/` — `<cache>/opencode/packages/<specifier>/`, honoring
`XDG_CACHE_HOME` with the same precedence caret's own helper uses. That directory holds a
top-level shim manifest whose `dependencies[<package name>]` records the **requested**
spec, and the installed package under `node_modules/<package name>/`. The requested spec
is exact under OpenCode 1.18.x's empty save prefix but not guaranteed to be, so
`readCachedCaretVersion` reads the installed `node_modules/@macintacos/caret/package.json`
`version` first and falls back to the shim value when the installed manifest yields no
version: under that empty save prefix the requested spec is the exact version OpenCode
resolved, so it still names the installed caret. That fallback must parse as `X.Y.Z`; a
range reads as unknown, never guessed.

Two consequences the probe (`readOpencodeInstallState`) is built around. Because the key
is the raw string, a bare `@macintacos/caret` and a pinned `@macintacos/caret@latest` are
two sibling directories that can coexist — so version reads use **only** the directory
named by the configured entry's verbatim specifier (`opencodeCachePackageDir`), with no
sibling fallback. `existingOpencodeCachePackageDirs` (`src/adapters/opencode/paths.ts`)
*lists* the parent only for the stale-cache clear, which removes every caret directory.
And a directory can exist with nothing installed after an interrupted install — OpenCode's
own installed-check is `existsSafe(join(dir, "node_modules", name))`, not the directory
itself — so the probe treats a resolved version, never directory presence, as proof of
install.

**v2** installs under `<cache>/opencode/npm/` (same `XDG_CACHE_HOME` precedence), then
`<name>@<spec>/<generation>/node_modules/<name>/package.json`, where a bare name gets
`@latest` — so on v2 a bare and an `@latest` entry share one dir — and the live generation
is the numerically largest all-digit child (`liveGenerationDir`). Older generations
persist, so the stale-cache clear deletes the whole `npm/@macintacos/caret@<spec>/`, not
one generation. `readCachedCaretVersion` reads both layouts alike: the installed manifest
sits at `node_modules/@macintacos/caret/package.json` under both a v1 package dir and a v2
generation dir. `existingOpencodeCachePackageDirs` lists both layouts, and the clear
removes every caret dir in either. The service launcher offers each caret spec dir's live
generation, never an older one.

Which layout an entry reads from (`caretCacheDir` in `upgrade.ts`): a `plugins` entry is
always v2's, since v1 never installs it; a `plugin` entry is v2's when the caller knows
the host is v2 (doctor, install's dry run), else v1's. The probe never spawns `opencode`,
so it goes by the key alone. After install the key matches the host and the two rules
agree; they disagree only for a `plugin` entry on a v2 host, which `opencode-host` fails
on. On a mixed `PATH` the upgrade check reads v1's layout for a `plugin` entry, so a stale
v2 copy goes unreported.

The probe recognises a `--from-local` checkout or caret tarball entry the way install does
(`caretEntries`); a checkout's version reads through the cache symlink § The local form
describes. doctor's `opencode-caret-version` check does not: `readCaretEntry` matches the
package form only, since npm's version says nothing about a local entry. It takes the host
version only to pick the cache layout.

doctor's `opencode-host` check (`hostCheck` in `host.ts`, composed in `readOpencodeChecks`
in `checks.ts`) runs whenever caret has an entry in either key, the `file:` form included.
It lists every `opencode` it finds and judges the key by the rule install uses, so a mixed
v1/v2 `PATH` passes with `plugin`. It fails for each v1 below 1.3.4 (the dual export's
floor, § The export surface), for caret in `plugins` unless every `opencode` reads as v2,
since v1 never loads it (before 1.18.16 it refuses to start with the key), for caret in
`plugin` when every one is v2, and for caret in a config file the host does not load
(`config.json` on v2). Each remedy is `caret install`. It reports `unknown` when no binary
is found or none can be read.

## Runtime resolution + update check (EXC-794)

The array install has no marker-substitution step, so the plugin resolves what it needs at
runtime from the package it ships in:

- **Binary** (`resolveCaretBin`): `CARET_OPENCODE_BIN` env override → a substituted marker
  (only the retired file-deploy set one) → `new URL("../bin/caret", import.meta.url)` (the
  `bin/caret` shim shipped beside the plugin in the package).
- **Version** (`resolveCaretVersion`): a substituted marker if present → the sibling
  `../package.json`'s `version`. Used by the update check.
- **Update check** (`realUpdateChecker`, wired only into the production defaults, via
  `productionUpdateCheck`): on load, fetch caret's latest GitHub release and toast a nudge
  when the running version is behind. Best-effort — a network error, a non-200, or the
  `CARET_OPENCODE_NO_UPDATE_CHECK` opt-out is silent. An inline semver compare keeps the
  plugin self-contained. Both hosts call the same `productionUpdateCheck`: v1 from
  `server()`, v2 from the TUI half's `setup`, since v2's server has no toast. They share
  one 24 h stamp at `$XDG_STATE_HOME/caret/opencode-update-check`, so a user who switches
  hosts gets one nudge a day, not two; v2's `ctx.storage` was passed over because whether
  it loads before the synchronous stamp read is unverified.

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

## The export surface: a plugin module may export ONLY plugins

OpenCode's plugin loader iterates a module's exports (`Object.values(mod)`) and throws
`TypeError("Plugin export is not a function")` on the FIRST export it cannot coerce to a
Plugin (a function, or a `{ server }` object) — one bad export rejects the whole module.
caret's plugin SOURCE (`caret.plugin.ts`) exports constants (`CARET_PLUGIN_VERSION`,
`REVIEW_TOOL`, `PLANNING_AGENTS`) and pure helpers so `test/opencode/` can unit-test them
and so `caret.plugin.v2.ts` can share them, so it can't be OpenCode's entrypoint directly
— the first non-Plugin export would reject it (a live EXC-339 bug, log line
`failed to load plugin … "Plugin export is not a function"`).

So the package's entrypoint is a tiny dedicated module, `opencode/index.ts`, whose
namespace is exactly `{ default }`, and `package.json` `exports` `.` points at it.
`test/opencode/entrypoint.test.ts` asserts it.

**One default serves both runtimes: `{ id: "caret", setup, server }`.** OpenCode v2
decodes `default` as `{ id, setup }` and ignores the extra `server`; v1 runs `server` (the
v1 plugin, `caret.plugin.ts`'s default) and ignores `setup` (the v2 plugin,
`caret.plugin.v2.ts`'s default). `id` is a fixed whitespace-free string both loaders
accept. The v1 floor is **1.3.4**, the first v1 loader that reads an object default's
`server`; an older v1 sees a non-function export and fails to load the plugin.

`@opencode/plugin` (v2's plugin API) is a `dependency` but imported **for types only**.
Its `Plugin.define` is the identity function, and its runtime entry would pull Effect and
OpenCode's client into the module graph — which `index.ts → caret.plugin.v2.ts` loads on
v1 hosts too.

**v2's toasts live in a second module, `opencode/caret.tui.ts`, under
`exports["./tui"]`.** v2's server `Context` has no toast surface; toasts belong to a TUI
plugin, which v2 resolves as `<pkg>/tui` from the same `plugin`/`plugins` entry and loads
only as a default `{ id, setup }` with a non-empty `id`. v2's host resolves `<pkg>/tui`
through the package's `exports` itself; § Distribution choice rules out subpaths only for
the `plugin`/`plugins` specifier. Its `setup` runs the update check and listens for tool
events: `session.tool.progress` carrying the `caretUrl` metadata key shows the review-link
toast, and `session.tool.success` (`caretDecision`) or `session.tool.failed` for that call
supersedes it with the decision toast. Those events carry the call id, not the tool name,
so the metadata keys the server half's `execute` writes are the only link between the
halves. The decision toast matters because v2's toast surface is single-slot with no hide
API — without it the 10-minute link toast would linger after every decision. v1 keeps its
toasts in `server()` (`client.tui.showToast`), so caret needs no `tui.json` entry; the
toast bodies (`reviewLinkToast`, `decisionToast`) are shared from `caret.plugin.ts`. The
default also carries a no-op `tui`: v1's own installer may register this module as a v1
TUI plugin, and v1's TUI loader throws on a default without one. The module is not named
`tui.ts` or `plugin*`, because the `@opencode/*` tsconfig alias would then shadow the real
`@opencode/plugin` and `@opencode/tui` packages. The `Object.values` rule binds only
`index.ts`: both TUI loaders read only `default`, so `createCaretTui` stays a named export
for tests.

## Verified vs. follow-up

**Verified in this repo (unit + integration tests, no live OpenCode required):** the
adapter's parse/emit/probe/fatal-deny; the plugin's pure logic + the tool's `execute()`
through a stubbed spawn runner (approve / deny / a child-session refusal / a `build` and a
user-defined agent proceeding / the allow-on-unreadable-session fallback in each of its
three shapes); the `path` branch (resolution against the session directory, the `.md`,
readable-file, and exactly-one-of checks, an unreadable file or a denied `edit` permission
ask never spawning caret, that ask's pattern being relative to the worktree, an inline
`plan` never asking, and the envelope and result text carrying the path) and the adapter
parsing that path into `PlanInput`; the plans-dir resolver the steer names (OpenCode's
data-dir default, `XDG_DATA_HOME`, `[opencode] plans_dir` from the config file caret
reads, a leading `~`, a malformed config falling back); the config hook (writes
`primary_tools`, leaves other agents untouched, never overwrites a user's own review-tool
permission); the steer gate (plan agent yes, `build` no, no `sessionID` no, unseen session
no, agent switching mid-session); the `chat.message` warm hook (warms for the plan agent
only — not for a build or unknown caller — even though it records every session's agent)
and the production warm runner it hides (survives a bad binary's async spawn error, and
runs `prewarm` with `CARET_AGENT=opencode`); the entrypoint's
`Object.values`-single-Plugin invariant; the config-array editor (add/remove,
comment-preserving); target selection + dispatch; the `claude` target's CLI command
sequence; the runtime bin/version resolvers; and the update check (toasts when behind,
silent on error / opt-out). On v2 they also cover the permission evaluator, the tool's
registration (`codemode: false`, JSON Schema input), steer and prewarm gating,
evaluate-then-refuse on `path`, the subagent refusal and its fail-open, the `context`-hook
tool removal and its fail-open, the plan-agent allow and its agent-and-session skip, the
default agent the warm and allow resolve from `ctx.agent.list()` (failing closed on an
unreadable or empty list and on a non-plan default), the TUI half's toasts and update
check, abort on both hosts, and v1↔v2 parity of the refusal texts. For the plugin key they
cover the host probe's 5 s bound (a grandchild holding stdout included), key selection and
the one-transform move, deleting `plugins` without losing comments (a trailing comma and
CRLF included), v2 cache reads and clears, and doctor's `opencode-host` and
`opencode-caret-version` checks and their gating.

**Confirmed against a live OpenCode 1.18.11 with `@opencode-ai/plugin` 1.18.17 — EXC-1085,
the array install's LOCAL form, which is what ties the run to that plugin version: a
`file:` entry loads the checkout's own module, so the dependency under test is the one
this repo's lockfile resolves.** `caret install --from-local`, with OpenCode selected in
the chooser, writes that entry; OpenCode symlinks the checkout and loads the plugin with
no `failed to load plugin` line; the `config` hook's mutation reaches the running config
(`experimental.primary_tools` carries `caret_review_plan`, and the `plan` agent's
`permission` carries its `allow`); the planning steer routes the Plan agent to the tool;
the envelope reaches `caret review`, which serves the plan in caret's UI under the
adapter's single `default` approve variant; and approving there returns `approvedMessage`
to the agent, which proceeds.

**Documented manual follow-up (needs a live OpenCode + a model provider):** what that
round-trip did not reach — the PUBLISHED entry (`@macintacos/caret`) resolving out of npm
into OpenCode's cache on restart, a **`build`-agent** call being offered rather than
denied while that session receives no unprompted steer, the update toast firing when the
plugin is behind, a live `path` round-trip (the plan agent writing its plan to OpenCode's
data-dir `plans/` and being allowed to, re-reading and editing that file on a change
request, and the approved file ending with the reviewer notes), and the `path` ask's
worktree-relative `edit` pattern matching OpenCode's own edit rules, including in a
session started from a repo subdirectory, where `context.directory` and `context.worktree`
differ. This mirrors the Codex adapter's live-contract follow-up (EXC-549) and the upgrade
story tracked in EXC-383.

**Confirmed against a live OpenCode v2.0.18** loading a `"plugin": ["file:<checkout>"]`
entry, with all four `XDG_*` directories and `HOME` isolated and a scripted
OpenAI-compatible mock model
(`providers.<id>.package = "@opencode/ai/providers/openai-compatible"`): the plugin loads
and `caret_review_plan` appears by name in the plan agent's request `tools` (so
`codemode: false` takes effect); the steer reaches the plan agent's system prompt; an
inline plan reaches `caret review`, is served in caret's UI, and approving there returns
`approvedMessage` as the tool result; a `path` in `~/.opencode/plan/` passes
evaluate-then-refuse against v2's real plan-agent rules and returns the "already saved at"
approval; and a `path` outside it under the plan agent is refused with the not-permitted
text, opens no review, and leaves the file unchanged.
**Against OpenCode v1.18.29 loading the packed npm tarball** (an installed package, not a
symlinked checkout), `caret_review_plan` is in the tools v1 sends the model and no
`failed to load plugin` line is logged — v1 runs the dual export's `server`.

**Also confirmed live on v2.0.18** (same harness), for the toasts, the plan-agent allow,
and the subagent deny:

- **Plan-agent allow under a config deny-all.** On a freshly started service the plan
  agent's first request offered `caret_review_plan`, and approving returned the approval.
  A plan-agent `caret_review_plan` deny in the user's config wins: no request offered the
  tool and no review opened. Without the allow, the plan agent was offered no caret tool
  under the same deny-all.
- **Subagent deny.** v2's subagent tool is `subagent`, not `task`. A `general` child
  spawned from a plan session was not offered `caret_review_plan` while its parent was,
  under default permissions and under deny-all with `subagent` allowed (where the child
  inherits the session rules). Without the removal, the child was offered the tool.
- **Toasts.** In an attached TUI, the TUI half loaded from `exports["./tui"]` through the
  same `file:` entry, with no second entry and no id clash. The link toast showed the
  review URL while the review was pending; approving replaced it with "caret: plan
  approved", and an interrupt replaced it with "caret: review cancelled" — v2 emits
  `session.tool.failed` for an interrupted tool.
- **Update toast.** Behind the latest release, the TUI showed one update toast; a relaunch
  showed none, held off by the shared stamp; `CARET_OPENCODE_NO_UPDATE_CHECK=1` suppressed
  it.
- **v1 unchanged** (v1.18.29, packed tarball): it offered `caret_review_plan`, logged no
  `failed to load plugin`, and its `debug config` still showed
  `experimental.primary_tools` holding the tool and the plan agent's
  `caret_review_plan: allow`.

**v2 follow-ups.** Whether a real model obeys the steer over v2's own "do not create or
update plan files unless the user explicitly asks" reminder — a mock model cannot show it
(anomalyco/opencode#49879). Web and desktop, which attach no TUI and so show no toasts.
The default-agent resolution: a user whose default agent is `plan` gets the warm and the
allow, awaiting its live check (EXC-1535). That the allow follows a plan session switched
to another agent was not observed directly.

**Confirmed live for EXC-1520** (isolated `HOME` + `XDG_*`; v2.0.18 from Homebrew,
v1.18.15 and v1.18.29 from npm):

- **v2, `--from-local`.** Install wrote `"plugins": ["file:<checkout>"]`, kept a non-caret
  `plugin` entry and a `//` comment, deployed the command files, and left no
  `opencode serve` behind from the probe. A plan-agent round-trip approved in caret's UI;
  no load error or `Duplicate plugin ID`; `opencode plugin list` showed caret once. The
  TUI offered `/caret:plan`, `/caret:demo`, and `/caret:doctor`.
- **v2, published.** `plugin: ["@macintacos/caret@1.1.1"]` moved to `plugins` with the
  pin. v2 installed it under `npm/@macintacos/caret@1.1.1/<digits>/`, and the probe read
  `1.1.1`. A bare entry installed under `npm/@macintacos/caret@latest/<digits>/`, and
  `--refresh` over a stale cache removed each whole spec dir.
- **v1.** On 1.18.15, `debug config` over a `plugins` key — `[]` included — exits 1
  (`Unrecognized key: plugins`); install moved caret to `plugin` and deleted the key, and
  `debug config` then exited 0. On 1.18.29 install writes `plugin` and the packed tarball
  loads.
- **Uninstall** removed caret from both keys (a string and a `{ "package" }` object), kept
  non-caret entries and the comment, and removed the command files.
- **doctor.** `opencode-host` failed for caret in `plugin` on v2 and in `plugins` on
  1.18.15, and passed after install moved each.

**EXC-1520 follow-ups:**

- `opencode/caret.plugin.ts`'s header still says caret loads from the `plugin` array.

## Sources

- OpenCode plugin API: `@opencode-ai/plugin` (`packages/plugin/src/index.ts`, `tool.ts`) —
  `Plugin`, `Hooks`, `tool()`, `ToolContext`.
- OpenCode loaders: `packages/opencode/src/config/plugin.ts`
  (`{plugin,plugins}/*.{ts,js}`), `config/command.ts` (`{command,commands}/**/*.md`).
- OpenCode config: per-agent `permission`, `experimental.primary_tools`
  (`packages/core/src/v1/config/*`).
- Subagent bypass: sst/opencode#5894.
- OpenCode v2 (`anomalyco/opencode@v2.0.18`): loader `packages/core/src/plugin/module.ts`;
  plugin API `packages/plugin/src/README.md` (`@opencode/plugin`); plan agent and its
  directory `packages/core/src/plugin/plan.ts`, `packages/util/src/global.ts`; permission
  evaluation `packages/core/src/util/wildcard.ts`, `packages/core/src/permission.ts`,
  `packages/core/src/file-access.ts`; stock agent rules `packages/schema/src/agent.ts`;
  tool input schema `packages/core/src/tool/runtime.ts`; tool availability and the
  per-request tool list `packages/core/src/tool.ts`,
  `packages/core/src/session/model-request.ts`; config permissions folded into agent rules
  `packages/core/src/config/plugin/agent.ts`; agent-then-session rule order
  `packages/core/src/session/context.ts`; the `prompt` hook and plugin activation
  `packages/core/src/session/prompt.ts`, `packages/core/src/plugin/hooks.ts`,
  `packages/core/src/plugin/service.ts`, `packages/core/src/plugin/supervisor.ts`; TUI
  plugin loading `packages/tui/src/plugin/context.tsx`; the toast surface
  `packages/tui/src/ui/toast.tsx`; `./tui` and server entry resolution
  `@opencode/plugin`'s `dist/host.js`; default-agent resolution and list order
  `packages/core/src/agent.ts`; the plugin's `agent.list`
  `packages/core/src/plugin/host.ts`; the unset agent stored as given
  `packages/core/src/session.ts`.
- OpenCode v2 plugin keys and install (`anomalyco/opencode@v2.0.18`): the legacy `plugin`
  array concatenated ahead of `plugins` `packages/core/src/config/normalize.ts:185-190`;
  `opencode plugin add` writing a bare string
  `packages/cli/src/commands/handlers/plugin/add.ts`; config discovery (no `config.json`)
  `packages/core/src/config/discovery.ts:11`,
  `packages/core/src/config/config.ts:185-191`; command discovery
  `packages/core/src/config/plugin/command.ts:143-187`,
  `packages/schema/src/config/command.ts:7-14`.
- v1's `plugins` rejection: `Config.Info` is `.strict()`
  (`anomalyco/opencode@v1.3.4:packages/opencode/src/config/config.ts:1093`) and rejects
  `plugins` until `compare/v1.18.15...v1.18.16` removes `topLevelExtraKeys`
  (`packages/opencode/src/config/parse.ts`).
- v1 TUI plugins (`anomalyco/opencode@v1.18.29`):
  `packages/opencode/specs/tui-plugins.md`, loader
  `packages/opencode/src/plugin/shared.ts`.
- v2 permission assert (upstream, open): anomalyco/opencode#46530.
