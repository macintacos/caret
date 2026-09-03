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
`bunx shadcn-svelte@latest add <name> --no-deps -y` copies the component's source into
`ui/src/lib/components/ui/<name>/` (config: `ui/components.json`; the `$lib` import alias
the copies assume is declared there and resolved by `ui/vite.config.ts` +
`ui/tsconfig.json`, and the `cn()` class-merge helper lives in `ui/src/lib/utils.ts`).
Button and Dialog already live there as the proof-of-life pair.

Three things about that invocation. The CLI reads a `package.json` **beside**
`components.json`, and caret keeps a single manifest at the repo root — so
`ui/package.json` is a minimal stub that exists only to satisfy the CLI (without it, `add`
dies with `ENOENT … ui/package.json`). Pass `--no-deps`: the component's own packages
(`bits-ui`, `tailwind-variants`, `clsx`, `tailwind-merge`) already live in the root
`node_modules`, which bun resolves by walking up, so skipping the install step leaves the
stub and root lockfile untouched and never creates a `ui/node_modules`. It is hidden from
`--help` as of shadcn-svelte 1.5.0 but still supported — don't substitute the
`--no-deps-install` the help text does list in its place, which writes the dependencies
into the stub rather than skipping them. And pass `-y`: the CLI otherwise stops on a
"Ready to install components?" confirmation, which in an unattended agent run looks like a
silent hang rather than a prompt. The CLI pulls the *current* registry source, which may
be newer than what's already vendored — diff before you keep an overwrite.

Two facts that comparison needs, or it can't actually be performed (EXC-1109). **The
registry item lives at `https://shadcn-svelte.com/registry/styles/<style>/<name>.json`,
and caret's effective `<style>` is `nova`** — `ui/components.json` declares no `style`
key, so the schema default applies rather than the `vega` a URL builder falls back to.
Both styles resolve, so fetching the wrong one hands you a plausible source that is simply
a different style. **And don't expect the comparison to be byte-for-byte**:
`mise run format` runs a Tailwind canonicalizer over `ui/src/**/*.svelte` (`hk.pkl`) that
rewrites `data-[disabled]:opacity-50` into `data-disabled:opacity-50`, so a vendored file
diverges wherever that has something to rewrite — and the registry drifts on its own
besides. Read the diff for meaning, not for equality.

### Adding a component that collides with the vendored tree

`-y` covers the "Ready to install components?" confirmation and **nothing else**. A
component with `registryDependencies` pulls those trees in too, and the moment one of them
is already vendored the CLI stops on a second, separate prompt —
*"Would you like to overwrite all existing files?"* — which `-y` does not answer. In an
unattended run that reads as a hang. `command`, for instance, resolves to `dialog` →
`button`, `input`, `textarea`, `input-group`, four of which caret has already modified.

Pass `-o` (overwrite) so the CLI runs to completion, then
**revert every tracked file it touched**:

```bash
cd ui && bunx shadcn-svelte@latest add <name> --no-deps -y -o
cd .. && git status --porcelain          # exactly which trees it clobbered
git diff                                 # read it — this is the "diff before you keep an overwrite" step
git checkout -- .                        # drop the overwrites; the NEW trees are untracked and survive
git status --porcelain -- ui/package.json package.json bun.lock   # must be empty: proves --no-deps held
```

Two things to expect from that `git status`. The overwrites routinely revert caret's own
edits — the EXC-891 `data-[state=…]` animation spelling, the inlined Lucide `x` in
`dialog-content.svelte`, the commented class groupings — which is why the revert is
wholesale rather than selective. And a `registryDependency` arrives as a **whole tree**,
unused files included (`input-group` landed 7 files for the one `command-input.svelte`
composed; the three search fields that joined it in EXC-1113 still reach for only three of
the seven). Keep it: hand-editing the component to drop the dependency is the one change a
later re-sync silently reverts with no comment to catch it.

**A vendored tree with no consumer stays too** — including one that has lost its last
consumer, not just one that arrived unused. `item` (11 files, orphaned when EXC-1112
rebuilt the settings rows on `field`) and `scroll-area` are both in that state today, and
both stay. Deleting a tree looks like tidying, but re-adding it means another `add` —
which, per the overwrite dance above, drags every already-modified tree back through a
wholesale revert for the sake of files that cost nothing to leave alone. The verdict is
the same whichever tree it is, so it is recorded here once rather than re-litigated per
tree.

