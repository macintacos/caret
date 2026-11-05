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
  follows the label at body weight. The shortcut groups and the outline filter's
  breadcrumb headers wear it too. No label or stamp is styled in capitals; only a key's
  legend (the letters on a shortcut keycap, such as `ESC`) is, because it mirrors the key.
  `ui/src/lib/sentence-case.test.ts` fails on a new label styled in capitals.
- **Read-only text inside a dialog**, such as the compiled preview and the context lines,
  sits in a cut on `--group-floor`.
- **The window is a body, and the plan is a pane set into it.** Every control outside the
  plan pane is cut into the body (`--body`), and chrome never paints a bar face or a rule.
  The outline column lies in one large bed cut into the body, beside the pane (see
  **The outline's bed** in the tactile kit). The body is grained rubber, lit faintly from
  above over the chrome (`--chrome-light`). The pane is a screen set into it, inset
  `--pane-gap` with `--pane-radius` corners. Its recess, `--pane-recess`, is a soft inset
  shade that reaches down from the top edge, with a 1px contact edge and no outer layer,
  and the body's lit edge round it is `--pane-lip`. Each view fills the pane with one
  floor, `--plan-floor`. In the source view and the version compare, where the diff
  library draws the plan, the room past the rows takes the rows' `--paper-sunk`. The
  preview stays on `--paper`. The pane's foot shades the text under it with `--pane-shade`
  while more lies below (`data-more-below`). The file drawer is a second pane beside the
  plan, and the gap between them is the resize handle. It shades its edges as the plan
  pane does: its foot while more of the file lies below, and the gutter's edge while the
  code is scrolled sideways under it. Its gutter draws no rule. The empty screen is the
  same pane, and the daemon banner sits on the body. Text cut into the body is
  `--ink-soft` at its faintest, because `--ink-faint` falls under 4.5:1 there in several
  palettes.
- **The plan header lies in one bed the length of the bar.** It is stuck to the pane's top
  edge above the scroller, as tall as the outline column's head (`--pane-header-h`). Its
  keys stand on the bed's floor (see **A bar's bed** in the tactile kit). The bed's walls
  mark the plan's top edge, so the header casts no foot shade. While comparing, Base →
  Target and the diff toggles take the crumbs' place, and Versions stays latched at the
  header's end. As the header narrows, the view keys keep their place, and the rest gives
  way in this order:
  1. Versions' word and the Search entry's word. Versions' glyph, count and cap stay, the
     entry's magnifier and cap stay, and both keep their accessible names.
  2. The Base and Target words. Each picker keeps its accessible name, "Base version" or
     "Target version".
  3. The Bars, +/− and Both toggles. Settings holds the same choice.

  Steps 2 and 3 come sooner while the Split/Unified toggle is shown, because it needs the
  room. Every step is measured on the header's own width, not the window's. A file drawer
  docked right leaves the pane no narrower than the 468px the narrowest window (480px)
  leaves it, so the steps hold beside a wide drawer too.
- **Search swaps into the plan header.** Closed, a Search entry sits at the end of the
  crumbs, before the view keys: a magnifier, the word "Search" and, with Shortcut hints
  on, the `/` cap. It lies in a text field's cut rather than standing as a key, so it
  never outweighs the view keys. It hovers, takes focus and presses as a ghost control
  does, and a touch device drops only its cap. A click, Enter or `/` opens the find row
  over the crumbs, between the outline key and the view keys, on the bed's floor. The row
  paints that floor clear of the bed's shading, so the crumbs stay covered as it tucks
  away. The crumbs keep their box under it, so their collapse holds still. The entry is
  the last thing in the crumbs' slot, which clips at its end, so the row slides out of the
  entry from `translateX(100%)` over `--dur-pane`. Its field takes focus without scrolling
  the plan. Otherwise focus would scroll the plan sideways, because the row's box starts
  past the slot. The row runs: the field with its match count, the ▲ ▼ step keys, Close,
  then the key hints. Close is an ×, the word "Close" and, with Shortcut hints on, the
  `esc` cap. Close or Escape closes the row. Closing slides it back to the entry's place
  over `--dur-state` as the crumbs fade in. The entry hides the moment the row opens and
  reappears once the row has tucked in, because no part of the row covers the entry and
  its rounded edge would show above and below the row's floor. The crumbs hide at once
  when the row opens. A fade-out there would leave a quick close reversing a half-done
  fade, which cuts the fade back in short. The match count sits at the field's end, and
  the key hints are text. As the header narrows, the field gives up width first, until the
  key hints and Close's word no longer fit beside it. Beside the longest hints, a
  committed query's, and Close's word, that is about 8rem. Then the key hints go, Close
  narrows to an × the size of the step keys, and the field gives up the rest, down to
  about five characters of query (3rem). Past that, the parts that read least go, in this
  order:
  1. The slash before the query.
  2. The spaces in the match count, so "1 / 35" reads "1/35".
  3. The header keys' hint caps, while the row is open, if the header is still too tight.

  The step keys and Close always keep their room.
