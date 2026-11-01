# Patterns

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

How caret builds things. Values live where [`tokens.md`](tokens.md) says; the rules for
specific code areas live in [`doc/agents/`](../doc/agents/).

## Review UI

### Surfaces and emphasis

- The chrome is a silicone keypad. Anything that can be pressed stands as a rubber key (a
  cap, in the code), and anything that can't is stamped into the surface. The kit lives in
  `ui/src/styles/atoms.css`.
- Floating surfaces are smooth, never grained, and lit along their top edge: `--float-mid`
  under menus, popovers, toasts and the composer, `--float-high` under modals, and
  `--float-low` under a saved comment. A float's ring follows its height: low and mid
  floats take a `--rule` ring and modals a `--rule-strong` one. A surface wears the
  composite for its height, `--float-surface-low`, `-mid` or `-high` in
  `ui/src/styles/derived.css`, which carries the rim, the ring and the shadow, so a call
  site never picks a ring. `--shadow-chip` stays under small hints and overlays, such as
  the drag readout, the editor tooltip, the link hover and tooltips, which sit on
  `--paper-raised` with no arrow.
- **A band on a floating surface is a step in its panel**, never a ruled strip. A modal's
  header is a lip its content tucks under. Its footer is a shelf on `--group-floor` one
  step below, where the action tray rests. The composer's actions and the comment
  navigator's legend rest on the same shelf. The esc hint carries no chip: it reads "esc
  to close" in `--ink-soft`.
- **A modal's title stands alone.** No tag or label sits above it, so the title names what
  the modal is for, such as "Keyboard shortcuts".
- **A dialog labels its fields and sections in sentence case** (`.form-label`), at
  `--text-sm`, weight 600, `--ink-soft`, as Settings heads its sections. "(optional)"
  follows the label at body weight. The shortcut groups and the Contents panel's
  breadcrumb headers wear it too, so no section label is set in capitals.
- **Read-only text inside a dialog**, such as the compiled preview and the context lines,
  sits in a cut on `--group-floor`.
- **The window is a body, and the plan is a pane set into it.** Every control is cut into
  the body (`--body`), and chrome never paints a bar face or a rule. The body is grained
  rubber, lit faintly from above over the chrome (`--chrome-light`). The pane is a screen
  set into it, inset `--pane-gap` with `--pane-radius` corners. Its recess,
  `--pane-recess`, is a soft inset shade that reaches down from the top edge, with a 1px
  contact edge and no outer layer, and the body's lit edge round it is `--pane-lip`. Each
  view fills the pane with one floor. In the source view and the version compare, where
  the diff library draws the plan, the room past the rows takes the rows' `--paper-sunk`.
  The preview stays on `--paper`. The pane's edges shade the text under them with
  `--pane-shade`: the top once the plan has scrolled (`data-scrolled` on `.plan-pane`),
  the bottom while more lies below (`data-more-below`). The file drawer is a second pane
  beside the plan, and the gap between them is the resize handle. It shades its edges as
  the plan pane does: its foot while more of the file lies below, and the gutter's edge
  while the code is scrolled sideways under it. Its gutter draws no rule. The empty screen
  is the same pane, and the daemon banner sits on the body. Text cut into the body is
  `--ink-soft` at its faintest, because `--ink-faint` falls under 4.5:1 there in several
  palettes.