The divergence also runs the other way — a vendored file quietly dropping something the
registry passes through. `select-item.svelte` destructures `label` out of its props and
never forwards it to `SelectPrimitive.Item`, so bits-ui's `data-label` is unset on every
Select row in the app (EXC-1111). Harmless while a row's text *is* its label; a trap for
the first consumer whose row renders something richer. Forward it when that lands.

- **Never hand-roll a primitive the catalog covers** — button, dialog, menu, tooltip,
  badge, select, toggle group, and the rest. If shadcn-svelte ships it, add it.
- **The copied source is owned code, not a dependency.** Modifying it is expected and
  encouraged — retune the `tailwind-variants` `tv()` recipe, adjust the `data-slot`
  markup, change the `bits-ui` wiring. Mold the component in place; don't wrap it in a
  bespoke look-alike that reimplements what the copy already does. `bits-ui` is the
  headless primitive layer underneath the interactive components (Dialog, and the overlays
  to come).

### Edits a re-sync will silently undo

Because the revert above is wholesale, anything caret **added** to a vendored component
survives only if someone notices it went missing. One such edit is worth naming here,
since losing it breaks accessibility rather than looks:

**`command-list.svelte` renders a `Command.Viewport` that the registry source does not**
(EXC-1096). bits-ui derives the command input's `aria-controls` **and** its
`aria-activedescendant` from `CommandRootState.viewportNode`, which only
`CommandViewportState`'s `attachRef` ever sets — so a `Command.List` with no viewport
inside it leaves both attributes undefined on *every* `Command` in the app, and the
combobox names neither the list it controls nor the row the selection is on. Nothing is
narrated as its rows narrow, which is the whole reason `command` was vendored. The
viewport also carries `role="none"`: the list itself is the `role="listbox"`, and a
listbox may own options and groups but not a generic wrapper between them.

`ui/src/lib/shadcn-command-popover.test.ts` is the guard, and it reds if a re-sync drops
either half. Put the viewport back before you commit an overwrite of that file.

**That is the policy, not a one-off.** When the registry source is wrong on accessibility,
patch the vendored file and leave a test that reds if a re-sync drops the patch — the pair
is what makes the edit survivable. Don't work around an upstream defect at the call site
instead: a state prop set inside the component wins the merge, so the call site frequently
*cannot* fix it. Two known cases are still unpatched and want that treatment:
`select-trigger.svelte` publishes `aria-activedescendant` on a bare `<button>` with no
`role="combobox"` and no `aria-controls`, and its state props outrank anything a caller
passes (EXC-1111); and `toggle-group.svelte` gives the root `role="group"` while its
single-type items take `role="radio"`, which no `role="group"` may own (EXC-1112). Both
also deserve an upstream issue — patching here is the local fix, not the cure.

### A filter field never lives inside a dropdown menu

Reach for `command` in a `popover`, not a text field hosted in menu content (EXC-1098).
bits-ui puts `role="menu"` on dropdown content, a textbox is not among the roles `menu`
admits as children, and the role cannot be overridden from the call site — so a field
inside the menu gives a screen reader the field's label and then silence as its rows
narrow. The command-in-popover pair gives a real combobox whose `aria-activedescendant`
names the row the selection is on, over a listbox of real options.

`PlanBreadcrumbs.svelte` and `PlanToc.svelte` are both built this way, which is why the
plan's two heading surfaces narrate identically.

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
- **The bridge is not only color.** That same `@theme inline` map carries Tailwind's
  `--default-transition-duration` and `--default-transition-timing-function`, pointed at
  caret's `--dur-micro` / `--ease-out`, so a bare `transition-colors` in the vendored tree
  tints on the chrome's tempo rather than on Tailwind's 150ms default. Anything editing
  that block should know it governs motion as well as palette.

