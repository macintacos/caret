# shadcn Rules

*Audience: coding agents and contributors building or reshaping UI in `ui/`.*

caret's UI composition is **shadcn-first**. The Tailwind v4 + shadcn-svelte foundation
(EXC-757) and the caret↔shadcn token bridge (EXC-758) are in place, so any new UI element
that a component library covers starts from a shadcn-svelte component — not from a
hand-rolled primitive. This file is the rule-of-the-road for that norm: how to add a
component, how it inherits caret's palette, how icons get swapped, and what deliberately
stays custom.

## The compose-first norm

Reach for a shadcn-svelte component first. From `ui/`,
`bunx shadcn-svelte@latest add <name> --no-deps` copies the component's source into
`ui/src/lib/components/ui/<name>/` (config: `ui/components.json`; the `$lib` import alias
the copies assume is declared there and resolved by `ui/vite.config.ts` +
`ui/tsconfig.json`, and the `cn()` class-merge helper lives in `ui/src/lib/utils.ts`).
Button and Dialog already live there as the proof-of-life pair.

Two things about that invocation. The CLI reads a `package.json` **beside**
`components.json`, and caret keeps a single manifest at the repo root — so
`ui/package.json` is a minimal stub that exists only to satisfy the CLI (without it, `add`
dies with `ENOENT … ui/package.json`). And pass `--no-deps`: the component's own packages
(`bits-ui`, `tailwind-variants`, `clsx`, `tailwind-merge`) already live in the root
`node_modules`, which bun resolves by walking up, so skipping the install step leaves the
stub and root lockfile untouched and never creates a `ui/node_modules`. The CLI pulls the
*current* registry source, which may be newer than what's already vendored — diff before
you keep an overwrite.

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

- **`theme.ts`'s `THEMES` registry stays the single color source.** `paintTheme` writes
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

## The caret surface language

The TopBar cluster (EXC-760) set the look every neutral control follows; keep new surfaces
consistent with it rather than inventing a per-component treatment.

- **Neutral controls wear `.float-chip`.** A button, a dropdown trigger, or any resting
  control that isn't the primary action uses `variant="secondary"` **plus**
  `class="float-chip"` — a soft solid fill (`--chip`) lifted off the surface with
  **no hard border**, whose label rides `--ink-soft` and brightens to `--ink` on hover /
  while its menu is open (`aria-expanded`). The `.float-chip` atom +
  `--chip`/`--chip-hover` tokens live in `app.css`. Don't give a neutral control an
  outline border; the chip fill is the affordance.
- **Amber stays the single primary.** One action per surface carries amber
  (`variant="default"` → `--primary`); everything else is a neutral chip. Don't spend
  amber on secondary controls.
- **Borders are hairlines, never bright.** Tailwind v4 defaults a bare `border` to
  `currentColor` (the ink), which paints a bright near-white line on caret-dark. The
  `* { border-color: var(--color-border) }` base rule in `app.css` bridges that default to
  `--rule` (the ~10% hairline), so a copied component's `border`/`border-t` resolves
  quiet. For a floating panel edge prefer a soft ring (`ring-1 ring-foreground/10`) over a
  border. If you still see a bright divider, a component is overriding the bridged color —
  fix the component, don't add another border on top.
- **Menu highlight vs. selection.** A menu/select row's hover/keyboard highlight is
  `bg-accent`, bound (via `--color-accent`) to `--chip-hover` so it matches the topbar's
  button hover app-wide. The **active/selected** row instead carries an amber wash
  (`--accent-wash`) — the same "amber marks the selection" language the diff view uses —
  so the current choice reads distinct from one that's merely hovered.
- **Modals compose `Modal.svelte`.** `ui/src/components/Modal.svelte` is the shared shell:
  `kind="dialog"` (dismissible, e.g. Settings) or `kind="confirm"` (an `alertdialog`
  guard, e.g. Approve/Reject) selects the bits-ui primitive, but the eyebrow, title,
  description, footer band, and raised-paper surface are styled **once** so the modals
  can't drift. A new modal reuses it instead of hand-rolling a Dialog. The shadcn
  `dialog-*` and `alert-dialog-*` `content`/`footer` are kept visually aligned as its
  base.
- **Palette-derived affordances read the registry.** Anything that visualizes a theme (the
  Settings theme swatch) derives its colors from the `THEMES` token set in
  [`lib/theme.ts`](../../ui/src/lib/theme.ts), not literals — so any future palette works
  with zero per-theme wiring (a token every theme must supply is safe to index).

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
