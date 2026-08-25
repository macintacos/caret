# Architecture Rules

caret is a tool-agnostic core plus one adapter axis: the coding agent it speaks to. The
boundary is the load-bearing structural invariant — keep it sharp and a second agent tool
slots in without touching core internals; blur it and agent vocabulary leaks everywhere.

## The two layers

- **`src/` is the tool-agnostic core, grouped by domain.** The core knows reviews, plans,
  and decisions; it does **not** know any agent's wire protocol. It is organized into
  cohesive domain directories (`daemon/`, `review/`, `plan/`, `redact/`, `ui/`, `config/`,
  `lib/`); [`../ARCHITECTURE.md`](../ARCHITECTURE.md) § Layout describes what each one
  holds. `src/cli.ts` (the `bun build --compile` entrypoint) and `src/discovery.ts` (the
  standalone diagnostics feature) stay at the root, beside the gitignored generated UI
  manifest. There is deliberately no `src/core/` bucket — the domain directories **are**
  the core.
- **`src/adapters/<tool>/` implements one agent tool.** `src/adapters/adapter.ts` declares
  the `AgentAdapter` interface; `src/adapters/index.ts` is the registry that maps a tool
  id to its adapter and resolves the active one (by explicit id, then `CARET_AGENT`, then
  the default). `src/adapters/claude/` is the reference implementation and the default;
  `src/adapters/codex/` is a second (default-off, provisional) adapter that proves the
  seam. An adapter owns seven surfaces: `parseHookInput` (raw hook stdin → core
  `PlanInput`), `emitDecision` (core `Decision` → the tool's stdout wire shape),
  `fatalDenyLine` (a dependency-free last-resort deny line for the CLI's fatal handler),
  `approveVariants` (the post-approval options it offers), `readInstallState` (the
  discovery install probe), `listSkills` (the skill names the reviewer's `/` completion
  offers — names only, never a skill's contents), and `readSkillDescription` (one named
  skill's own description, read on demand for the preview panel that completion opens —
  that description, never the rest of the skill's file).

## The dependency law (grep-enforceable)

The dependency runs **one way**: an adapter imports core types; the core **never** imports
an adapter.

- **Composition is the only exception.** The wiring points — `src/cli.ts` and
  `src/commands/*` — select the active adapter and thread it in (e.g.
  `runReviewSubcommand` hands the adapter's `parseHookInput` to `runReview` as a
  `ReviewDeps` field). Core modules like `review/orchestrate.ts` take the capability as an
  injected dependency, so they name no adapter. A `from "./adapters/` import in a
  non-composition core module is the smell.
- **The emission seam lives at the composition layer, not the core.** `runReview` returns
  a tool-agnostic `Decision` (its fail-safe denies are `Decision`s the core constructs);
  the wiring point renders it to the agent's wire string with `adapter.emitDecision` at
  the moment it writes stdout. So the only `emitDecision` call sites are
  `src/commands/review.ts` (the normal path and the SIGINT/SIGTERM fail-safe) and
  `src/cli.ts`'s last-resort fatal handler — never the review core. The fatal handler
  keeps a hard-coded minimal deny string as a fallback for the one case the adapter itself
  failed to load, so the truly-fatal path still fails safe.
- **`ui/` never imports `src/adapters/*`.** Adapter capabilities reach the browser
  **over the wire**, not by import. The pattern: the daemon publishes the active adapter's
  `approveVariants` in `GET /api/health`, and the UI renders its approve split-button from
  that wire field (`ui/src/lib/approve.ts`), falling back to a built-in set when the field
  is absent. `listSkills` rides the same pattern one route over — the daemon serves the
  active adapter's skill names on `GET /api/reviews/:id/skills` and the feedback editors'
  `/` completion reads them from there (`ui/src/lib/skillCompletion.ts`), so an adapter
  that enumerates nothing simply leaves the list empty and no completion fires.

## Where agent vocabulary lives

Anything specific to a coding agent — hook payload field names, the decision JSON shape,
session mode/variant tokens like `acceptEdits`/`auto` — lives **only** in
`src/adapters/<tool>/`. The core carries opaque equivalents: `Decision.acceptMode` is an
`ApproveVariantId` (an opaque token the core transports without interpreting); only the
adapter maps a token to a tool permission (`setModeFor` in
`src/adapters/claude/approve.ts`).

**Adding a new agent tool:** create `src/adapters/<tool>/`, implement `AgentAdapter`
(declare its own approve variants with their ids/labels, parse its hook shape, render its
decision wire format and its `fatalDenyLine`, probe its install, enumerate its skills),
add one `REGISTRY` entry in `src/adapters/index.ts` keyed by the tool id, and add its
`test/adapters/<tool>/` suite. You touch `src/adapters/` and the registry — never core
internals, store records, the daemon's routing, or `test/core/`.

`src/adapters/codex/` is the worked second example: the OpenAI Codex CLI's
PermissionRequest hook is ~1:1 with Claude's (one JSON object on stdin, a
`hookSpecificOutput.decision.behavior = "allow" | "deny"` envelope plus an optional
`message` deny channel on stdout), so it reuses the same command-hook shape with its own
provisional wire details — registered, default-off, selectable via `CARET_AGENT=codex`,
and not yet live-verified (the live-contract check is a manual follow-up, the same pattern
as Claude's EXC-549). It adds **no** packaging: a registry entry plus its module and tests
are the whole change, which is exactly what the boundary is meant to make possible.

**OpenCode is the next candidate, and it is shaped differently.** OpenCode integrates as a
**JS plugin**, not a command hook: it exposes a `tool.execute.before` hook (throwing to
block a tool) and `permission.asked` events, loaded in-process — with a known subagent
bypass. So it does not fit the command-hook `AgentAdapter` shape the Claude and Codex
adapters share (stdin → parse → stdout deny line); it needs a different integration
surface. EXC-339 built that surface — a registered `caret_review_plan` tool that bridges
to `caret review` rather than a command hook; see
[`opencode-integration.md`](opencode-integration.md) for the spike and the design. Note it
as plugin-shaped before assuming a new tool slots into the command-hook mold.

**What does NOT move to the adapter directory:** the Claude plugin packaging —
`hooks/hooks.json`, `.claude-plugin/*`, `commands/*.md` — sits where Claude Code's plugin
system requires it on disk. It is adapter-owned *surface* (Claude-contractual file
locations), documented as such, but not parameterized for hypothetical future tools. The
Codex adapter likewise ships no packaging today; Codex hook installation
(`~/.codex/hooks.json` / `config.toml [hooks]` behind `[features] codex_hooks`) is a
documented future ship step, not built here.

## Browser-safe shared modules

Some modules are imported by **both** runtimes — the compiled bun binary and the browser
UI bundle (the UI reaches them through the `@core/*` alias: `src/lib/types.ts`,
`config/constants.ts`, `redact/core.ts`, `ui/log-bridge.ts`). Every such module is
**pure TS with zero node imports** — the node-free property is per-module, so a
browser-safe file can sit in a domain directory beside node-only siblings.

The reason is the browser bundle: a `node:*` import in a `@core`-shared module either
breaks the Vite build (node builtins have no browser equivalent) or drags the daemon's
node dependency chain into the browser. So the split is deliberate: the shared
algorithm/constants/types stay pure (e.g. `redact/core.ts` holds the `DENY_KEYS` walk),
and node-only concerns layer on top in a non-shared module (e.g. `redact/node.ts` adds the
home-path file scrub). Before importing a `src/` module from `ui/`, confirm it is
node-free — or extract the node-free part.

The UI is a standard multi-asset Vite build: `vite build` emits `ui/dist/index.html` plus
content-hashed `dist/assets/*` (JS + CSS), which the build embeds into the binary through
a generated manifest. `scripts/generate-ui-manifest.ts` enumerates `ui/dist/` into a
gitignored module of `with { type: "file" }` imports (`src/ui-manifest.generated.ts`) that
`bun build --compile` inlines, mapping each request URL path to its embedded file;
`src/ui/assets.ts` resolves that asset set and the daemon serves each asset by URL path
with per-path MIME and cache headers. Dynamic `import()` in the browser bundle is fine —
the node-free invariant above is the only constraint a shared `@core` module owes.

## Daemon trust model

The daemon binds **loopback only** (`127.0.0.1`) and runs with **no auth**, sized for a
single-user laptop. The posture follows from that: any local process can already reach the
daemon and read plan content, so the daemon does not try to authenticate local callers —
the one adversary it defends against is a **browser on another origin** that the user
happens to have open.

- **Read-confidentiality rests on the loopback bind + the absence of CORS headers, not on
  the CSRF guard.** The daemon emits **no** `Access-Control-*` header on any route, so the
  browser's same-origin policy blocks a foreign page from reading any response — even a
  `GET` that reaches a handler. A regression test (`test/core/daemon/server.test.ts`, the
  read-confidentiality block) asserts no route family ever emits an `Access-Control-*`
  header, so a future permissive-CORS "fix" fails loudly instead of silently exposing plan
  bodies. Never add a CORS-grant header.
- **The CSRF guard gates only non-safe methods.** `isCrossOrigin(req)`
  (`src/daemon/guards.ts`) rejects a state-changing request from a foreign Origin; safe
  methods (GET/HEAD, via `isSafeMethod`) are let through, because the SOP already protects
  reads and a foreign GET can't exfiltrate the response. The guard tests the verb through
  `isSafeMethod`, not a POST/PUT allowlist, so a future mutating verb (DELETE/PATCH) is
  CSRF-protected by default. A same-origin browser sends a loopback Origin (allowed) and a
  hook/CLI sends no Origin (allowed); a foreign page's write is the only thing blocked.
- **No preflight handler exists or is needed.** A same-origin request sends no `OPTIONS`
  preflight, and a cross-origin preflight would be denied by the browser before any
  request body is sent (no advertised CORS headers).

## Related rules

- `test-layout.md` — how `test/` mirrors this same core/adapter split.
- `logging-rules.md` — the redaction core (`redact-core.ts`) is one of these shared
  modules.