The deep detail — the full bridge invariants, the amber-scarcity rule, `color-mix(in lab)`
over `oklch` — lives in [`svelte-rules.md`](svelte-rules.md) § CSS-token discipline, and
the reasoning behind the two transition keys in that file's § Motion principles. Defer to
them rather than restating either here.

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
- **Style a Button by element — `button.x`, never `[data-slot="button"].x`.** `Button`
  writes its own `data-slot="button"` *before* it spreads `{...restProps}`, so the moment
  that Button is also a bits-ui trigger the primitive's slot value wins and every
  `[data-slot="button"].x` rule stops matching. Nothing about the markup looks different
  and no test goes red — the styling simply leaves, which is how EXC-1110 found the
  Discard button's `.danger` in `SourceAnnotationCard` (a `ConfirmPopover` trigger since
  that ticket) had quietly lost its trash-hover wobble. `atoms.css`'s `button.float-chip`
  is the durable form. For what is still on the fragile spelling, one trigger conversion
  away from the same failure: `grep -rn '\[data-slot="button"\]' ui/src`.
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
  so the current choice reads distinct from one that's merely hovered. **Which of the two
  wins depends on the primitive, and a `Select` is the opposite of a `DropdownMenu`.** A
  menu highlights nothing until the reader moves, so letting the highlight win is safe
  there — it only ever greys the amber row transiently, under the cursor. A listbox has no
  such state: bits-ui parks the highlight on the **selected** row as the content mounts
  (`setInitialHighlightedNode`), so highlight-wins leaves the panel *resting* with no
  amber in it at all, losing the current choice exactly when it is read. On a `Select`,
  declare `[data-selected]` after `[data-highlighted]`, and give the row that carries both
  its own mark for the highlight — an inset `--accent` ring in `SettingSelect.svelte`.
  That mark is not decoration: bits-ui focuses no row (it drives `aria-activedescendant`
  from the trigger), so `[data-highlighted]` **is** the listbox's keyboard cursor and has
  to stay visible on every row, the selected one included.
- **Modals compose `Modal.svelte`.** `ui/src/components/Modal.svelte` is the shared shell:
  `kind="dialog"` (dismissible, e.g. Settings) or `kind="confirm"` (an `alertdialog`
  guard, e.g. Approve/Reject) selects the bits-ui primitive, but the eyebrow, title,
  description, footer band, and raised-paper surface are styled **once** so the modals
  can't drift. A new modal reuses it instead of hand-rolling a Dialog. The shadcn
  `dialog-*` and `alert-dialog-*` `content`/`footer` are kept visually aligned as its
  base, and their **backdrop and their timing are shared outright** — one scrim, one blur,
  one enter/exit pair across all four Dialog and AlertDialog surfaces, declared in
  `styles/shadcn-bridge.css` § Modal choreography (EXC-892) rather than per vendored file,
  because a dismissible pane and a decision guard dimming the app differently is two
  backdrop languages in one app. A modal built on either primitive inherits all of it and
  should need no motion or backdrop CSS of its own. (`sheet-overlay.svelte` is not yet on
  it — no caret surface composes a Sheet today, though the vendored tree is live on the
  import graph; see § What stays custom. Fold it in when something reaches for one.)
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
replaced by a catalog component; the subsections below record the audit verdicts behind
that, including which vendored trees stay put:

- **The `@pierre/diffs` shadow-DOM surface** — `SourceView`, `SourceDiffView`,
  `DiffPlanView`. It's a shadow-encapsulated third-party render surface bridged through
  `--diffs-*`, not a light-DOM component.
- **`MarkdownEditor`** — the CodeMirror-backed comment composer.
- **The Icon pipeline** — vendored Lucide SVGs behind `Icon.svelte`, per
  [`icon-rules.md`](icon-rules.md).

### Audited and declined (EXC-857)

The EXC-857 audit reached "no" on the surfaces below, each against a specific catalog
component. Each names the code it rests on, so a verdict that stops being true fails a
check rather than quietly aging.

- **`FileDrawer`** over **`resizable`** — `resizable` is PaneForge, a new dependency
  governed by [`dependency-rules.md`](dependency-rules.md). FileDrawer is a docked lane
  with an opening and closing wipe, not a symmetric pane group, and it already has pointer
  capture (`FileDrawer.svelte:55`), an arrow-key step (`:87`), and a correct
  `role="separator"` carrying `aria-orientation`, `aria-valuenow`, `aria-valuemin` and
  `aria-valuemax` (`:113`–`:119`), with the drag math factored out into
  [`lib/fileDrawer.ts`](../../ui/src/lib/fileDrawer.ts). Adopting PaneForge would buy a
  pane group it isn't, and re-cost the accessibility it has.
