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
  | Novelty | `--attention` | "look here" — new, unread, worth a glance. Every count that asks to be noticed: the TopBar pending badges, the compare picker's other-version count, the status strip's tallies. Counts are not the whole job, though — the reference-hint badge (`RefHintBadge.svelte`, EXC-1061) spends it on a one-time teaching dot, which is the same "worth a glance" and no tally at all |
  | Semantics | `--ok` / `--danger` | added / removed, succeeded / failed |
  | Content highlight | `--mark`, `--mark-active`, `--mark-orphan` | a marked region of the document — plan-search hits, with `-active` the current one and `-orphan` the same mark with its anchor gone |
  | Content chip | `--chip-bold`, `--chip-italic`, `--chip-code`, `--chip-link`, `--chip-ref` | the tint behind a rendered markdown span — three neutral, hue only on the two destinations |

  The split is by **token**, not by hue: a palette may draw two jobs from one hue family
  at different value and alpha. caret's own does — `markHue` is a lighter amber than the
  accent, so a search hit and the current selection are the same family and still
  different jobs. Read the token, not the colour.

  Everything else is neutral: the ink ramp and the chip surface fills. Two carve-outs are
  deliberate, and both explain why something *is* neutral rather than breaking the rule.
  The **chip surface** — `--chip` / `--chip-hover` in `styles/derived.css`, the soft-solid
  fill under `.float-chip` — stays neutral because neutral is what the rule prescribes for
  a control that is neither selection, novelty, nor semantics; the content chips in the
  table above are a different vocabulary and tint content rather than chrome. The
  **keycap** derives from `currentColor` because it has no job of its own and inherits its
  container's — which is why a key on the amber Approve button reads light and a key on a
  neutral chip reads grey.

  **One control spends a HUED token outside its job**, and it is the only one: the file
  preview's close circle (`.fp-close`, EXC-1067) fills with `--danger`, which is declared
  for semantics (removed / failed) and here paints chrome. What buys the exception is that
  the hue *is* the affordance — the macOS traffic light is a platform idiom a reader
  decodes before reading anything, and a neutral disc would read as a generic dot rather
  than as a close control. It stays bounded by being measured: the disc's glyph is held
  back until hover, so shape alone carries it and WCAG 1.4.11's 3:1 floor binds, which
  `theme.test.ts` pins against `--paper` for every palette. Note what it sits beside —
  TopBar's Reject wears the same pairing (a `--danger` `x` that fills `--danger` and flips
  to `--paper` on hover), so caret now shows red-plus-`x` for one destructive action and
  one benign one. They are told apart by shape and by place: Reject is a labelled chip in
  the action row, the close circle a bare disc in a pane's corner. A third red `x` would
  not be. Reach for this precedent only where a hue is the affordance; a control that
  merely wants to look important is neutral. `theme.test.ts` asserts every `ColorToken`
  has at least one `var()` reader under `ui/src`, so a token can't stay declared for
  nobody — and every content chip clears that floor, all in `diffview/coreStyles.ts`:
  `--chip-ref` fills the resting file-reference chip, and `--chip-bold` / `--chip-italic`
  / `--chip-code` / `--chip-link` the four inline chips, each through its own `--md-*`
  layer variable. (The fence markers took `--chip-code` too until they lost their chip: a
  chip tints a span of CONTENT, and a fence row is all marker and no content, so the tint
  drew an empty pill inside the code panel.) That suite also holds `--chip-link` and
  `--chip-ref` at least 60 degrees of hue apart in every palette; check that pin rather
  than your eye when adding one, and read the comment above it for why that pair and not
  another. A third pin measures something else for a different pair: `--chip-ref` sits
  above a shared saturation floor and `--chip-code` below it, since those two render side
  by side and a near-neutral's hue angle carries no design intent to compare against. Read
  that test's comment before choosing `chipCodeHue` or `chipRefHue`.
  **`--chip-link` marks link SYNTAX, not clickability.** Five shapes wear it and are not
  followable — an internal anchor, an unresolvable path, a fragment target, a bare-word
  target, and an image — and that is the contract rather than a gap (EXC-871 settled it).
  What the chip announces is that the run is link grammar the view collapsed, which is the
  thing that needs announcing: a collapsed label with no chip is indistinguishable from
  prose, and this view's whole thesis is that the source stays visible. Whether a click
  goes anywhere is a separate signal carried by the pointer cursor, which
  `linkInteractions.ts` sets only on a span it will actually open.
  **A chip is padded, and its padding moves the glyphs after it.** EXC-867/868 shipped the
  inline chips with none, and EXC-880 cancelled the file reference's with a negative
  margin, both to keep every row's glyphs on one pixel grid. Both are reversed: an
  unpadded tint reads as a highlighter smear rather than as a chip, and a cancelled pair
  spends the fill UNDER the neighbouring character, so two chips either side of one glyph
  coat its cell twice. Nothing that resolves a column resolves it in pixels — the comment
  anchors, vim motions and the drag gestures are character-indexed, and the search marks
  paint over DOM ranges — so what the shift costs is that a chip's glyphs no longer sit on
  the same pixel column as the same glyphs one row up. Spend `--chip-pad-inline` /
  `--chip-pad-block` (`diffview/coreStyles.ts`), never a fresh number, and hang the inline
  half on `data-md-start` / `data-md-end` rather than on every run: a pill fragmented into
  several elements would otherwise open a gap around each interior fragment.
  **A chip is one colour and one thickness end to end**, however many elements it is
  fragmented into — a fill that changes at an interior seam reads as two chips that failed
  to line up rather than as one. The citation is where that bites: a codespan wrapping a
  resolved reference is ONE reference chip, so `data-md-cite` rebinds `--chip-code` to
  `--chip-ref` for the whole group and the reference gives up its own fill and inline
  padding (it keeps the block half, or the middle renders thinner than the caps). Two
  members that genuinely nest do stack, and the inner one **rounds on a box of its own**:
  `border-radius` clips every background layer on an element, so an inner cap would notch
  the enclosing pill's tint — the pass names the nested members in `data-md-inner` and the
  sheet paints them on `::after` instead, with `data-md-inner-start` / `-end` as that
  pill's caps. `::after` and not `::before`, which the file-reference glyph owns. The plan
  surface's `--leading-relaxed` line-height is the other half of the same decision — a
  chip is taller than its glyphs, so stacked chips need the row gap the chrome's leading
  does not give. The chip family is **five members and closed**: a markdown decoration
  that overdraws a marker rather than tinting a span takes ink from the ramp, never a
  sixth chip. WHICH ink is settled, epic-wide, by one question —
  **does the source character survive?** — and EXC-871 swept every marker the epic draws
  onto one side or the other of it. A **supplementary** decoration leaves a legible glyph
  beside it and takes `--ink-faint`: the fence markers, the `**` / `_` emphasis markers,
  an ordered item's `1.`. A **replacement** decoration takes its character to
  `transparent` and draws in the column it vacated, so it is the only thing left carrying
  that character's meaning — which is WCAG 1.4.11's own test for a graphical object
  required to understand the content. It therefore owes that clause's 3:1 floor and spends
  `--ink-soft`: the task-list checkbox (EXC-860), the list bullet (EXC-861), the
  blockquote level bar (EXC-863), the thematic break (EXC-862) and a table's column rules
  and header rule (EXC-864), all in `diffview/coreStyles.ts`. There is a
  **third case, and it is open**: a decoration that replaces nothing because it was never
  in the source at all. The file and folder glyphs (EXC-687 / EXC-918) are the instance —
  they are added beside a fully legible path, which is why they sit on `--ink-faint`
  today, but the file-vs-directory distinction is carried by the glyph alone and by
  nothing else in the row, so 1.4.11 arguably binds them too. They predate this epic and
  EXC-871 did not re-tint them; an ADDED indicator carrying information no surviving
  character carries owes the same floor, and closing that is its own change. Do not read
  the two-way split above as covering it.
  **The floor binds on the surface the decoration actually renders on**, and that is the
  trap the rule exists to close. `theme.test.ts`'s ink-ramp case measures `--paper` and
  `--paper-raised`, the two chrome surfaces, while the diff view binds `--diffs-bg` to
  `--paper-sunk` and bands its rows with 2–8% ink over it. Across the nine palettes
  `--ink-faint` measures 2.63–5.81 there and **fails 3:1** on catppuccin-latte (2.66–2.99)
  and github-light (2.63–3.07); `--ink-soft` measures 4.21–9.26 and clears everywhere.
  `theme.test.ts` pins the replacement family against exactly that ground and reds naming
  the palette if a member is stepped back down. **`--rule` and `--rule-strong` are
  chrome-surface tokens and are spent nowhere on the diff body.** At 10% and 16% ink over
  those grounds they measure 1.15–1.37 and 1.24–1.64 — against the 1.05 this epic calls
  indistinguishable, which is a line in the DOM and not on the screen.
  `coreStyles.test.ts` asserts no DECLARATION in the sheet names either token (the
  comments still name them, deliberately, which is why that assertion scans the
  comment-stripped body). **These four ranges are stated here and nowhere else** — the
  sheet's own comments point at this paragraph rather than restating them, because six
  copies of a measured number drift apart and three of them already had. It is painted as
  a **background layer** rather than as a `::before`, which clears both traps in the
  bullet below at once — paint is not content, so there is no node for a settle check to
  count and no per-token glyph to suppress. The quoted line's ink is subdued with opacity
  rather than a tint, which is what lets the chips inside a quote keep their treatment
  instead of being overpainted by it — and because opacity composites at paint time, no
  token assertion can see it. `QUOTE_SUBDUE` in `diffview/coreStyles.ts` is therefore
  exported and pinned by `theme.test.ts` against every palette: `--ink` on `--paper-sunk`
  ranges from 6:1 to 19:1 across the nine, so the flattest ink ramp sets how far any of
  them may fade. Any future paint-time effect on body copy owes the same pin. A decoration
  that indicates **state** owes one thing more: tell the states apart by SHAPE, not by hue
  or by an opacity step, which fails outright for a colour-blind reader whatever a
  contrast ratio says. The task-list checkbox is the worked example — an empty ballot box
  against a ticked one, on one ink, so it needs no subdue constant.
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
over flourish: functional one-shot transitions draw their duration/easing from the
`--dur-*`/`--ease-*` tokens in `app.css` (one enter easing, one exit easing — a caret
design call, not ported). Those durations are **tiered by what moves**, not held under one
ceiling — `--dur-micro` (a tint or a pop, the same time in both directions), the
`--dur-enter`/`--dur-exit` pair for a surface, and `--dur-travel` for a scroll crossing
distance. The ladder is monotonic and `motion.test.ts` pins it as an ordering rather than
as values, so a surface leaving quicker than it arrives is the vocabulary's contract and
tuning any tier by eye stays free. Pick the tier from the thing that moves: a hover tint
on `--dur-enter` reads as lag, a dialog on `--dur-micro` reads as a pop. The portalled
shadcn surfaces (dialogs, dropdown menus, tooltips, popovers) instead animate their
enter/exit through `tw-animate-css` — the `animate-in`/`fade`/`zoom`/`slide` utilities the
copied components ship with. Ambient/infinite animations (the safe-mode pulse, the
EmptyState float, the theme wipe) are exempt from both and keep their own bespoke
durations.

