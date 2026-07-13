# shadcn Rules

*Audience: coding agents and contributors building or reshaping UI in `ui/`.*

caret's UI composition is **shadcn-first**. The Tailwind v4 + shadcn-svelte foundation
(EXC-757) and the caret↔shadcn token bridge (EXC-758) are in place, so any new UI element
that a component library covers starts from a shadcn-svelte component — not from a
hand-rolled primitive. This file is the rule-of-the-road for that norm: how to add a
component, how it inherits caret's palette, how icons get swapped, and what deliberately
stays custom.

## The compose-first norm

Reach for a shadcn-svelte component first. `shadcn-svelte add <name>` copies the
component's source into `ui/src/lib/components/ui/<name>/` (config: `ui/components.json`;
the `$lib` import alias the copies assume is declared there and resolved by
`ui/vite.config.ts` + `ui/tsconfig.json`, and the `cn()` class-merge helper lives in
`ui/src/lib/utils.ts`). Button and Dialog already live there as the proof-of-life pair.

- **Never hand-roll a primitive the catalog covers** — button, dialog, menu, tooltip,
  badge, select, toggle group, and the rest. If shadcn-svelte ships it, add it.
- **The copied source is owned code, not a dependency.** Modifying it is expected and
  encouraged — retune the `tailwind-variants` `tv()` recipe, adjust the `data-slot`
  markup, change the `bits-ui` wiring. Mold the component in place; don't wrap it in a
  bespoke look-alike that reimplements what the copy already does. `bits-ui` is the
  headless primitive layer underneath the interactive components (Dialog, and the overlays
  to come).

## Token-bridge discipline

Components consume caret's palette through the **bridged shadcn semantic variables**
(`--background`, `--primary`, `--border`, `--ring`, …), never raw color. The bridge lives
in exactly one place — the shadcn semantic `:root` block plus the `@theme inline` map in
`ui/src/app.css` — mapping each shadcn var onto a caret token with `var(--caret-token)`
(the same pattern the `.diffview` → `--diffs-*` bridge uses).

- **`theme.ts`'s `THEMES` registry stays the single color source.** `applyTheme` writes
  caret's tokens inline on `:root`, and because the shadcn vars are `var()`-bridged to
  them, shadcn components retint on theme switch with no per-component change.
- **No raw hex or oklch in a component.** A color belongs in a caret token, bridged to a
  shadcn var; a literal in a component bypasses both. `shadcn-bridge.test.ts` pins the
  mapping (every semantic var → a caret token, no hex/oklch, amber reaches shadcn only via
  `--primary` and `--ring`), so a drift fails the unit suite.
- **Tailwind generation is scoped to the copied tree.** `app.css` imports Tailwind with
  `source(none)` and a single `@source "./lib/components/ui"`, so utilities are emitted
  only for the shadcn components — caret's own semantic classes (`.chip`, `.collapse`, …)
  are never clobbered by an auto-detected utility. If you author Tailwind utilities in a
  caret chrome file, add that path to `@source`.

The deep detail — the full bridge invariants, the amber-scarcity rule, `color-mix(in lab)`
over `oklch` — lives in [`svelte-rules.md`](svelte-rules.md) § CSS-token discipline. Defer
to it rather than restating it here.

## Icon-swap convention

Stock shadcn-svelte components import icons from `@lucide/svelte`. caret vendors its icons
instead (EXC-395), so on any copied component:

- **Replace `@lucide/svelte` imports with `Icon.svelte`**
  (`ui/src/components/Icon.svelte`), and vendor any icon the component needs but the
  registry lacks, per [`icon-rules.md`](icon-rules.md).
- For a single throwaway glyph, inlining the Lucide SVG markup is acceptable — the Dialog
  close button in `dialog-content.svelte` inlines the Lucide `x` path rather than pull in
  the icon dependency. Reach for a vendored `Icon.svelte` entry once the glyph is reused.

Adding `@lucide/svelte` as a runtime dependency is not the convention; keep the vendored
pipeline as the single icon source.

## What stays custom

Not every surface is a shadcn candidate. These are caret-owned and are **not** to be
replaced by a catalog component:

- **The `@pierre/diffs` shadow-DOM surface** — `SourceView`, `SourceDiffView`,
  `DiffPlanView`. It's a shadow-encapsulated third-party render surface bridged through
  `--diffs-*`, not a light-DOM component.
- **`MarkdownEditor`** — the CodeMirror-backed comment composer.
- **The Icon pipeline** — vendored Lucide SVGs behind `Icon.svelte`, per
  [`icon-rules.md`](icon-rules.md).

## Testing note

The foundation ticket recorded the unit-vs-e2e verdict for bits-ui overlay components so
later work doesn't rediscover it — see `shadcn-foundation.test.ts`:

- A plain component (Button, no bits-ui) mounts **synchronously** under the bun-test
  happy-dom harness; its structure and `tailwind-variants` class output are
  unit-assertable.
- A bits-ui component (Dialog) mounts too, and its trigger reflects reactive open-state
  synchronously — but the **portalled content** (overlay + panel) is deferred, appearing
  only after effects flush *and* a timer tick advances. Poll with an effect+timer flush,
  don't assert synchronously (`flushUntil` in `ui/test-mount.ts`), and query
  `document.body` — the portalled content lands there, not inside the mount target.
- **Portalled content leaks between tests.** bits-ui teleports the overlay/content into
  `document.body`, and its portal presence waits for an `animationend` that never fires
  under happy-dom, so the nodes never self-remove on unmount. `ui/test-mount.ts` purges
  leaked portal nodes at every `render()` and `afterEach`; without that a later
  `document.body.querySelector("[data-slot=…]")` matches a **stale** portal from an
  earlier test — a real cross-suite failure EXC-761 hit (the foundation "Proof of life"
  title assertion started matching SettingsDialog's "Settings").
- **Takeaway**: bits-ui overlays are unit-mountable for **structure / ARIA** assertions
  (with the async flush), but their real interaction semantics — focus trap,
  Escape-to-close, outside-click, focus restoration, scroll lock — are real-browser
  behaviors and stay **e2e**. The unit-vs-e2e split is governed by
  [`browser-testing.md`](browser-testing.md); defer to it.

## Related rules

- [`svelte-rules.md`](svelte-rules.md) — Svelte 5 idioms, state factories, and the
  CSS-token discipline the shadcn bridge extends.
- [`icon-rules.md`](icon-rules.md) — the `Icon.svelte` render path and vendoring a new
  icon.
- [`browser-testing.md`](browser-testing.md) — the unit-vs-e2e decision for interactive
  components and the e2e harness contract.
