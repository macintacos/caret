# Svelte Rules

caret's UI is Svelte 5 (runes). The one shaping decision: reactive *components* hold
runes, but the orchestration logic — polling, autosave, the resolve flow — lives outside
components as plain, unit-testable factories. App.svelte is a thin shell that wires them
together.

## Imports

UI modules import their own siblings through the **`@/` alias**
(`@/state/polling.svelte.ts`, `@/components/TopBar.svelte`) — `@/` is `ui/src/`. The
`ui/src/lib/` directory keeps its idiomatic **`$lib`** prefix (shadcn-svelte's
convention), and the shared core is reached through **`@core`**. All three sit together in
the import grouping; relative paths are only for files with no alias. The full convention
— and how Biome auto-groups imports — lives in `typescript-rules.md`.

## State modules are plain factories, not runes-in-.svelte.ts

Shared/orchestration state lives in `ui/src/state/` (polling, autosave, render memo,
resolve). Each is a **plain factory over an injected store + deps**, not a module that
declares its own `$state`:

- The factory takes a backing-store object whose fields it reads and writes through
  getters (`createReviewSelection(store)`, `createAutosave(store, activeId, deps)`), plus
  a `deps` bag for effects it must perform (the api call, the timer, an `onOffline`
  callback).
- **App.svelte supplies the reactive backing store** — a `$state<SelectionStore>({...})`
  literal it owns — so the runes live in the component; the factory just mutates plain
  fields.
- **Tests supply a plain object** as the store and fake deps, and assert on the factory
  directly.

The real reason for the split: an injected store keeps the reactive state where the
consumers already are. App.svelte owns the tree these factories serve, so state it holds
reaches every consumer as a prop, and a test drives the factory against a plain object
with no mount — see `ui/src/state/autosave.test.ts` and `polling.test.ts`, which drive the
factories with fake timers and stores and never mount a component. Keep `App.svelte` a
layout + wiring shell: state literals, the factory calls, and the `$effect`s that connect
them — no business logic.

**The narrow exception: app-wide service state.** A module modelling something there is
exactly one of per document, whose consumers are *not* all reachable from App's prop tree,
owns its own `$state` in a `.svelte.ts` module and exports **both** the factory and the
singleton. `createAppearance()` / `appearance` in `ui/src/state/appearance.svelte.ts` is
the case: the live palette is one per document (it paints `document.documentElement` and
persists to origin-scoped `localStorage`), and ThemeSection and FilePreview read it from
outside App's tree — threading it down would be prop-drilling genuinely global state. It
follows the same singleton-plus-exported-factory shape as the non-reactive `shortcuts`
registry (`ui/src/lib/shortcuts/index.ts`). This stays the exception: reach for it only
once a consumer outside App's tree actually exists, and keep the factory exported so tests
construct a fresh instance with injected deps instead of sharing the singleton. Runes are
testable there — `ui/test-svelte-preload.ts` compiles `.svelte.ts` modules through
svelte's `compileModule` for the bun runner (§ Component tests).

## Extract component logic to a testable lib module

Imperative DOM logic does not belong inside a component. `ui/src/lib/diffview/links.ts` is
the precedent: the source view's link layer (the per-line span transform plus the
token-event handlers in `linkInteractions.ts`) is a pure module the component drives, so
it is unit-testable against happy-dom without mounting the view. The component keeps the
Svelte shell — the `$effect` scheduling, the prop wiring — and calls the extracted
functions. When a component grows non-trivial DOM manipulation, extract it the same way.

## $derived / $effect discipline

- **`$derived` for values** that follow from other reactive state (`active`, `variants` in
  App.svelte). Reach for `$derived.by` only when the computation needs a body.
- **`$effect` for side effects**, one concern per effect. App.svelte deliberately splits
  its effects — working-copy reload, polling, remembered-mode load, safe mode — rather
  than one mega-effect, so each has a clear dependency set. A mount-once effect (polling)
  reads no reactive state and returns its teardown; a reactive effect names its trigger
  explicitly (the working-copy reload depends on the derived `active`).
- **Callback props, not event dispatch.** Components take `on*` function props
  (`onApprove`, `onSelect`, `onCreateLineAnnotation`) and parents pass closures; this is
  how state-module methods reach the tree
  (`onCreateLineAnnotation={autosave.createLineAnnotation}`). Type each callback's
  argument precisely.

## Component tests

A `.svelte` component is unit-tested by mounting it under happy-dom. The harness:
`bunfig.toml`'s `[test].preload` registers `ui/test-svelte-preload.ts` (compiles `.svelte`
to client output), the test command passes `--conditions browser` (selects svelte's client
runtime), and `ui/test-mount.ts` exposes `render(Component, props)` + a `capture()`
callback recorder with auto-unmount. Component units cover
**render output, prop reactivity, conditional branches, and callback wiring** — the things
a mounted component exposes.