- **`AlertHost`** over **`sonner`** — `sonner` needs **two** new dependencies
  (`svelte-sonner` and `mode-watcher`), and its registry file imports an
  `icon-placeholder` component caret does not vendor. It also brings an opinionated look
  and a second animation system, and would duplicate the dwell and the two-phase
  exit-then-remove that [`state/alerts.ts`](../../ui/src/state/alerts.ts) already owns.
  The card is already the vendored `alert`, and its motion is CSS-only on the shared
  `--dur-*` / `--ease-*` tokens, so `base.css`'s global reduced-motion clamp — which keys
  on where the node sits, not on which token supplied the duration — governs it for free.
- **`SplitButton`** over **`button-group`** — this one costs no new dependency
  (`registryDependencies: ["separator"]`, already vendored), so the reason is purely what
  it brings. `SplitButton` already composes the shadcn `Button` and `DropdownMenu`; only
  its fused-look wrapper is custom. What `button-group` adds on top is
  `ButtonGroup.Separator`, a visible rule between the halves — exactly what the EXC-760
  one-control language rejects. Adopting it means overriding away the one thing it brings.
- **`FilePreview` / `NotificationsPane`** over **`scroll-area`** — `scroll-area` is
  bits-ui's `ScrollArea`: a component-owned `Viewport` with overlay scrollbars, which puts
  an element between the component and the thing it drives. `FilePreview`'s `.fp-code` is
  a `tabindex`'d native scroll container (EXC-972 — Chrome and Safari leave a plain
  `overflow: auto` div out of the tab order, so that tab stop *is* the keyboard reading
  affordance), it sets `overflow-anchor: none` because `expand()` does its own `scrollTop`
  arithmetic on an upward chunk load, and `file-refs.e2e.ts` pins its computed metrics.
  `NotificationsPane` has no scroll region at all. The tree itself stays regardless, per §
  Adding a component that collides with the vendored tree.
- **`KbdCap`, `ModalPresence`, `StatusBar`** — the settled keeps: none is replaceable by a
  catalog component. `KbdCap` (`KbdCap.svelte`) is not a `Kbd` substitute — it renders cap
  *content* inside the vendored `Kbd` box the caller supplies, which is what lets the help
  modal wrap one cap per key while the status bar folds a whole chord into one.
  `ModalPresence` (`ModalPresence.svelte`, `lib/modalPresence.ts`) is the exit-animation
  gate (EXC-891) that keeps a surface mounted through its close via
  `onOpenChangeComplete`. `StatusBar` (`StatusBar.svelte`) is a pure layout container.

### The vendored `sheet` tree stays

It reads as orphaned — nothing caret wrote composes a Sheet — but
`ui/src/lib/components/ui/sidebar/sidebar.svelte` imports it for its `isMobile` branch,
and Sidebar *is* composed: `SettingsDialog.svelte` renders it as the Settings category
rail (EXC-843). caret never reaches that branch, because `SettingsDialog` passes
`collapsible="none"` and `sidebar.svelte` handles that case first — but `sheet` is still
Sidebar's registry dependency, so § Adding a component that collides with the vendored
tree applies unchanged: keep the whole tree. `grep -rn "components/ui/sheet" ui/src`
returns that one import and settles it; removing the tree and building confirms it the
expensive way:

```text
[UNLOADABLE_DEPENDENCY] Could not load src/lib/components/ui/sheet/index.js
   ╭─[ src/lib/components/ui/sidebar/sidebar.svelte:3:24 ]
 3 │ import * as Sheet from "$lib/components/ui/sheet/index.js";
```

`sheet-content.svelte`'s animation utilities carried the same dead `data-open:` /
`data-closed:` spelling EXC-891's finding removed from the dialog, popover and select
trees; EXC-1117 corrected them to `data-[state=open]:` / `data-[state=closed]:` along with
the rest of the tree, so the branch renders correctly whenever it is first reached. One
known-imperfection remains, deliberately left for whoever first composes a Sheet, since
the branch that would render one is dead code today: `sheet-overlay.svelte` is not yet on
the shared modal choreography, per § The caret surface language.

## Testing note

The foundation ticket recorded the unit-vs-e2e verdict for bits-ui overlay components so
later work doesn't rediscover it — see `shadcn-foundation.test.ts`:

- A plain component (Button, no bits-ui) mounts **synchronously** under the bun-test
  happy-dom harness; its structure and `tailwind-variants` class output are
  unit-assertable.
- A bits-ui component (Dialog) mounts too, and its trigger reflects reactive open-state
  synchronously — but the **portalled content** (overlay + panel) is deferred, appearing
  only after effects flush *and* a timer tick advances. Poll with an effect+timer flush,
  don't assert synchronously (`flushUntil` in `ui/support/mount.ts`), and query
  `document.body` — the portalled content lands there, not inside the mount target.