- **The file drawer's title bar stands level with the plan header.** Both bars are
  `--pane-header-h` tall, and with the drawer docked right their top and bottom edges line
  up across the two panes. The drawer's bar lies in a bed as the plan header's does, its
  floor stepped from the drawer's `--paper`, and the two beds line up too. The folder
  card's bar is the same height, because the two reference surfaces share one header,
  `.ref-header` in `atoms.css`. The card's bar lies in no bed and keeps its lip.
  - The bar holds the close circle, the kind tag ("Preview" or "Folder"), the path, the
    line range and the esc hint. The circle is its only key. Like the gutter "+", it wears
    the recipe for a key on no bed: it stands straight on the bed's floor, with no tray of
    its own. The tag and the line range can't be pressed, so they stay stamps, in pockets
    of one height.
  - The path is the bar's one emphasis: mono at the plan header crumbs' `--text-sm`,
    weight 600, in `--ink`. Everything else is at `--text-xs`, the size of "/ to search".
    The folder card's refresh key lies flat at the crumbs' 24px.
  - As the drawer narrows, the bar gives way so the path keeps some room. First the esc
    hint goes, because the circle and Escape still close the drawer. Then the kind tag
    goes. The line range stays, because it is the live region that announces each chunk of
    the file as it loads.

  `test/e2e/file-drawer.e2e.ts` holds:
  - both bars at the plan header's height;
  - the drawer's top edge level with the plan header's when docked right, and its bed
    level with the plan header's bed;
  - the bar at the drawer's narrowest, with nothing overflowing and the path in view.