What does *not* go in a component unit: real-browser behavior (text selection,
focus/keyboard, scroll, popover positioning, timing windows). That is e2e. The unit-vs-e2e
split is governed by `browser-testing.md` — defer to it, don't restate it here.

## One runner: bun-test, and the `--conditions browser` requirement (EXC-537)

caret runs **one** test runner — `bun test` — for both the backend and the UI component
suites. Svelte's official testing story is Vitest (runes-native, no preload needed), but
adopting it would add a *second* runner and a second config surface; the bun-test harness
already works, so keeping a single runner is the deliberate choice against that cost. The
price of one runner is the bespoke `ui/test-svelte-preload.ts` plus the mandatory
`--conditions browser` flag — accepted, not accidental.

The flag is load-bearing: svelte's `.` export map gates the client runtime (the real
`mount`) behind the `browser` condition and falls back to the server runtime (a `mount`
stub that throws) otherwise. So the canonical entry points — the `mise run test` task and
`package.json`'s `test` script — both pass `--conditions browser`; it can't move into
`bunfig.toml`'s `[test]` table because export conditions are a CLI resolution input, not a
config key. Bare `bun test` resolves the server runtime and would crash component mounts
cryptically, so `ui/test-mount.ts` probes the resolved svelte module at import and throws
an actionable error (run via `mise run test` / `bun test --conditions browser`) instead.
The guard lives only in the mount harness, so the backend suite — which never imports it —
stays green under any invocation.

## CSS-token discipline

- **App.css owns the design tokens** as CSS custom properties (`--paper`, `--ink`,
  `--accent`, `--mark`, …). Components reference `var(--token)`; they don't hardcode hex.
  A color used in two places is a token, declared once.
