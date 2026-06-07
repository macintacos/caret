---
name: architecture-rules
description: The core/adapter boundary — a flat tool-agnostic core, the single agent-tool adapter axis, the one-way dependency law, and the browser-safe shared-module constraint.
---

# Architecture Rules

caret is a tool-agnostic core plus one adapter axis: the coding agent it speaks to. The boundary is
the load-bearing structural invariant — keep it sharp and a second agent tool slots in without
touching core internals; blur it and agent vocabulary leaks everywhere.

## The two layers

- **`src/` is the flat core.** daemon, store, reviews, decisions, settings, log, redact, paths,
  prefs, plan-format, types — all at the top level, no `src/core/` directory. The core knows
  reviews, plans, and decisions; it does **not** know any agent's wire protocol.
- **`src/adapters/<tool>/` implements one agent tool.** `src/adapters/adapter.ts` declares the
  `AgentAdapter` interface; `src/adapters/claude/` is the reference implementation. An adapter owns
  four surfaces: `parseHookInput` (raw hook stdin → core `PlanInput`), `emitDecision` (core
  `Decision` → the tool's stdout wire shape), `approveVariants` (the post-approval options it
  offers), and `readInstallState` (the discovery install probe).

## The dependency law (grep-enforceable)

The dependency runs **one way**: an adapter imports core types; the core **never** imports an
adapter.

- **Composition is the only exception.** The wiring points — `src/cli.ts` and `src/commands/*` —
  select the active adapter and thread it in (e.g. `runReviewSubcommand` hands the adapter's
  `parseHookInput` to `runReview` as a `ReviewDeps` field). Core modules like `review.ts` take the
  capability as an injected dependency, so they name no adapter. A `from "./adapters/` import in a
  non-composition core module is the smell.
- **`ui/` never imports `src/adapters/*`.** Adapter capabilities reach the browser **over the wire**,
  not by import. The pattern: the daemon publishes the active adapter's `approveVariants` in
  `GET /api/health`, and the UI renders its approve split-button from that wire field
  (`ui/src/lib/approve.ts`), falling back to a built-in set when the field is absent.

## Where agent vocabulary lives

Anything specific to a coding agent — hook payload field names, the decision JSON shape, session
mode/variant tokens like `acceptEdits`/`auto` — lives **only** in `src/adapters/<tool>/`. The core
carries opaque equivalents: `Decision.acceptMode` is an `ApproveVariantId` (an opaque token the core
transports without interpreting); only the adapter maps a token to a tool permission
(`setModeFor` in `src/adapters/claude/approve.ts`).

**Adding a new agent tool:** create `src/adapters/<tool>/`, implement `AgentAdapter` (declare its own
approve variants with their ids/labels, parse its hook shape, render its decision wire format, probe
its install), and wire it at the composition points. You touch `src/adapters/` and the composition
modules — never core internals, store records, or the daemon's routing.

**What does NOT move to the adapter directory:** the Claude plugin packaging — `hooks/hooks.json`,
`.claude-plugin/*`, `commands/*.md` — sits where Claude Code's plugin system requires it on disk.
It is adapter-owned *surface* (Claude-contractual file locations), documented as such, but not
parameterized for hypothetical future tools.

## Browser-safe shared modules

Some modules are imported by **both** runtimes — the compiled bun binary and the singlefile UI
bundle (the UI reaches them through the `@core/*` alias: `src/types.ts`, `constants.ts`,
`redact-core.ts`, `ui-log-bridge.ts`). Every such module is **pure TS with zero node imports**.

The reason is the build: `ui/vite.config.ts` uses `vite-plugin-singlefile` to inline all JS+CSS into
one `index.html` with no sibling assets and no dynamic `import()`. A `node:*` import in a
`@core`-shared module would either break that bundle or drag the daemon's node dependency chain into
the browser. So the split is deliberate: the shared algorithm/constants/types stay pure (e.g.
`redact-core.ts` holds the `DENY_KEYS` walk), and node-only concerns layer on top in a
non-shared module (e.g. `redact.ts` adds the home-path file scrub). Before importing a `src/` module
from `ui/`, confirm it is node-free — or extract the node-free part.

## Related rules

- `test-layout.md` — how `test/` mirrors this same core/adapter split.
- `logging-rules.md` — the redaction core (`redact-core.ts`) is one of these shared modules.