- **The outline is a column, or a float.** The column stands left of the plan pane while
  the reader keeps it shown, unless the window is under 960px wide. A file docked right
  stands beside it, and the plan rewraps into the width between them. The outline key is
  one toggle named "Outline", in the column's head while the column stands and in the
  header while it is hidden. In the header, it stands as far in from the pane's left edge
  as Preview does from the right. It latches down with its corner light while the column
  stands, and stands up while the column is hidden. In both places it stands on a bed's
  floor with no bed of its own, so the fold carries the same key across. A press, or ⇧ +
  `\`, shows or hides the column and never opens the float. Under 960px the column can't
  stand, so the header has no outline key and ⇧ + `\` does nothing. `\` focuses the
  column's filter while the column stands. While it's hidden, or under 960px, `\` drops
  the outline from the header's start as a float instead: a `--float-mid` float on
  `--paper-raised`, which opens on its filter. Compare has no outline: no column, no key
  and no float, and neither key does anything there. Entering Compare folds the column and
  leaving stands it again, without changing the reader's remembered choice.
- **The outline column's head is its filter field and its outline key.** The field always
  shows, at the head's start, and the key stands at its end. The field is a closed field
  cut into the column's bed (`--field-floor` under `--panel-recess`), as the plan header's
  Search entry is. It stands at the key's 1.75rem height and rounds at `--key-radius`. It
  stands 0.45rem in from the bed's wall, as the rows do, and 0.45rem from the key, so the
  two nest alike in the bed's top corners.
  - The field's end shows the `\` cap, with Shortcut hints on, whenever the field is
    unfocused. Focused, it shows nothing while empty and the × while it holds a query.
    Unfocused with a query, the cap stands just before the ×. The column's field shows no
    match count, because the rows beneath show the matches.
  - A click, Tab or `\` focuses the field. From it, the arrows walk the keyboard's
    selection through the rows. Focus on an empty field starts the walk on the heading
    being read. `\` also plays the outline's sound cue. On a query the field holds, it
    selects the query, so typing replaces it. Escape clears a query, then hands focus back
    to the plan. A pick empties the field and hands focus back too.
  - The field stands in the page's Tab order, so Tab focuses it like any other stop, and
    the next Tab moves on to the key. Tab walks the rows only once the reader engages the
    field: with `\`, a click into it, or any key pressed in it but Tab, Escape or a
    modifier alone, such as a typed character or an arrow.
  - As the column narrows, the field's magnifier goes, so a focused query keeps about five
    characters. It hides when the room left for the field is under 8rem, whatever the
    window's width.
  - When the column folds, the field slides away with it, and only the key travels to the
    header.

  `PlanToc.test.ts` and `plan-toc.e2e.ts` hold the field's cap, focus and Tab.
  `outline-resize.e2e.ts` holds the head as one row down to the column's narrowest.
  `concentric.e2e.ts` holds the field's corner nested in the bed's.
- **The outline column takes the width the reader drags it to.** Its right edge is a
  splitter (see **Splitters** in the tactile kit). The column opens 15.5rem wide and
  narrows to 12rem. It widens to 30rem, but only while the plan beside it keeps its 800px
  reading column. Even a narrow window lets it stand at 15.5rem. A double-click returns
  the opening width. The browser remembers the width.
- **An outline row peeks at its section.** Resting on a row for 350ms, by the pointer or
  by the keys, opens a peek past the outline's right edge, level with the row and kept
  0.5rem inside the plan pane, clear of an open file. Once open it follows the pointer and
  the keys to the next row at once. `p` flips it to the other view with the plan, or
  closes it if that view has not drawn the section within three frames.
  - A filter query opens it the same way on the row the query selects, 350ms after the
    last keystroke. A query that matches nothing opens none, and neither does emptying the
    query.
  - It is a copy of the live view, so its type, colour, chips and code highlighting are
    the plan's own in every theme. It starts at the heading and ends on the section's last
    line of text. A heading with no text of its own shows its subsections too.
  - It is a raised rubber pad, as a code block is. A rim of `--body`, `--code-bezel` wide
    and lit along its top by `--rubber-gloss` and `--pad-top`, holds the copy. The copy
    lies in a scoop (`--scoop-top`, `--scoop-foot`) on the view's floor: `--paper-sunk`
    under source and `--paper` under Preview. The pad stands on `--pad-stand` and floats
    at the menus' height, `--float-mid`, with their `--rule` ring. It rounds at
    `--pad-radius`, with no arrow and no label. It is up to 36rem wide, and shows nowhere
    with less than 18rem of room.
  - The rim parts the copy from the plan beneath it. In every dark palette it reads at
    least 4.5 ΔE (CIE76 colour difference) off both the copy's floor and the plan across
    3px or more, which `outline-peek.e2e.ts` holds. In light palettes the rim stands
    closer to the floors, and the pad's side, its ring and its shadow carry the edge.
  - Preview's text wraps to the peek. Source lines keep their length and fade at the
    peek's right edge. A section taller than 16rem is cut there and fades over its last
    3rem; one that fits ends on its text, unfaded. It measures again when its copy grows.
  - It closes on the reader's own input: the pointer leaving the list, the list losing
    focus, a wheel, a pointer press, a resize, a row picked, the query changing, or a key
    other than a walk key (the arrows, Tab, Home and End) or `p`, Escape included. A list
    scroll carries it with its row, and the plan keeping its place across a flip leaves it
    open.
  - It is `inert`: it takes no pointer and no focus, and screen readers skip it. It
    repeats text the plan holds a jump away, and the row's own name and description
    already say where that jump goes.
  - It arrives with a fade and a 0.375rem slide from the row's side on `--dur-state`, and
    leaves on half that. Moving between rows it jumps, with no re-entry. Under reduced
    motion it shows and hides with no movement.
  - While you compare versions, there is no peek.
- One emphasis per view. The amber accent is used verbatim, never lightened, and only for
  the wordmark, the primary action, and the text cursor. Everything else steps down
  through `--ink-soft` and `--ink-faint`. The waiting screen's lit legend is the one place
  the amber is lightened
  ([`exceptions.md` § The waiting screen](exceptions.md#the-waiting-screen)).
- Page structure is left-aligned.
- Compose from shadcn-svelte first ([`shadcn-rules.md`](../doc/agents/shadcn-rules.md));
  icons are vendored ([`icon-rules.md`](../doc/agents/icon-rules.md)).

### The tactile kit

- **Beds.** A control sits in a bed: a shallow cut in the chrome's own rubber. The code
  calls a bed `.tray`, and its pad tokens keep the `--well-` prefix; `--well-floor` and
  `--well-shade` belong to a stamp's pocket, not a bed. A control's bed has no floor of
  its own. Its shading (`--bed-shade`) darkens just under its top edge and lights the
  cut's lower wall and the lip below it. The keys cast their shadow onto the same material
  they stand on. A group of controls shares one bed, and a lone control gets its own, with
  `--tray-gap` (5px) between keys. Every bed shows the same 3px gap (`--well-pad`) round
  the key's visible face and side. Its top pad (`--well-top`) adds the key's rise, and its
  foot (`--well-foot`) adds the key's side less the rise, so the gap stays even. A bar
  holding beds trims its own padding by the same amounts to keep its height. Every cap
  rounds at `--key-radius` (8px), whatever its Button `size`. A bed rounds at
  `--key-radius` plus `--well-pad`, 11px, so the two corners stay concentric. The row-wide
  scratch marker is a `button.tray` and keeps its tinted floor.
- **The outline's bed.** The outline column lies in one large bed, its head included.
  Unlike a control's bed, it has a floor of its own, as a setting group does:
  `--bed-floor`, the body a step toward the plan pane's floor, darker in dark and lighter
  in light. The floor is grained as the body is, and the bed shades as any bed does
  (`--bed-shade`). Its rows lie as keys on that floor.
  - It stands level with the plan pane, top and bottom, and inset `--pane-gap` from the
    window's left edge, as the pane is from its right.
  - The 0.5rem between the bed and the pane, below the column's head, is the column's
    splitter, and nothing else.
  - Its rows, its filter field and the head's outline key stand 0.45rem in from its walls,
    and it rounds at `--key-radius` plus that inset.
  - `theme.test.ts` holds a row's hover face 4.5 ΔE off the floor, and the outline's quiet
    text at 4.5:1 on it, in every palette.
- **A bar's bed.** The plan header and the file drawer's title bar each lie in one bed the
  length of the bar (`.header-bed` in `atoms.css`). Like the outline's bed, it has a floor
  of its own: the pane's floor stepped toward `--bed-floor` by `--header-bed-mix`,
  grained, and shaded with `--bed-shade`. Its pane mixes that floor as
  `--header-bed-floor`.
  - It stands `--well-pad` in from the pane's top and sides and rounds at `--key-radius`
    plus that pad, 11px. The bar's end keys (8px), the bed and the pane (14px) nest.
  - Its keys stand on its floor as the outline's rows stand on theirs, with no bed of
    their own: the outline key, Versions and Preview, the Base and Target pickers, the
    find row's steps and Close, and the segmented controls, which keep their 3px gang.
    Each tray keeps its pads, so the gap round a key still shows. The Search entry stays a
    field's cut in the floor.
  - The outline column's head key stands the same way on the column's floor.
  - A dark key latched on either bed takes `--neutral-face-bed-down`. The down face steps
    from the paper and sits at or under a floor this light, so it reads as a hole. The bed
    face rises toward the hover face as far as keeps the hover face 4.5 ΔE above it.
    Catppuccin Frappé sets that limit, at 62% of the way from the hover face to
    `--bed-floor`. On the column's floor, the lightest of the beds, the face stands at
    least 2.8 ΔE lighter than the floor in the Catppuccin darks, and more elsewhere. In
    light palettes a latched key keeps `--neutral-face-down`, a step darker than the
    floor, as a latched key is everywhere in light.
  - In light palettes the floor stands 0.4–1.5 ΔE from the screen's, so the bed reads by
    its shading.
  - `concentric.e2e.ts` holds the nesting. `tactile-kit.e2e.ts` holds that no tray on
    either bed draws a cut, and that in every dark palette a latched key reads lighter
    than the floor round it. `theme.test.ts` holds the latched face's hover step, and the
    header's quiet text and crumb hover against the bed's floor.
- **The working-directory path lies in a bed with no key.** It sits centred on the status
  bar, between the version and the review's status, as a `button.tray`, because it is
  metadata the reader copies rather than a control they work. It shows whenever a review
  is open, whether the outline is shown or not. Under the pointer or keyboard focus, the
  bed takes `--ink-wash` and the path inks up, as a ghost control does. A press adds the
  ghost control's dimple to the bed's shading.
  - It shows the whole path: from `~` inside the home directory, absolute outside it, and
    as given when the coding agent reports its cwd from `~` already. A click copies the
    whole absolute path.
  - When the path outruns the room between the bar's other segments, it gives up whole
    middle segments to one `…`. It keeps its start and its leaf, and gives up the segment
    after the start first. Only a leaf that alone outruns the room ends in an ellipsis.
    The version and the review's status keep their full width.
  - On a copy that lands, the path rolls up out of the bed, and "Copied", with a check in
    `--ok`, rolls up into it from below, on `--dur-state` and `--ease-out`. After 1.5s
    they roll back. Reduced motion swaps them with no movement and keeps the hold. A copy
    the clipboard refuses confirms nothing. No toast: a status region announces the copy.
- **Nested corners.** Where a rounded shape rests near another's corner, the inner radius
  is the outer radius less the inset between them, so the gap round the corner matches the
  gap along the sides. The inset is the distance from the outer shape's edge to the inner
  shape's, usually the outer shape's padding. The inner shape's kit radius is the anchor:
  `--key-radius` for keys and key rows, `--radius` for fields. The outer shape rounds at
  that plus the inset, as a bed rounds at `--key-radius` plus `--well-pad`. Where the
  outer radius would leave the inner one at zero or less, the inner shape keeps its kit
  radius and the outer one grows to that radius plus the inset. Two shapes are exceptions.
  Their padding is so wide that you can't compare the gap at the corner with the gap along
  the sides, and the concentric radius made them much rounder than the keys inside them:
  - A setting group, padded `--group-pad`, would round at 25px. The group is a bed, so it
    rounds as one: `--key-radius` plus `--well-pad`, 11px.
  - A modal whose action tray rests on a footer shelf padded 1rem would round at 27px.
    Every modal rounds at `--modal-radius` (14px) instead: the corner Settings' search
    field nests in, the field's `--radius` plus the 0.5rem padding round it. Below 640px
    wide, Settings keeps a wider corner of its own, listed below.

  `test/e2e/concentric.e2e.ts` holds the setting group at its beds' radius, Request
  changes, Approve and Reject at `--modal-radius`, and each of these to half a pixel:
  - Settings' search field nests in `--modal-radius`. Below 640px wide, Settings' section
    list folds into a bar with a section picker, and Settings rounds at the picker's bed
    corner plus the bar's 0.6rem padding, 20.6px;
  - the comment composer rounds at `--composer-radius`: its tray's corner plus
    `--composer-inset`, its padding;
  - the plan header's bed nests in the pane's top corners, and its end keys in the bed's;
  - a menu, the Select listbox, the outline's float and the heading-filter panel round at
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
  A destructive confirm, such as Reject anyway, wears `.cap-danger`, which rests on
  `--danger-face`: in light that is the danger stepped toward black, so its label holds AA
  in Dawnfox. The top bar's Reject stays neutral and takes the danger key's face and label
  under the pointer, keyboard focus and a press (`.cap-danger-hover`). One cap rule in
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
  the Button fades it. A ghost control (`.cap-ghost`) has no cap. Its hover is
  `--ink-wash`, a tint of ink over whatever it sits on, so it darkens a light surface and
  lightens a dark one. A saved comment's header chip, which fills a card that lifts, takes
  no wash: the lift shows the hover. A press leaves a shallow inset shadow. Under reduced
  motion `--key-rise` and `--key-sink` are 0, so no key moves and only its shading
  changes.
- **Focus is the hover.** A control under keyboard focus wears exactly its hover look and
  draws no ring: no outline, halo, inset ring or glow. Text fields are the exception
  (below).
  - Add `:focus-visible` beside every `:hover` rule, and give a focusable control with no
    hover look one.
  - A hover face is the only mark of keyboard focus, so it reads at least 4.5 CIE76 ΔE
    (colour difference) off its rest in every palette, as the browser mixes it, which
    `theme.test.ts` pins. In light it steps no further than its tightest pair, the cursor
    on a chosen row, needs to clear that floor, because a darker hover reads as disabled
    rather than raised. It steps toward black rather than `--ink`, so every light palette
    moves the same distance. On a risen face only `--ink` holds AA, so quieter text there
    steps up to `--ink`. A glyph there needs only 3:1, so it steps to a neutral key's
    label ink and stays a rung under the text.
  - The cursor on a latched face, such as the outline row being read or the latched
    compare toggle, takes `--neutral-face-latched-hover`. In light that is the latched
    face stepped toward black, because the plain hover face is lighter than it there.
  - A control that shows only under the pointer, such as the gutter "+", stays while it
    holds keyboard focus.
  - `base.css` drops the browser's outline. In a shadow root, drop it in the root's own
    sheet too. Under forced colors, which strip faces and shadows, `base.css` keeps a
    transparent outline that the browser repaints in a system colour.
- **Submit trays.** A tray that submits is marked `.tray-submit` at the call site, never
  inferred from the cap it holds. It is smaller than the rest of the kit: caps of
  `--cap-submit-h` (28px) with `--text-base` labels, where the other caps are 32px, and
  every cap in it shrinks with it. The top bar's bell and settings keys match it, so every
  key in the top bar is the same height. The plan header's view and outline keys stand at
  that height too, though they submit nothing. So does the outline column's own outline
  key: hiding the column puts the header's outline key in its place, and one height keeps
  the key from changing size as they swap. Their trays, marked `.header-tray`, join the
  same rule in `atoms.css`. The submit trays are Approve in the top bar, Comment and Save
  in the composer, Send for revision, the guard confirms (Approve with comments, Reject
  anyway) and the confirm bubble's Discard. Enable notifications is not a submit and keeps
  the full size.
- **Stamps.** Passive labels (`.stamp`, counts, the comment states, the file preview's
  line-range readout, the waiting screen's listening stamp, the build tag's "Copied") sit
  in a pocket. Unlike a bed, a pocket has a darker floor (`--well-floor`) and its own
  shade and lip (`--well-shade`, `--well-lip`), and holds no cap. A passive status mark,
  such as the Notifications bell or the waiting screen's listening stamp, sits in a pocket
  too, and a state word beside it takes the comment stamps' word ink. `.tag` is the stamp
  that names a kind, in sentence case: Folder, Preview and Settings' "In use". Text fields
  (`.field-well`) take a shallower cut, `--panel-recess`, with no ink ring.
- **Settled values are stamped.** A committed value leaves its field for a `.stamp` set on
  the field's exact pixels, so committing changes only the material. The committed search
  query is the example, and because no field keeps focus, bare-key shortcuts still work
  after a search.
- **Text fields draw no focus ring.** A focused `.field-well` lights one wall of its cut
  with `--field-wall`, `--field-edge-focus` on the lower wall in dark and the upper wall
  in light, and the amber text cursor shows the rest. A Command's filter field, in the
  outline and the breadcrumb bar, can't wear the class, so one rule in `atoms.css` mirrors
  the recipe by appending `var(--field-wall)` to its rest cut. Read-only text that takes
  focus, such as the file preview's code region, lights its wall the same way.
- **A filter field clears from inside.** While a Command's filter field holds text, a
  space included, an × named "Clear filter" stands at its trailing edge. A press empties
  the query and keeps focus in the field. The × is a 24px ghost control with an
  `--ink-soft` glyph. Nothing overlaps it: the outline float's match count, and the
  column's `\` cap while its field is unfocused, stand just before it.
  `command-input.svelte` draws it, so every Command filter has one.
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
    headings on the trail latch (the crumbs in the plan header borrow only the risen
    state, on `--crumb-face-hover`, and never latch; the current crumb is marked by
    weight), and the comment navigator. The crumbs lie on the plan header's bed, whose
    floor steps from `--paper` over the preview and `--paper-sunk` over the source view.
    In light their face steps toward black from the raised paper, because a key's white
    face is the plan's own paper there and would not read as risen. In dark it steps
    further toward `--ink` than the hover face, as far as Catppuccin Frappé's `--ink`
    keeps 4.5:1 on it. `theme.test.ts` holds the step to 4.5 ΔE on both floors in every
    palette;
  - the folder tree, a shadow-DOM list that wears the `--key-row-*` tokens directly, with
    a `:focus-visible` row risen and the chosen row latched. It keys on `:focus-visible`
    rather than the library's `data-item-focused`, so a pointer click never raises the
    row; once the pointer leaves, the row shows only its latched face. The library's own
    ring never draws.

  In a menu or listbox the highlight is the only cursor, so a row rises on
  `data-highlighted` and never on hover. In a bits-ui listbox (a Select),
  `[data-selected]` means the chosen option, so the chosen row is named by `data-active`
  and latched, never risen. The outline row is the one key row outside the atom. It rises
  and sinks as far as every other key row (`--key-rise`, `--key-sink`), but its face is
  its own: flat grained rubber with no gradient. On a key that wide, the key row's domed
  gradient reads as painted on. Inset shadows that follow its corners light its top edge
  (`--rubber-gloss`) and shade its foot (`--rubber-foot`). Latched or pressed, it sinks as
  a bed does, shaded under its top edge (`--rubber-press`) and lit along its lower wall
  (`--scoop-lip`). It rises from its indent onward, and latches onto
  `--neutral-face-latched` while it is the section being read, an open exception to the
  accent rule ([`decisions.md`](decisions.md)). The cursor on it takes
  `--neutral-face-latched-hover`. Its press and its latch override its rise, so a row
  clicked under the pointer goes down at the press and stays down: the click latches it
  where it stands, and the row latched before lets go. A latch goes down on `--ease-out`,
  as a press does. A key row's keyboard indicator is its hover look, so the row the keys
  move to looks exactly like the row the pointer moves to. A chosen row under the
  highlight stays down on the hover face, so the highlight reads on it too.
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
- **Splitters.** A pane's resizable edge is ARIA's window splitter pattern, a focusable
  `role="separator"` whose value the arrow keys change
  (`ui/src/components/Splitter.svelte`). The file drawer's edge and the outline column's
  are the two. It lies over the bare gap between two panes and nothing else, so it never
  takes a click meant for either. The outline column's edge is the gap between its bed and
  the plan pane, and starts below the column's head. At rest the gap is all that shows.
  Under the pointer or keyboard focus, a grip rises in the gap where the pointer is: the
  switch's key, light in both schemes, 6px wide and a key's 2rem tall. Held, the grip goes
  down as a pressed key does, its side folding away and its shading turning concave.
  `theme.test.ts` holds it to 3:1 on the body, risen and held. A mouse drag leaves the
  edge focused, but only focus from the keyboard raises the grip, so it fades once the
  pointer leaves. The arrow keys step the edge 24px. A double-click returns the pane to
  its opening size: 15.5rem for the column, and 45% of the surface for the drawer. Beside
  a file, the column stops at the widest width that fits, if that is less.
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
  `button.tray:is(:active, [data-key-pressed]) > .cap` rules in `atoms.css`. On dark paper
  the tinted floor is lighter than the paper. The bed's full shade would hide the row's
  top edge, and its lip would add an edge below, so the row would read lower than its
  centred content. The row's bed takes `--unsent-shade` instead: in dark, a weaker shade
  with no lip, and in light, `--bed-shade`. `theme.test.ts` holds the word and the text to
  4.5:1 on the tinted floor in every palette, `tactile-kit.e2e.ts` seeds an unsent comment
  to cover the marker's cap, and `unsent-marker.e2e.ts` reads the row's edges off a
  screenshot in every dark palette.
- **Unsent everywhere.** Every surface marks an unsent comment with the word "unsent", the
  `message-square-more` glyph in the comment stamps' word ink, and the tinted well. The
  word is never "draft". Size picks the tint: a row or a list takes `--unsent-floor`, and
  a pill-sized count, such as the outline's, takes the stamp's `--stamp-floor`. An unsent
  section's label leads with the glyph in the word ink, and its text stays `--ink-soft`.
  In Request changes, a committed row is a paper card, the saved comment's low float,
  resting in a recessed tray, and an unsent row is a tinted well on the panel. The Approve
  and Reject guards list each kind in its own group: committed comments in a recessed
  group with hairline rows, unsent ones in a tinted well. The comment navigator rests an
  unsent row as the tinted well with the glyph and "unsent", and a hovered or current one
  becomes a key like any other row.
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
- **A lit legend** is a key's legend, the glyph on its face, lit from behind, as the
  waiting screen's `^` is. The glyph runs from `--lit-core` through the amber to
  `--lit-rim`, over a blurred copy in `--accent` at `--lit-glow`. That glow is clipped to
  the key's face, as a backlight lights only its own key, so the glow is a light's. While
  the key has nothing to do, the light goes out and the key sits disabled, its bare legend
  in `--lit-off` moulded into the rubber.
- Not used: glass and heavy gradients. The only glows are lights: the status bar's live
  LED, the status lights in Settings, the safe-mode toast and the waiting screen's
  listening stamp (`.led` and `.led-off` in `atoms.css`), each lit in its state's colour,
  a latched key's corner light, and the waiting screen's lit legend.

### Type and shape

- Geist for UI text and prose; Berkeley Mono for code, the `^` carets, paths, line
  references, and the version tag.
- Every font size comes from the `--text-*` ramp. A raw `font-size` fails the type-scale
  contract test; a genuine display one-off stays literal with a comment saying why.
- Radii follow size: 10px panels (`--radius-lg`), 6px fields and menu rows (`--radius`),
  pill badges and meters. The keypad rounds rounder: 8px keys (`--key-radius`), wells at
  that plus their pad, 5px keycaps and the switch's key (`--nub-radius`), 12px pads
  (`--pad-radius`), the 14px plan pane (`--pane-radius`) and 14px modals
  (`--modal-radius`). A container whose corner holds another rounded shape rounds wider,
  per **Nested corners** in the tactile kit.

### Motion

- Every state transition takes 160 ms on the strong ease-out
  `cubic-bezier(0.22, 1, 0.36, 1)` (`--dur-state`, `--ease-out`): hover and focus tints,
  surfaces entering and leaving, and controls sliding between positions. The curve covers
  most of the distance at once, then brakes hard.
- Two moves are the exception: a pane or column entering, the outline column or the file
  drawer, and the find row sliding open across the plan header. Each takes 240 ms
  (`--dur-pane`), because a move that size reads as a jump cut at 160 ms. Each leaves on
  160 ms (`--dur-state`), so it leaves faster than it enters.
- The outline column and the file drawer move on the page itself
  (`ui/src/lib/layoutSlide.ts`). The change applies at once, so the plan is laid out where
  it ends on the first frame. Each part that moved then slides from where it stood on a
  transform transition, so a second toggle reverses it mid-flight. A click during the
  slide lands on whatever is under it. Opening a file slides the drawer in and a column it
  folds out, in one frame; closing one slides the drawer out as the column stands again. A
  part slides on `--dur-pane` when it enters or moves with an entering column, and on
  `--dur-state` otherwise.
- An outline toggle moves only the plan's left edge. The plan's floor and the header's bed
  stretch from the column's edge, its text and crumbs slide with that edge, and the view
  keys and the Search entry hold still. Every part moves by transform alone, so no part
  waits on a frame the main thread is still drawing.
- Compare runs as one view transition, because its content swaps as it moves
  (`ui/src/lib/paneMove.ts`, timed in `ui/src/styles/base.css`). Every part moves within
  that one transition, on `--dur-state`; the column standing again, and the parts that
  move with it, take `--dur-pane`. Each slot, a place in the header or the plan where one
  thing replaces another, fades through: what leaves is gone by 40% of the run, and what
  arrives starts there, so no slot shows two images at once. The header's bed stretches
  with its box, so both its ends stay round. The Versions key slides only once the slot it
  moves into is clear, and what it leaves fills only once it has passed. Leaving compare,
  the column waits until the plan's old image has gone, and arrives with the plan.
- A plan swap crossfades the whole window on `--dur-state` (`ui/src/lib/planHandoff.ts`,
  timed in `ui/src/styles/base.css`). That covers a plan arriving in the waiting room, the
  next plan after a decision, a switch, and the last decision returning to the waiting
  room. The two windows' images add rather than stack, so the top bar and status bar,
  which both show, hold steady through the fade. A decision's swap starts as its guard
  starts to leave, so the guard recedes inside the crossfade. The window takes clicks
  again as soon as the fade ends.
- A page that opens shows a bare pane, the waiting room's pane with nothing in it, until
  the first poll answers, usually within a frame. Then the plan or the waiting room
  appears with no crossfade. Until then nothing says whether a plan is waiting.
- Motion confirms a change the reader made. The outline's latched row fades across when
  the reader jumps to a heading, and moves with no motion while the plan scrolls under it,
  because motion on a change that runs through a scroll reads as lag. What comes and goes
  with the window's width changes with no motion too, because motion during a resize drag
  jitters. A pane a splitter resizes changes with no motion too, because the plan lays out
  again under the pointer every frame.
- The outline key's latch rides its travel between the column's head and the header. The
  key latches on `--dur-pane` as the column stands, and lets go on `--dur-state` as it
  folds, both on `--ease-out` and from the slide's first frame. A click stands the column
  with the key already down, so it comes in latched; ⇧ + `\` stands it with the key up, so
  it latches on the way. A shortcut holds the key it stands for down for 110ms, its press
  echo; the fold drops that echo, so the key rises while it travels.
- A key's return from a press is the one spring: it travels back over `--dur-state` on
  `--ease-spring`, past rest and back. The press itself, and every shading and colour
  change, stays on `--ease-out`.
- Ambient loops (the waiting screen's breathing legend, the reference-hint ping, the
  safe-mode pulse) and the plan's scroll travel are not state transitions and keep their
  own timing.
- Motion is CSS only. A Svelte JS transition throws under happy-dom and ignores reduced
  motion; `ui/src/lib/motion.test.ts` enforces this.
- Reduced motion stops every animation. Where a timer swaps content (the carrot fact), the
  timer stops too. No key travels under it: `--key-rise` and `--key-sink` are 0.

### Plan surface

- **The current search match is the strongest mark on the page.** Both views share its
  pair of marks.
  - The current match is the mark itself, opaque (`--mark-active`). Its text is whichever
    of `--ink`, `--paper`, `--paper-raised` and `--paper-sunk` reads most strongly on it
    (`--mark-active-ink`). The preview draws a held selection's band, and the cursor's or
    the pointer's, over the text. Where they would take that text under 4.5:1, it steps
    toward white or black. Where not even white or black would hold, the mark steps away
    from its text before the text steps.
  - Every other match is a wash of the mark (`--mark-match`) a step over the `--mark` a
    comment span wears. Its text is `--ink` (`--mark-match-ink`), stepped toward white in
    dark or black in light where the palette needs it to hold 4.5:1 on the wash. That
    holds on a chip, a code or table card's floor and a table header too, but not on a
    chip inside a table header, where no text colour reaches 4.5:1 in five dark palettes.
  - A thematic break (`---`) paints its dashes transparent under a match too, so the mark
    shows as a plain band.
  - `test/e2e/search-marks.e2e.ts` holds both marks' distance from their lines and from
    each other, an other match's lead over a comment span's `--mark`, and their text's
    contrast, in every palette and both views.
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
  [`exceptions.md`](exceptions.md). Any other empty view is one plain sentence, where its
  content would start: a filter that matches nothing says so under its field.
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