- **A sheet hangs from a pane's top edge.** It tucks under the pane's lip (`--pane-lip`,
  z-index 5 over the sheet's 4), so it carries no `--float-rim` and paints no top shade.
  It is square at the top, and its foot rounds at
  `calc(var(--key-radius) + var(--well-pad) + 3px)`, 14px: the bed's 11px plus the sheet's
  own 3px pad round it. That matches the plan pane's corner, and its contents nest. It
  wears `--paper-raised` with a `--rule` ring on `--float-mid`, and drops in from
  `translateY(-100%)` over `--dur-state`. The plan search is the only sheet.
- One emphasis per view. The amber accent is used verbatim, never lightened, and only for
  the wordmark, the primary action, and the text cursor. Everything else steps down
  through `--ink-soft` and `--ink-faint`.
- Page structure is left-aligned.
- Compose from shadcn-svelte first ([`shadcn-rules.md`](../doc/agents/shadcn-rules.md));
  icons are vendored ([`icon-rules.md`](../doc/agents/icon-rules.md)).

### The tactile kit

- **Beds.** A control sits in a bed: a shallow cut in the chrome's own rubber. The code
  calls a bed `.tray`, and its pad tokens keep the `--well-` prefix; `--well-floor` and
  `--well-shade` belong to a stamp's pocket, not a bed. A bed has no floor of its own. Its
  shading (`--bed-shade`) darkens just under its top edge and lights the cut's lower wall
  and the lip below it. The keys cast their shadow onto the same material they stand on. A
  group of controls shares one bed, and a lone control gets its own, with `--tray-gap`
  (5px) between keys. Every bed shows the same 3px gap (`--well-pad`) round the key's
  visible face and side. Its top pad (`--well-top`) adds the key's rise, and its foot
  (`--well-foot`) adds the key's side less the rise, so the gap stays even. A bar holding
  beds trims its own padding by the same amounts to keep its height. Every cap rounds at
  `--key-radius` (8px), whatever its Button `size`. A bed rounds at `--key-radius` plus
  `--well-pad`, 11px, so the two corners stay concentric. The row-wide scratch marker is a
  `button.tray` and keeps its tinted floor.
- **Nested corners.** Where a rounded shape rests near another's corner, the inner radius
  is the outer radius less the inset between them, so the gap round the corner matches the
  gap along the sides. The inset is the distance from the outer shape's edge to the inner
  shape's, usually the outer shape's padding. The inner shape's kit radius is the anchor:
  `--key-radius` for keys and key rows, `--radius` for fields. The outer shape rounds at
  that plus the inset, as a bed rounds at `--key-radius` plus `--well-pad`. Where the
  outer radius would leave the inner one at zero or less, the inner shape keeps its kit
  radius and the outer one grows to that radius plus the inset. A setting group is the one
  exception. Its padding, `--group-pad`, is so wide that you can't compare the gap at its
  corner with the gap along its sides, and the concentric radius, 25px, made the group
  much rounder than the keys inside it. The group is a bed, so it rounds as one:
  `--key-radius` plus `--well-pad`, 11px. `test/e2e/concentric.e2e.ts` holds the group and
  each of these to half a pixel:
  - a modal with a footer shelf rounds at its tray's corner (`--key-radius` plus
    `--well-pad`) plus the shelf's padding;
  - Settings, which has no shelf, rounds at its search field's `--radius` plus the rail
    header's padding;
  - the comment composer rounds at `--composer-radius`: its tray's corner plus
    `--composer-inset`, its padding;
  - a menu, the Select listbox, and the Contents and heading-filter panels round at
    `--key-radius` plus the inset round their rows. Their filter field's inset is the
    panel's radius less `--radius`;
  - the Discard confirm bubble pads its action tray evenly and rounds at the tray's corner
    plus that padding;
  - a saved comment's header controls round at the card's corner less the header's
    padding;
  - in Request changes, the committed tray rounds at its card's corner plus its padding,
    and a card's context lines at the card's corner less `--well-pad`;
  - a thread's recess rounds at its cards' `--radius-lg` plus its padding. Its foot widens
    to `--composer-radius` plus that padding while the composer edits its last card;
  - a shape that fills its container's edge, such as a modal's footer shelf or the
    compiled preview's trigger, takes the container's corners rather than being clipped to
    them.
- **Segmented controls.** A segmented control is a gang of keys in one bed, 3px apart
  rather than `--tray-gap`, each rounded to 4px where it faces a neighbour, like the split
  Approve. The chosen segment latches down, as a latched toggle does, and shows no amber
  light: one key in the group is always down, so being down is the signal. Every other
  segment is a resting key that hovers and presses.