- **Portalled content leaks between tests.** bits-ui teleports the overlay/content into
  `document.body`, and its portal presence waits for an `animationend` that never fires
  under happy-dom, so the nodes never self-remove on unmount. `ui/support/mount.ts` purges
  leaked portal nodes at every `render()` and `afterEach`; without that a later
  `document.body.querySelector("[data-slot=…]")` matches a **stale** portal from an
  earlier test — a real cross-suite failure EXC-761 hit (the foundation "Proof of life"
  title assertion started matching SettingsDialog's "Settings").
- **Takeaway**: bits-ui overlays are unit-mountable for **structure / ARIA** assertions
  (with the async flush), but their real interaction semantics — focus trap,
  Escape-to-close, outside-click, focus restoration, scroll lock — are real-browser
  behaviors and stay **e2e**. The unit-vs-e2e split is governed by
  [`browser-testing.md`](browser-testing.md); defer to it.
- **Drive the gesture the primitive listens for, not the one you would perform.** A test
  that reaches for `.click()` and `pointerenter` out of habit passes vacuously against a
  `Select`, because bits-ui binds none of them: the trigger toggles on **`pointerdown`**
  (its `onclick` only calls `focus()`), a row commits on **`pointerup`**, and the
  highlight moves on **`pointermove`**. `shadcn-select.test.ts` and
  `SettingSelect.test.ts` carry the worked form; check the primitive's `props` getter in
  `bits-ui/dist/bits/<name>/*.svelte.js` before writing a new one. `flushUntil` exhausts
  its budget without throwing, so a test built on the wrong gesture goes green rather than
  red.
- **Where the test goes.** A primitive that stands alone gets its suite beside it
  (`components/ui/switch/switch.test.ts`); one that only makes sense composed with another
  gets a `lib/shadcn-<topic>.test.ts` plus a `lib/shadcn-<topic>-fixture.svelte`, beside
  `shadcn-foundation.test.ts` (the harness takes props, not children, so a composed case
  needs the fixture). Assert through `data-slot`, never through the registry's `cn-*`
  marker classes — those are defined in the registry style's own CSS layer, which caret
  does not import, so they are inert here and get renamed upstream freely.

### A bare `data-<word>:` variant is only for a presence attribute

Tailwind compiles a bare `data-open:` into an `[data-open]` **presence** selector. Where
the thing stamping the attribute gives it a *value*, the utility silently misfires — dead
(`data-horizontal:` against bits-ui's `data-orientation="horizontal"`) or always-on
(`data-active:` against Svelte's serialization of `isActive={false}` as
`data-active="false"`). Neither mode is visible to a mount suite, because happy-dom
computes no layout: EXC-1101 shipped a slider whose track was 0px tall behind 290 lines of
passing new tests.

So the bare form is legal only where bits-ui stamps the attribute as `"" | undefined`.
Today's tree uses four of those — `data-disabled`, `data-highlighted`, `data-selected`,
`data-placeholder` — and `PRESENCE_VALUED` in the gate lists exactly those. bits-ui stamps
around twenty more the same way (`data-readonly`, `data-invalid`, `data-today`, …), so a
newly vendored tree may legitimately extend the set: check `bits-ui/dist` before
converting a bare variant, and extend the allowlist when the attribute really is presence.
Everything else takes the valued bracket form (`data-[state=open]:`,
`data-[active=true]:`).

`test/structure/shadcn-data-variants.test.ts` is the gate; it reads every `.svelte` and
`.ts` file in the vendored tree, so a re-sync restoring a stock spelling reds `bun test`
rather than waiting for someone to look at the pixels. Correct a violation at the
**selector**, not by changing what the component stamps — caret's own CSS selects
`[data-active="true"]` in `SettingsDialog.svelte`, and switching the stamp to presence
would break those rules while letting the guard go green on a re-synced bare class.

## Related rules

- [`svelte-rules.md`](svelte-rules.md) — Svelte 5 idioms, state factories, and the
  CSS-token discipline the shadcn bridge extends.
- [`icon-rules.md`](icon-rules.md) — the `Icon.svelte` render path and vendoring a new
  icon.
- [`browser-testing.md`](browser-testing.md) — the unit-vs-e2e decision for interactive
  components and the e2e harness contract.
