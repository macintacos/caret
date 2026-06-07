---
name: svelte-rules
description: Svelte 5 conventions for caret's UI — runes in components, orchestration state as plain factories over injected stores, component-logic extraction, the component-test harness, and CSS-token discipline.
---

# Svelte Rules

caret's UI is Svelte 5 (runes). The one shaping decision: reactive *components* hold runes, but the
orchestration logic — polling, autosave, the resolve flow — lives outside components as plain,
unit-testable factories. App.svelte is a thin shell that wires them together.

## State modules are plain factories, not runes-in-.svelte.ts

Shared/orchestration state lives in `ui/src/state/` (polling, autosave, render memo, resolve). Each
is a **plain factory over an injected store + deps**, not a module that declares its own `$state`:

- The factory takes a backing-store object whose fields it reads and writes through getters
  (`createReviewSelection(store)`, `createAutosave(store, activeId, deps)`), plus a `deps` bag for
  effects it must perform (the api call, the timer, an `onOffline` callback).
- **App.svelte supplies the reactive backing store** — a `$state<SelectionStore>({...})` literal it
  owns — so the runes live in the component; the factory just mutates plain fields.
- **Tests supply a plain object** as the store and fake deps, and assert on the factory directly.

The real reason for the split: `bun test` (the unit runner) cannot compile runes inside a
`.svelte.ts` module, so logic written as runes there is untestable without mounting. A plain factory
over an injected store is directly unit-testable — see `ui/src/state/autosave.test.ts` and
`polling.test.ts`, which drive the factories with fake timers and stores and never mount a component.
Keep `App.svelte` a layout + wiring shell: state literals, the factory calls, and the `$effect`s that
connect them — no business logic.

## Extract component logic to a testable lib module

Imperative DOM logic does not belong inside a component. `ui/src/lib/planPaint.ts` is the precedent:
PlanView's mark-wrapping/measuring was lifted into a pure module that mutates a passed-in DOM root,
so it is unit-testable against happy-dom without mounting PlanView. The component keeps the Svelte
shell — the `$effect` scheduling, the ResizeObserver, the prop wiring — and calls the extracted
function. When a component grows non-trivial DOM manipulation, extract it the same way.

## $derived / $effect discipline

- **`$derived` for values** that follow from other reactive state (`active`, `rendered`, `variants`
  in App.svelte). Reach for `$derived.by` only when the computation needs a body.
- **`$effect` for side effects**, one concern per effect. App.svelte deliberately splits its effects
  — working-copy reload, polling, remembered-mode load, safe mode, scrollspy — rather than one
  mega-effect, so each has a clear dependency set. A mount-once effect (polling) reads no reactive
  state and returns its teardown; a reactive effect names its trigger explicitly (the working-copy
  reload depends on the derived `active`).
- **Callback props, not event dispatch.** Components take `on*` function props (`onApprove`,
  `onSelect`, `onCreate`) and parents pass closures; this is how state-module methods reach the tree
  (`onCreate={autosave.createAnnotation}`). Type each callback's argument precisely.

## Component tests

A `.svelte` component is unit-tested by mounting it under happy-dom. The harness:
`bunfig.toml`'s `[test].preload` registers `ui/test-svelte-preload.ts` (compiles `.svelte` to
client output), the test command passes `--conditions browser` (selects svelte's client runtime),
and `ui/test-mount.ts` exposes `render(Component, props)` + a `capture()` callback recorder with
auto-unmount. Component units cover **render output, prop reactivity, conditional branches, and
callback wiring** — the things a mounted component exposes.

What does *not* go in a component unit: real-browser behavior (text selection, focus/keyboard, scroll,
popover positioning, timing windows). That is e2e. The unit-vs-e2e split is governed by
`browser-testing.md` — defer to it, don't restate it here.

## One runner: bun-test, and the `--conditions browser` requirement (EXC-537)

caret runs **one** test runner — `bun test` — for both the backend and the UI component suites.
Svelte's official testing story is Vitest (runes-native, no preload needed), but adopting it would
add a *second* runner and a second config surface; the bun-test harness already works, so keeping a
single runner is the deliberate choice against that cost. The price of one runner is the bespoke
`ui/test-svelte-preload.ts` plus the mandatory `--conditions browser` flag — accepted, not
accidental.

The flag is load-bearing: svelte's `.` export map gates the client runtime (the real `mount`) behind
the `browser` condition and falls back to the server runtime (a `mount` stub that throws) otherwise.
So the canonical entry points — the `mise run test` task and `package.json`'s `test` script — both
pass `--conditions browser`; it can't move into `bunfig.toml`'s `[test]` table because export
conditions are a CLI resolution input, not a config key. Bare `bun test` resolves the server runtime
and would crash component mounts cryptically, so `ui/test-mount.ts` probes the resolved svelte module
at import and throws an actionable error (run via `mise run test` / `bun test --conditions browser`)
instead. The guard lives only in the mount harness, so the backend suite — which never imports it —
stays green under any invocation.

## CSS-token discipline

- **App.css owns the design tokens** as CSS custom properties (`--paper`, `--ink`, `--accent`,
  `--mark`, …). Components reference `var(--token)`; they don't hardcode hex. A color used in two
  places is a token, declared once.
- **A constant coupled across files gets one named source.** A breakpoint that a media query, a
  component, and the Playwright viewport all depend on lives as `TOC_BREAKPOINT_PX` in
  `ui/src/lib/layout.ts` (pure TS, node-free), and `layout.test.ts` asserts the `@media` rules
  match it — so a drifted breakpoint fails the unit suite instead of silently breaking the e2e
  smoke. When a magic number couples CSS to TS to config, name it once and test the coupling.

## Related rules

- `browser-testing.md` — the unit-vs-e2e decision and the e2e harness contract.
- `icon-rules.md` — the `Icon.svelte` render path and when an icon earns its place.
- `architecture-rules.md` — why `ui/` imports nothing from `src/adapters/` and reaches `@core` only.