- **Caps.** `.float-chip` is the neutral cap, and every neutral control wears it. The
  amber primary wears `.cap-accent`, which the vendored Button's default variant applies.
  A destructive confirm, such as Reject anyway, wears `.cap-danger`; the top bar's Reject
  stays neutral and takes the danger face on hover (`.cap-danger-hover`). One cap rule in
  `atoms.css` paints every cap and every segment of a toggle group. A cap is a soft rubber
  key:
  - Its face is domed: a lift along its top (`--cap-lift`), kept above the label, and a
    darker foot (`--cap-foot`). The face's middle stays its own colour, so the amber stays
    verbatim. A soft gloss (`--rubber-gloss`) lights its top edge, and no line is drawn
    round it.
  - Below the face shows the key's rubber side, `--key-side` (1.5px) deep: the face mixed
    toward black by `--cap-side-mix`, its last pixel softened, then a soft cast shadow
    (`--rubber-cast-near`, `--rubber-cast`) whose offset and blur scale with the side.
  - At rest it stands `--key-rise` (0.75px, half the side) above its place in the layout.

  An amber or danger cap takes the `--tinted-*` lift, foot and side, retuned for a bright
  face. A component tunes a cap through that rule's `--cap-*` properties (`--cap-face`,
  `--cap-face-hover`, `--cap-face-down`, `--cap-face-press`, `--cap-label`,
  `--cap-label-hover`, `--cap-lift`, `--cap-foot` and `--cap-side-mix`), never with a
  `background` shorthand, which drops the grain. `--cap-now` is the face the cap wears in
  its current state, and its side mixes from it. The neutral label is `--ink-soft` stepped
  15% toward `--ink`, because plain `--ink-soft` misses 4.5:1 on the neutral face in some
  palettes.
- **Split button.** The split Approve is two keys 4px apart, each rounded to 4px where it
  faces the other. Each hovers and presses on its own.
- **Press.** A press takes a cap `--key-sink` (0.5px, a third of the side) below its
  place, 1.25px below rest. Its shading flips concave, dark at the top where it was lit,
  and its side and shadow fold away. Its face (`--cap-face-press`) is never lighter than
  the hover it comes from: in light the hover face, in dark the down face. On release it
  springs back past rest (`--ease-spring`). A toggle that is on (`aria-pressed`) stays
  down and shows a small amber light with a soft glow in its corner, so a latch reads
  apart from a press. A disabled cap sits at its place, with no rise and a 1px side, and
  the Button fades it. A ghost control (`.cap-ghost`) has no cap, so a press leaves a
  shallow inset shadow instead. Under reduced motion `--key-rise` and `--key-sink` are 0,
  so no key moves and only its shading changes.
- **Focus is the hover.** A control under keyboard focus wears exactly its hover look and
  draws no ring: no outline, halo, inset ring or glow. Text fields are the exception
  (below).
  - Add `:focus-visible` beside every `:hover` rule, and give a focusable control with no
    hover look one.
  - A hover face is the only mark of keyboard focus, so it reads at least 3.5 CIE76 ΔE
    (colour difference) off its rest in every palette, which `theme.test.ts` pins. In
    light it steps no further than that, because a darker hover reads as disabled rather
    than raised. On a risen face only `--ink` holds AA, so quieter text there steps up to
    `--ink`. A glyph there needs only 3:1, so it steps to a neutral key's label ink and
    stays a rung under the text.
  - A control that shows only under the pointer, such as the gutter "+", stays while it
    holds keyboard focus.
  - `base.css` drops the browser's outline. In a shadow root, drop it in the root's own
    sheet too. Under forced colors, which strip faces and shadows, `base.css` keeps a
    transparent outline that the browser repaints in a system colour.
- **Submit trays.** A tray that submits is marked `.tray-submit` at the call site, never
  inferred from the cap it holds. It is smaller than the rest of the kit: caps of
  `--cap-submit-h` (28px) with `--text-base` labels, where the other caps are 32px, and
  every cap in it shrinks with it. The top bar's bell and settings keys match it, so every
  key in the top bar is the same height. The submit trays are Approve in the top bar,
  Comment and Save in the composer, Send for revision, the guard confirms (Approve with
  comments, Reject anyway) and the confirm bubble's Discard. Enable notifications is not a
  submit and keeps the full size.