- **Shared style atoms stay global CSS classes, not Tailwind `@utility`.** The chrome's
  cross-component vocabulary — `.mono`/`.metric` (mono family, tabular figures),
  `.eyebrow` (the uppercase label), `.float-chip` (the topbar's soft-solid surface) —
  lives as plain global classes in `app.css`, alongside the tokens. They are deliberately
  **not** Tailwind `@utility` entries: `app.css` imports Tailwind with `source(none)` and
  scans only `lib/components/ui` (the shadcn tree), so a `@utility` referenced from
  caret's own components — which are never scanned — would never be emitted. A named class
  also beats inlining a multi-property atom at each call site (the declared-once rule
  again). Tailwind utilities are the shadcn tree's; caret chrome wears caret-token CSS.
- **A constant coupled across files gets one named source.** The reference layout width
  the Playwright viewport depends on lives as `REFERENCE_WIDTH_PX` in
  `ui/src/lib/layout.ts` (pure TS, node-free), and `layout.test.ts` asserts the e2e
  viewport derives from it — so a drift fails the unit suite instead of silently breaking
  the e2e smoke. When a magic number couples TS to config, name it once and test the
  coupling.
- **Every hue has a job; everything else is neutral.** The palette recipe
  (`ui/src/lib/themes/recipe.ts`) draws a five-way split, and the chrome obeys it — a
  reviewer should be able to predict a surface's hue from the job it does.

  | Job | Token | What it marks |
  | -- | -- | -- |
  | Selection | `--accent` | the current selection, plus brand: the wordmark, the `^`, the primary action |
  | Novelty | `--attention` | "look here" — new, unread, worth a glance. Every count that asks to be noticed: the TopBar pending badges, the compare picker's other-version count, the status strip's tallies |
  | Semantics | `--ok` / `--danger` | added / removed, succeeded / failed |
  | Content highlight | `--mark`, `--mark-active`, `--mark-orphan` | a marked region of the document — plan-search hits, with `-active` the current one and `-orphan` the same mark with its anchor gone |
  | Content chip | `--chip-bold`, `--chip-italic`, `--chip-code`, `--chip-link`, `--chip-ref` | the tint behind a rendered markdown span — three neutral, hue only on the two destinations |

  The split is by **token**, not by hue: a palette may draw two jobs from one hue family
  at different value and alpha. caret's own does — `markHue` is a lighter amber than the
  accent, so a search hit and the current selection are the same family and still
  different jobs. Read the token, not the colour.

  Everything else is neutral: the ink ramp and the chip surface fills. Two carve-outs are
  deliberate. The **chip surface** — `--chip` / `--chip-hover` in `styles/derived.css`,
  the soft-solid fill under `.float-chip` — stays neutral because neutral is what the rule
  prescribes for a control that is neither selection, novelty, nor semantics; the content
  chips in the table above are a different vocabulary and tint content rather than chrome.
  The **keycap** derives from `currentColor` because it has no job of its own and inherits
  its container's — which is why a key on the amber Approve button reads light and a key
  on a neutral chip reads grey. `theme.test.ts` asserts every `ColorToken` has at least
  one `var()` reader under `ui/src`, so a token can't stay declared for nobody — and every
  content chip clears that floor, all in `diffview/coreStyles.ts`: `--chip-ref` fills the
  resting file-reference chip, `--chip-code` the fence-marker chip, and `--chip-bold` /
  `--chip-italic` / `--chip-code` / `--chip-link` the four inline chips, each through its
  own `--md-*` layer variable — so `--chip-code` is the one tint spent on two surfaces.
  That suite also holds `--chip-link` and `--chip-ref` at least 60 degrees of hue apart in
  every palette; check that pin rather than your eye when adding one, and read the comment
  above it for why that pair and not another. A third pin measures something else for a
  different pair: `--chip-ref` sits above a shared saturation floor and `--chip-code`
  below it, since those two render side by side and a near-neutral's hue angle carries no
  design intent to compare against. Read that test's comment before choosing `chipCodeHue`
  or `chipRefHue`. The chip family is **five members and closed**: a markdown decoration
  that overdraws a marker rather than tinting a span takes the marker ink this epic has
  already fixed, `--ink-faint`, not a sixth chip. The blockquote level bar is the worked
  example (EXC-863, `diffview/coreStyles.ts`) — it does not sit beside the marker, it *is*
  the marker redrawn, so it carries that ink; `--rule-strong` was measured first and left
  the bars legible but not countable, which is the job. The quoted line's ink is subdued
  with opacity rather than a tint, which is what lets the chips inside a quote keep their
  treatment instead of being overpainted by it — and because opacity composites at paint
  time, no token assertion can see it. `QUOTE_SUBDUE` in `diffview/coreStyles.ts` is
  therefore exported and pinned by `theme.test.ts` against every palette: `--ink` on
  `--paper-sunk` ranges from 6:1 to 19:1 across the nine, so the flattest ink ramp sets
  how far any of them may fade. Any future paint-time effect on body copy owes the same
  pin. A decoration that indicates **state** owes two things more. Tell the states apart
  by SHAPE, not by hue or by an opacity step, which fails outright for a colour-blind
  reader whatever a contrast ratio says — the task-list checkbox is the worked example
  (EXC-860, same file): an empty ballot box against a ticked one, on one ink, so it needs
  no subdue constant. And clear WCAG 1.4.11's 3:1 floor
  **on the surface it actually renders on**. That last clause is the trap:
  `theme.test.ts`'s ink-ramp case measures `--paper` and `--paper-raised`, the two chrome
  surfaces, while the diff view binds `--diffs-bg` to `--paper-sunk` and bands its rows
  with 2–8% ink over it. `--ink-faint` clears 3:1 on the chrome pair and
  **fails it on the diff surface** in catppuccin-latte (2.90) and github-light (2.97), so
  the checkbox spends `--ink-soft` — which bottoms at 4.21 across the nine — and
  `theme.test.ts` pins it there. The faint *structural* markers around it (fence,
  emphasis, list bullets) are decoration rather than state and still sit below that floor
  on those two palettes: a real gap, epic-wide, and not one a single ticket re-tints a
  shared token to close. A decoration that **replaces** its marker rather than sitting
  beside one owes that floor too, and the thematic break is that case (EXC-862, same
  file): its source characters go transparent, so the drawn line is the only thing left
  saying a section break is there and nothing legible survives beside it to make the line
  ornamental. It spends `--ink-soft` for that reason, pinned the same way. It also settles
  what the level-bar note above left open — `--rule` and `--rule-strong` are 10% and 16%
  ink, and composited over the diff body they measure 1.15–1.34 and 1.24–1.62 across the
  nine, barely past the 1.05 this epic calls indistinguishable. Those tokens draw
  hairlines on the CHROME surfaces; nothing in the plan view can spend one and be seen.
  The rule itself is painted as a **background layer** rather than as a `::before`, which
  is what keeps it clear of both traps in the bullet below at once: paint is not content,
  so there is no node for `tables.ts` to count and no per-token glyph to suppress.
- **An overdrawn glyph belongs on the run's FIRST token, not on every tagged one.**
  `inlineDecorate.ts` tags every shiki token a run covers, and shiki does not always hand
  a multi-character run over as one token — an uppercase `[X]` comes back cut into three.
  A one-character decoration like the list bullet can never meet this; anything wider can,
  and drew one glyph per piece until EXC-860 added
  `[data-md-checkbox] + [data-md-checkbox]::before { content: none; }`. Suppress on the
  adjacent-sibling form rather than reordering rules: it wins on selector weight, so a
  later edit to the block cannot quietly undo it.
- **The diff-view bridge is amber-selection-only.** The single `.diffview` rule in
  `app.css` maps caret's tokens onto `@pierre/diffs`'s `--diffs-*` properties. caret
  adopts the library's surface STRUCTURE — the layered buffer/context/separator depth
  system, derived per surface with `color-mix(in lab, …)` off caret's paper/ink ramp — not
  its blue skin. Only the comment SELECTION is recolored to caret amber (via
  `--diffs-bg-selection-override`); `--diffs-modified` stays library-blue, so the gutter
  `+`, change-type icons, and merge-conflict incoming read blue for free, and amber stays
  scarce and brand-reserved (the wordmark, the primary action, the `^`). The `+`/`-`
  SEMANTICS are caret's, though: `--diffs-addition-color-override`/
  `--diffs-deletion-color-override` tie to `--ok`/`--danger`, and the library cascades
  that one base into the line tint, the gutter bar, and the per-token emphasis wash, so
  all three share one hue. Set only the `*-color-override` base — never a derived
  `-base`/line-bg/emphasis var. Mix `in lab` only — `oklch` is mangled in the embedding
  Chrome build, and a pinned library hex fails the no-hex bridge test.
  `css-bridge.test.ts` pins these invariants.
- **shadcn components read the same tokens through the shadcn bridge.** The shadcn-svelte
  semantic variables (`--background`, `--primary`, `--border`, …) are `var()`-mapped onto
  caret's tokens in a second `app.css` block (EXC-758), so a copied shadcn component
  paints on caret's palette and retints on theme switch — same single-source discipline,
  pinned by `shadcn-bridge.test.ts`. When composing UI from shadcn components, see
  [`shadcn-rules.md`](shadcn-rules.md) for the compose-first norm and the bridge's
  component-side rules.

## Motion principles

caret runs two motion tracks, one system by intent. The chrome's own motion is restraint
over flourish: functional one-shot transitions stay ≤200ms and draw their duration/easing
from the `--dur-*`/`--ease-*` tokens in `app.css` (one enter easing, one exit easing — a
caret design call, not ported). The portalled shadcn surfaces (dialogs, dropdown menus,
tooltips, popovers) instead animate their enter/exit through `tw-animate-css` — the
`animate-in`/`fade`/`zoom`/`slide` utilities the copied components ship with.
Ambient/infinite animations (the safe-mode pulse, the EmptyState float, the theme wipe)
are exempt from both and keep their own bespoke durations.

`prefers-reduced-motion: reduce` is the single global kill-switch over all of it: one rule
in `app.css` collapses every animation and transition to one static frame, so no component
honors the preference on its own. It is anchored to two real selectors, never a bare `*` —
`#app` (the light-DOM chrome) and `[data-slot]` (the shadcn surfaces bits-ui portals to
`document.body`, outside `#app`; `tw-animate-css` ships no reduced-motion guard of its
own, so the `#app` anchor alone would leave a portalled dialog free to fade in).
`motion.test.ts` pins both anchors.

The `@pierre/diffs` render surface is motionless by design. Line hover,
line/range-selection highlight, the decoration bars, gutter affordances, and hunk-expand
all change state with instant `color-mix` swaps and carry NO transition or keyframe — the
library's vendored `style.css` has zero `@keyframes` and zero transitions on the diff
surface, and selection rendering is rAF-batched in `InteractionManager.ts` for throughput,
not animation. The multi-line drag-selection highlight is rendered INSTANTLY on purpose:
motion is deliberately not the lever for making drag-select discoverable — that affordance
work belongs to the comment surface (CMT), not to a transition on the highlight.

The diff surface is shadow-encapsulated, so the global reduced-motion rule above cannot
reach it AND a stray light-DOM transition cannot leak in. The one thing a host CAN do is
add a transition or animation to the `.diffview` light-DOM container or to a bridged
`--diffs-*` property in the single `.diffview` rule — those are the only diff styling
reachable from the host, and neither may carry a transition or animation.
`css-bridge.test.ts` asserts the bridge rule body names no `transition`/`animation`
property, so a future regression fails the unit suite rather than only showing as motion
in the diff view.

## Related rules

- `shadcn-rules.md` — the shadcn-first composition norm and the shadcn token bridge that
  extends the CSS-token discipline above.
- `browser-testing.md` — the unit-vs-e2e decision and the e2e harness contract.
- `icon-rules.md` — the `Icon.svelte` render path and when an icon earns its place.
- `architecture-rules.md` — why `ui/` imports nothing from `src/adapters/` and reaches
  `@core` only.