**A property no stylesheet can drive takes a third route, and it is the narrowest one.**
Where the thing being animated is a JS property rather than a style — `scrollTop`, or a
timer standing in for the `animationend` happy-dom never fires — the duration is MIRRORED
as a plain constant instead of read from the sheet, and every mirror is pinned by
`motion.test.ts` so the two cannot drift. There are five: `SCROLL_ANIM_MS` and
`FOLLOW_ANIM_MS` (`diffview/scroll.ts`) carry `--dur-travel` and `--dur-micro` for the
plan's two scrolls, and three exit windows carry `--dur-exit` — `CLOSE_ANIM_MS` in
`state/planKeyboard.svelte.ts` (PlanSearch's collapse), `CLOSE_ANIM_MS` in
`components/DiffPlanView.svelte` (FileDrawer's close wipe), and the `exitMs` default in
`state/alerts.ts` (AlertHost's `alert-out`). The three exit ones are pinned by scanning
source text rather than by import, deliberately: none is exported, and an export minted
only to be asserted on is a worse seam than the regex that avoids it. That is the same
"name it once and test the coupling" rule § CSS-token discipline states for
`REFERENCE_WIDTH_PX`; a mirror without the pin is a comment, not an invariant. A JS driver
owes the reduced-motion preference directly too — the global CSS guard cannot reach it —
which `scroll.ts`'s `prefersReducedMotion()` is. Reach for this route only when a
stylesheet genuinely cannot express the animation; wanting a different curve is not
enough.

**Before minting a sixth, check whether you have a DOM handle — if you do, await the
animation instead of mirroring its duration.** A mirror is a number kept equal to a token
by a test; awaiting `getAnimations()` is the same wait with nothing to drift, and it
retimes itself for free when a tier moves. The repo ships both shapes of that already.
`awaitDeparture` (`components/FilePreview.svelte`) awaits the region's own animations
before swapping in a new excerpt, so a fetch faster than the departure still lets the
departure play and a fetch slower than it waits for nothing. `createModalPresence`
(`lib/modalPresence.ts`) is the same idea one level up: it holds a modal mounted until
bits-ui reports the close complete, and bits-ui's `AnimationsComplete` resolves on
`Promise.all` over **every** animation on the node — so a surface may grow or retime its
choreography without the gate knowing. The five above exist because `scrollTop` is not a
style and happy-dom fires no `animationend`, not because a modal is hard.

**A Svelte `out:` transition takes a fourth shape: the motion stays CSS, and the directive
is only the wait.** Svelte 5 compiles a transition's own keyframes into a Web Animations
API call, which the global reduced-motion guard below cannot reach — a `css`-returning
transition keeps animating under the preference. So `crumbOut`
(`components/PlanBreadcrumbs.svelte`, EXC-1123) declares the exit as a real
`@keyframes crumb-out` on a class it adds, and returns nothing but a `duration`, leaving
Svelte to hold the node in the DOM while that animation plays. That duration is neither
mirrored nor awaited but **read back off the element** with
`getComputedStyle(node).animationDuration` — a third answer to the paragraph above:
nothing to drift, and the guard collapses the wait along with the motion, so reduced
motion drops the level on the spot rather than holding an invisible one for `--dur-exit`.
Reach for this when a departure needs animating at all; a plain CSS `animation:` still
covers every arrival, since an arriving element is already in the DOM and needs no
directive.

Two things about that route are decisions rather than details, and both were EXC-1092's.

**`--dur-travel` (240ms) is the one token off the enter/exit axis, because it times travel
rather than a surface.** Distance sets it, not surface size: a scroll crossing hundreds of
pixels is a different perceptual job from a panel arriving in place, the eye needs longer
to follow a thing that moves than to accept a thing that appears, and a scroll has no exit
to be asymmetric against. At 180ms the same scroll read as an instant cut. Nothing that
fades, slides, pops or rises may borrow it — `motion.test.ts` asserts the vocabulary is
CLOSED at the four tiers, so a fifth duration has to argue for itself here first.

**The easing is `quadOut` from `svelte/easing`, not `--ease-out`, and the exponent is the
whole design.** Every decelerating curve slows down on paper; what decides whether a
reader SEES it stop is how far the final frames actually move. `--ease-out`
(`cubic-bezier(0.22, 1, 0.36, 1)`) is quintic-feeling and `cubicOut` is a step below it —
over a 1000px flight their last quarter carries ~3px and ~16px respectively, which is
sub-pixel per frame and therefore invisible, so the scroll reads as a fast slide that
simply stops. `quadOut` spends 62px there and is watched coming to rest. `scroll.test.ts`
pins that as a floor on the last quarter's distance rather than as a curve name, since the
name is the implementation and the visible glide is the contract. Judge a JS easing by
what its last frames do over the real distance, not by where it sits at the midpoint.

**Both of the plan's scrolls ride that one curve and driver**, differing only in duration:
the jump to a place (`--dur-travel`) and the keyboard cursor's follow (`--dur-micro`,
since a held `j`/`k` retargets it every few frames and a jump-length glide would leave the
view trailing the cursor). Sharing the driver is also what stops them fighting — a follow
landing inside a jump retargets that flight rather than being mistaken for a reader
grabbing the scrollbar.

**The two tracks may meet, and there is exactly one way to do it.** A portalled surface
that wants caret's timing sets `--tw-duration` and `--tw-ease` — the two custom properties
`tw-animate-css`'s compiled `animate-in`/`animate-out` reads — from the
`--dur-*`/`--ease-*` tokens, and declares no `animation` of its own on that element. The
ToC panel (`PlanToc.svelte`, EXC-1107) is the worked example, including the asymmetric
pairing the vocabulary tiers for: `--dur-enter`/`--ease-out` arriving,
`--dur-exit`/`--ease-in` leaving. Writing a competing `animation` shorthand instead is a
correctness bug and not only a style one — bits-ui's portal presence waits on the
`animationend` the vendored `enter`/`exit` keyframes fire, so replacing them strands the
surface in the DOM on dismissal. For the same reason nothing in this vocabulary may
resolve to `animation: none` on a portalled surface; the global guard below collapses the
duration instead, which is what keeps that event firing under the preference.

**Where the opt-in is written follows how many surfaces share it.** One component owning
one surface writes its two arms in its own `<style>`, as the ToC panel does. A
choreography several surfaces must wear *identically* is written once in
`styles/shadcn-bridge.css`, keyed on the `data-slot` every copied component stamps — that
is § Modal choreography (EXC-892), which times the Dialog and AlertDialog content and
overlay off one pair of arms because four vendored files each timing themselves is exactly
how they ended up at `duration-100`, `duration-200` and tw-animate's implicit `.15s`.
Overlay and content take the *same* arm there: the panel settling in as the room dims is
one gesture, and giving the backdrop its own clock reads as two. Being in the bridge earns
a second thing the component `<style>` cannot — those rules are unlayered while the
utilities they supersede compile into `@layer utilities`, so a `shadcn add --overwrite`
that restores the stock timing is overridden rather than a silent regression.

**The menus, popovers and tooltips take that timing by default**, from three unlayered
rules in `styles/base.css`. The click-opened surfaces —
`[data-slot="dropdown-menu-content"]`, `…-sub-content` and `popover-content` — are
surfaces the reader asked for, so they take the enter tokens by default and the exit
tokens on `[data-state="closed"]`. **The tooltip is the carve-out**: it is the one
hover-TRIGGERED surface in the set, and four of its six consumers (`NotifyBell`,
`StatusStrip`, `VersionBadge`, `VersionComparePicker`) open it with `delayDuration={0}`,
so it takes `--dur-micro` in one rule with no closed-state arm — symmetric, for the reason
`tokens.css` already gives for micro being the same time in both directions, which also
makes it the one departure in the vocabulary that leaves on `--ease-out` rather than
`--ease-in`. The slots are named one by one rather than swept as
`[data-slot][data-state]`, and the modal surfaces (`dialog`, `alert-dialog`, `sheet`) sit
deliberately outside all three: those take the whole viewport behind a backdrop and their
arrival is choreographed with it, so a sweep would quietly overrule that. `motion.test.ts`
asserts the inclusions and the separation both — specifically that no single rule ever
names a surface from both sets.

**The vendored components' own hover/focus tempo is bridged separately**, and it is not
`animate-in`'s. A bare `transition-colors` / `transition-all` in the shadcn tree resolves
through Tailwind's `--default-transition-duration` and
`--default-transition-timing-function`, which ship as 150ms on
`cubic-bezier(.4, 0, .2, 1)` — a second hover tempo beside caret's own 120ms `--ease-out`
chips. Both keys point at the micro tier from the `@theme inline` block in
`styles/shadcn-bridge.css`, which is the whole fix: no selector, no per-component
override, and a vendored class that names its own duration (the sheet's `duration-200`)
still wins over a default.

Two things about where those rules live. They are in `base.css` rather than in the
vendored components' class strings because `shadcn-svelte add` reverts those wholesale on
a re-sync (`shadcn-rules.md` § Edits a re-sync will silently undo) and never reaches a
caret-owned stylesheet. And **both arms sit at specificity zero** — the closed state wraps
its own `[data-state="closed"]` in a second `:where()`, which is not decoration: left bare
it would score (0,1,0) and a component's rule would have to tie-break against it on source
order. At zero they are a true default, so a surface with timing of its own simply wins.
`PlanToc.svelte` is that surface: the ToC panel is a `popover-content` and keeps the pin
EXC-1107 designed for it. A default and a pin agreeing on today's values is the expected
state, not a duplicate to collapse — the pin is what keeps the panel's timing the panel's
if the default ever moves. Being unlayered is what still makes these beat the
`duration-100` `popover-content` carries in `@layer utilities`; layer order decides that,
not specificity.

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