- **Stamps.** Passive labels (`.stamp`, counts, the comment states, the file preview's
  line-range readout, the waiting screen's hint, the build tag's "Copied") sit in a
  pocket. Unlike a bed, a pocket has a darker floor (`--well-floor`) and its own shade and
  lip (`--well-shade`, `--well-lip`), and holds no cap. A passive status mark, such as the
  Notifications bell, sits in a pocket too, and a state word beside it takes the comment
  stamps' word ink. `.tag` is the stamp that names a kind in small caps: Folder, Preview
  and Settings' "In use". Text fields (`.field-well`) take a shallower cut,
  `--panel-recess`, with no ink ring.
- **Settled values are stamped.** A committed value leaves its field for a `.stamp` set on
  the field's exact pixels, so committing changes only the material. The committed search
  query is the example, and because no field keeps focus, bare-key shortcuts still work
  after a search.
- **Text fields draw no focus ring.** A focused `.field-well` lights one wall of its cut
  with `--field-wall`, `--field-edge-focus` on the lower wall in dark and the upper wall
  in light, and the amber text cursor shows the rest. A Command's filter field, in the
  Contents panel and the breadcrumb bar, can't wear the class, so one rule in `atoms.css`
  mirrors the recipe by appending `var(--field-wall)` to its rest cut. Read-only text that
  takes focus, such as the file preview's code region, lights its wall the same way.
- **Modals draw no focus ring around themselves.** A modal takes focus on its own panel
  when it opens, so its keys work at once. It has no hover look either, and `base.css`
  leaves `[data-slot="dialog-content"]` and `[data-slot="alert-dialog-content"]` out of
  the forced-colors outline, so every modal built on the vendored Dialog or AlertDialog
  follows it.
- **The key row.** A row in a list is a key lying flat in it: `.key-row` in `atoms.css`,
  its states in the `--key-row-*` tokens. It is flat at rest, rises on
  `--neutral-face-hover` with a key's lift, side and shadow under the pointer or the
  keyboard, and latches down on `--neutral-face-down` when chosen (`data-active` or
  `aria-current`). A press sinks it, as a press sinks a cap, on `--neutral-face-press`,
  under the pointer and under a menu's highlight. The press selector doubles the class
  (`.key-row.key-row`) to match the rise rules' specificity, so it wins by source order.
  It keeps the same layers in every state, so changes transition, and its movement is
  `translate`, which never reflows. It is not a `.cap`, because a `.cap` expects a tray
  around it. Its users:
  - every dropdown row (`dropdown-menu-item`, `dropdown-menu-sub-trigger`), and a
    sub-trigger stays risen while its submenu is open; command rows opt in at the call
    site, because `PlanToc` draws its own key inside the item;
  - the Settings nav, the theme list, the version picker, the breadcrumb menu, whose
    headings on the trail latch (the crumbs in the bar borrow only the risen state, on
    `--crumb-face-hover`, which in light is the white face the bar's keys rest on, and
    never latch; the current crumb is marked by weight), the comment navigator and the cwd
    path;
  - the folder tree, a shadow-DOM list that wears the `--key-row-*` tokens directly, with
    a `:focus-visible` row risen and the chosen row latched. It keys on `:focus-visible`
    rather than the library's `data-item-focused`, so a pointer click never raises the
    row; once the pointer leaves, the row shows only its latched face. The library's own
    ring never draws.

  In a menu or listbox the highlight is the only cursor, so a row rises on
  `data-highlighted` and never on hover. In a bits-ui listbox (a Select),
  `[data-selected]` means the chosen option, so the chosen row is named by `data-active`
  and latched, never risen. The Contents row is the one key row outside the atom. It wears
  the `--key-row-*` rise and press, so it stands as low as every other key row. It rises
  from its indent onward, and latches onto `--neutral-face-latched` while it is the
  section being read, an open exception to the accent rule
  ([`decisions.md`](decisions.md)). A key row's keyboard indicator is its hover look, so
  the row the keys move to looks exactly like the row the pointer moves to. A chosen row
  under the highlight stays down on the hover face, so the highlight reads on it too.
- **Setting groups.** Each Settings section's rows sit in a bed on `--group-floor` with
  `--bed-shade`, rounded at `--key-radius` plus `--well-pad` plus `--group-pad`, parted by
  space with no hairline. The nav's sections share one bed (`.tray` on `--group-floor`),
  and the chosen one latches down as a key row. Section headings are sentence case at
  `--text-sm`, weight 600, in `--ink-soft`.
- **The switch and the meter.** The switch is a latching key: a small rubber key
  (`--knob-*`, with `--nub-radius` corners), light in both schemes, with the keys' lift,
  foot and a 1.5px side. On, it slides over on `--ease-out`, not the keys' spring, and
  stays down, its side folded away and its shading concave. The latched key keeps a hard
  shade line, because a blurred shade smears a key this small. When the switch is on, the
  channel takes `--switch-on`, the accent mixed into the well's floor. The tint follows
  the version compare toggle, whose face latches onto `--neutral-face-latched`. It is an
  open exception to the accent rule
  ([`decisions.md`](decisions.md#open-where-the-code-still-differs)). The slider is a
  20-pip level meter, one pip per 5% step, with lit pips in `--ink-soft` over
  `--meter-off` and no knob; the meter is the target, and focus lights its pips as hover
  does. The switch's key nests 2px inside its well, so the well rounds at `--nub-radius`
  plus 2px.
- **The copy and wrap tray.** `CodeChromeTray` is the one copy and wrap tray, and its host
  places it: `CodeBlockChrome` in the plan, the block corner in Settings, and
  `UpgradeCommand`, which sets its tooltip (`copyTooltip`) to "Copy command" in place of
  the default "Copy code". The wrap cap shows only on overflow, and a copy confirms in
  place, with no toast.
- **Keycaps.** Key hints stay caret's own `[data-slot="kbd"]` keycap and ride along with
  their control. A keycap is a little rubber nub with `--nub-radius` corners, a little
  taller than it is wide for one glyph and wider for a chord at the same height. Its face
  is a translucent tint of the text colour around it, deepening toward its foot, so a key
  takes its container's colour. A soft gloss lights its top, and a 1.5px side
  (`--nub-side`) and a small shadow (`--nub-cast`) stand it off its cap. Its glyph sits in
  the face's middle. The shift key draws Lucide's `arrow-big-up` at the glyphs' height and
  stroke weight. Keycaps get no well or press of their own.
- **Saved comments.** A comment card has no rail. Its state is a stamp in its header, a
  glyph and a word in the state's own hue. The stamp's strengths are the `--stamp-floor`,
  `--stamp-word-toward` and `--stamp-word-mix` tokens in `ui/src/styles/tokens.css`, per
  scheme, and `theme.test.ts` reads them there and holds every word to 4.5:1 on its stamp
  in every palette. A thread of saved comments rests in a recessed group, with no
  hairlines between its cards. The unanchored list's items wear the saved card, and their
  quote is stamped on `--mark-orphan`.
- **Unsent comments** (`scratch` in code, `SourceScratchMarker.svelte`). The plan marks a
  comment kept with **Keep for later** by a full-width `button.tray` under its line. Its
  floor is `--well-floor` mixed with `--attention` at `--unsent-floor`. It holds the
  `message-square-more` glyph and the word "Unsent" in the comment stamps' word ink, the
  kept text in `--ink-soft`, and a neutral Resume cap. The row hovers and presses that
  cap. It does so through the `button.tray:hover > .cap` and
  `button.tray:is(:active, [data-key-pressed]) > .cap` rules in `atoms.css`.
  `theme.test.ts` holds the word and the text to 4.5:1 on the tinted floor in every
  palette, and `tactile-kit.e2e.ts` seeds an unsent comment to cover the marker's cap.
- **Unsent everywhere.** Every surface marks an unsent comment with the word "unsent", the
  `message-square-more` glyph in the comment stamps' word ink, and the tinted well. The
  word is never "draft". Size picks the tint: a row or a list takes `--unsent-floor`, and
  a pill-sized count, such as the Contents panel's, takes the stamp's `--stamp-floor`. An
  unsent section's label leads with the glyph in the word ink, and its text stays
  `--ink-soft`. In Request changes, a committed row is a paper card, the saved comment's
  low float, resting in a recessed tray, and an unsent row is a tinted well on the panel.
  The Approve and Reject guards list each kind in its own group: committed comments in a
  recessed group with hairline rows, unsent ones in a tinted well. The comment navigator
  rests an unsent row as the tinted well with the glyph and "unsent", and a hovered or
  current one becomes a key like any other row.
- **Ink on a tint.** Text and icons on the unsent tint use `--ink-soft` or stronger, never
  `--ink-faint`, which falls below 4.5:1 there (2.80 to 4.33:1). Disclosure chevrons
  follow the same rule.
- **A row-sized well holding a tray** pads `--well-pad` and rounds at
  `calc(var(--key-radius) + 2 * var(--well-pad))`, so the tray inside, which rounds at
  `--key-radius` plus one pad, stays concentric. A control beside the tray that fills the
  well's height, such as a disclosure toggle, takes the tray's radius.
- **Schemes.** In a stylesheet or a `.svelte` `<style>` block, a value that differs
  between light and dark keys on the `data-theme` attribute `paintTheme()` sets, never on
  `light-dark()`. Lightning CSS, which builds caret's stylesheets, rewrites a
  `light-dark()` into variables that never see the inline `color-scheme` set by
  `paintTheme()`, so it always resolves to the dark value. The diff library's shadow-DOM
  sheet (`ui/src/lib/diffview/coreStyles.ts`) is not built by Lightning CSS and keeps its
  `light-dark()`.
- **A key on no bed** stands straight on the surface, with a key's face, grain and press
  at the lowered rise. The gutter "+" and the file preview's round close disc, kept on
  `--danger`, share the recipe.
- Not used: glass and heavy gradients. The only glows are lights: the status bar's live
  LED, the status lights in Settings and the safe-mode toast (`.led` and `.led-off` in
  `atoms.css`), each lit in its state's colour, and a latched key's corner light.

### Type and shape

- Geist for UI text and prose; Berkeley Mono for code, the `^` carets, paths, line
  references, and the version tag.
- Every font size comes from the `--text-*` ramp. A raw `font-size` fails the type-scale
  contract test; a genuine display one-off stays literal with a comment saying why.
- Radii follow size: 10px panels (`--radius-lg`), 6px fields and menu rows (`--radius`),
  pill badges and meters. The keypad rounds rounder: 8px keys (`--key-radius`), wells at
  that plus their pad, 5px keycaps and the switch's key (`--nub-radius`), 12px pads
  (`--pad-radius`) and the 14px plan pane (`--pane-radius`). A container whose corner
  holds another rounded shape rounds wider, per **Nested corners** in the tactile kit.

### Motion

- Every state transition takes 160 ms on the strong ease-out
  `cubic-bezier(0.22, 1, 0.36, 1)` (`--dur-state`, `--ease-out`): hover and focus tints,
  surfaces entering and leaving, and controls sliding between positions. The curve covers
  most of the distance at once, then brakes hard.
- A key's return from a press is the one spring: it travels back over `--dur-state` on
  `--ease-spring`, past rest and back. The press itself, and every shading and colour
  change, stays on `--ease-out`.
- Ambient loops (the empty screen's floating `^`, the reference-hint ping, the safe-mode
  pulse) and the plan's scroll travel are not state transitions and keep their own timing.
- Motion is CSS only. A Svelte JS transition throws under happy-dom and ignores reduced
  motion; `ui/src/lib/motion.test.ts` enforces this.
- Reduced motion stops every animation. Where a timer swaps content (the carrot fact), the
  timer stops too. No key travels under it: `--key-rise` and `--key-sink` are 0.

### Plan surface

- Hover and drag highlights in the preview cover full visual lines, never part of a line.
  The file preview's cited band follows the same rule, through the gutter and across the
  whole scroll width.
- **A task box is a stamp's pocket** with its check or slash pressed in, drawn in CSS, in
  both views. A 1px `--ink-soft` contact edge holds it to 3:1.
- **An image stands on a raised pad**, as a table and a code block do, in both views.
- Passive chips (bold, italic, code) are pressed into the line with `--chip-stamped`, and
  clickable ones (links, file references, citations) stand a third of `--key-side` (0.5px)
  above it with `--chip-raised`, in both views. The preview and the source view share
  these values, and `coreStyles.test.ts` pins the preview's copies to the source view's.
- **A table is a raised rubber pad**, in both views:
  - The table is a pad of `--body` that stands on the plan as a key does, with a gloss
    along its top edge (`--rubber-gloss`), a side of the body darkened (`--pad-side`, its
    colour) and a soft cast shadow. `--pad-stand` is the shadow stack that draws the side
    and the cast shadow, scaled from `--key-side` so a pad keeps its proportion to a key.
    The pad rounds at `--pad-radius`.
  - The header rides a lit band along the pad's top (`--pad-top` fading into `--body`).
    Its labels are inked with `--table-head-ink` and pressed into the pad with
    `--label-pressed`.
  - The body rows sit in a soft scoop on the pad's face, on `--table-floor`, inset by the
    pad's 0.25rem padding, its rim. The scoop's corners nest at `--pad-radius` less the
    rim.
  - A `--table-floor-rule` hairline splits the rows, and no rule divides the columns.
  - In the source view, hovered and cursor rows band 7% toward `--ink` off `--table-floor`
    (`ui/src/lib/diffview/coreStyles.ts`), because the diff library's light hover band is
    the light floor's own colour.
- **A table's scoop is painted onto its rows**, because a border or a wrapping element
  would shift the monospace grid that search, drag ranges, vim motions and comment anchors
  resolve against.
  - Only the first row takes the scoop's shade under the rail (`--scoop-top`), and its
    negative spread keeps the shade off the row's sides. A blurred shadow on every row
    would break at each row boundary.
  - The last row takes the scoop's lit lip as a gradient of `--scoop-lip`, because a
    blurred lip would glow up the row's sides.
  - The preview paints both as gradients on the cells, the shade from `--scoop-shade`, for
    the same reason at each cell boundary.
- **A fenced code block is a raised pad**, built as a table is but with no header, in both
  views:
  - The block is a pad of `--body` with `--code-bezel` (0.25rem) of rim on all four sides,
    the table's gloss and `--pad-stand` side and cast shadow. The lit band runs along the
    top rim, with nothing on it.
  - Its code sits in a shallow scoop on the pad's face, on `--table-floor`, with the
    scoop's shade under its top edge (`--scoop-top`) and its lit lip at its foot
    (`--scoop-foot`). The floor keeps syntax colours at the contrast they have on the
    plan's paper.
  - Every line sits in the scoop, both fences included. The copy and wrap tray floats over
    the end of the first line, inside the scoop, and its caps are keys.
  - In the source view, hovered and cursor rows band 7% toward `--ink` off the floor, as a
    table's do. A selected line keeps the amber band.
  - The pad's side and shadow fall on the line below it, which the plan's reflow always
    leaves blank after a fenced block or a table.
- **A code block's frame stays put while its code scrolls.** The source view's card and
  the preview's `pre` are each their block's scroll container, so the frame is drawn only
  with parts that stay fixed to that box: the border is the pad's rim, a background
  clipped to the padding box is the floor, inset shadows shade the scoop, and outer
  shadows are the pad's side and cast shadow. The pad's gloss is a strip of
  `--rubber-gloss` across the border box, because an inset shadow would light the scoop's
  top edge instead. A wide block's scrollbar sits in the scoop, in its own strip below the
  last line. Both views draw the same thin bar.
- **A row in a table or a code block bands inside its scoop.** In the source view, a
  hovered or cursor row bands in the scoop alone, and its line number stays unbanded. A
  band in the gutter would show a gap and the pad's rim between it and the scoop's band.
  The number and the "+" mark a hovered row, and the keyboard cursor's bar at the gutter's
  left edge marks a cursor row. A selected line still bands the gutter and the scoop in
  amber, so a dragged range reads as one band.
- A chip has one depth. It sits on the chip's outermost member; a nested member, such as
  bold inside a link, carries it on its `::after` through `--nest-depth`, so the members
  show no seam (`ui/src/lib/diffview/coreStyles.ts`).
- Only a link that is itself a chip sinks when pressed in the preview, along with
  reference and citation code. A link wrapping code, a file reference or an image does not
  (`ui/src/components/PlanPreview.svelte`).
- Rendering rules live in [`plan-render-rules.md`](../doc/agents/plan-render-rules.md).

### Keyboard

- Keyboard first. Platform conventions always work, and vim keys sit on top where they
  don't collide with typing: `j`/`k`, `G`, `/` to search, `?` for help.
- Each control shows the key that activates it on the control itself (`KbdCap.svelte`,
  `SubmitCap.svelte`). The hints are on by default and the `caret.shortcutHints`
  preference hides them (`ui/src/lib/shortcutHintsPref.ts`). They are for desktop only: a
  touch device hides them in `ui/src/styles/atoms.css`.
- An open modal silences the review keymap.
- A shortcut runs at once and plays the press of the control that carries its
  `aria-keyshortcuts` for `PRESS_HOLD_MS`, 110 ms, a click's mousedown-to-mouseup
  (`ui/src/lib/shortcuts/pressEcho.ts`, which the dispatcher calls through its `onRun`
  hook). Pressing the key again restarts the hold.
- A key that opens a modal holds the modal's entrance, not the action. While a press
  echoes, the root carries `data-key-echo`, which delays the overlay's and the content's
  entrance by `PRESS_HOLD_MS`, so the cap's sink shows before the scrim. Focus and typed
  keys land at once, as they would without the hold.

### Sound

- Sound is part of the polish, on by default, with a setting to turn it off
  ([`RUNNING.md` § Sound](../doc/RUNNING.md#sound)).
- One cue per discrete state change or explicit action (`ui/src/lib/sound.ts`), never on
  scroll, hover, or pointer movement.
- A cue plays from inside the action it belongs to, so a key press and a click can't drift
  apart.

### Themes

- A light and a dark theme always; the UI follows the system by default.
- `caret-light` and `caret-dark` are composed separately; neither is the other inverted.

### States

- **Empty:** the waiting screen is caret's one brand moment; see
  [`exceptions.md`](exceptions.md). Any other empty view is one plain sentence.
- **Loading:** no indicator under about 1s. From about 2s, a labelled spinner, and the
  data animates in gently when it lands. Past about 10s or for many items, a count or
  percentage.
- **Errors:** shown beside what caused them, naming the problem and the fix. App-level
  notices go through `AlertHost.svelte`, and the safe-mode toast docks off
  `--status-bar-h` as it does. For example: "Couldn't load what's new — close this and
  open it again to retry."
- **Focus on open:** a modal that opens on its own, such as Onboarding or What's new,
  hands focus to its panel.

## Terminal output

### Every command

- Use the ANSI colour slots only, so the terminal's theme supplies the colours.
- Colour is off when the stream is not a TTY (checked for stdout and stderr separately),
  when `NO_COLOR` is set and non-empty, when `TERM=dumb`, when `--no-color` is passed, and
  under `CI=true`.
- Data goes to stdout; decoration and progress go to stderr. `--json` gives machines a
  stable shape.
- Symbols: `✓ ✗ • → ⚠ …`, plus others where they clarify. Shipped output uses plain
  Unicode, never Nerd Font glyphs, because the user's terminal font is unknown.
- Bold goes on one element: the line or value that carries the news.
- On success, name the state change and suggest the next command.
- Frame an error in a rounded block that names the problem and the fix.
- For progress, show a spinner on a short step, only while work is happening, then a final
  line that states the result. For many items, show a counter like `3 of 50`.

### Reports (`caret doctor`)

The reference layout for any report a command prints:

1. A header line: the command and version, with the schema id and timestamp dimmed and
   separated by middle dots.
2. Failures first, in one rounded block whose title is the bold failure count. Each
   failure gives its name, its detail, and `→` plus the command that fixes it.
3. Passing checks as `✓ name` with the detail dimmed, names aligned.
4. Every section the report always printed, with keys dimmed and aligned and no colons.
   Nothing the user knows is dropped.
5. A last line telling the user what to run next.
