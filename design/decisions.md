# Decisions

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

Open items first, then the log, newest first.

## Open: where the code still differs

- **`--ink-faint` on raised surfaces:** falls under the 4.5:1 text contrast floor in
  several bundled third-party palettes. On `--paper-raised` it measures 4.45 in Catppuccin
  Mocha, 3.49 in Catppuccin Latte, 3.26 in GitHub dark, 3.45 in GitHub light and 3.59 in
  Dracula; in Dracula the outline filter's match count is 4.46 on the float.
  `theme.test.ts` holds only caret's two palettes to the floor. CommentNavigator's
  `.nav-hints` is unchecked. The 2026-10-31 pass moved the dialogs and the settings panes
  off it, apart from the search field's glyph and key hint, which are non-text. The file
  preview's gutter line numbers still use it; that call is listed below under "Calls left
  to the user".
- **Keycap hints on GitHub dark's body:** keycaps and breadcrumb chevrons keep
  `--ink-faint`, about 2.9:1 on GitHub dark's `--body`. The old raised bar gave about
  3.2:1, also under the floor.
- **`--pane-recess` has no contact-edge test:** `coreStyles.test.ts` pins `--panel-recess`
  to 1px outer layers with no blur or spread, and nothing pins `--pane-recess` the same
  way.
- **Amber on a latched state:** the crumb menu's current row, the navigator's current
  rail, the version check and the folder tree's selected row no longer spend amber. These
  remain: the outline row being read takes `--neutral-face-latched`, and a switch that is
  on takes `--switch-on`. Both are amber tints on a state. They follow the version compare
  toggle, whose face latches onto `--neutral-face-latched` while it compares. They break
  the accent rule in
  [`patterns.md` § Surfaces and emphasis](patterns.md#surfaces-and-emphasis) twice: they
  mix the accent rather than using it verbatim, and they fall outside its list of uses. In
  Settings, the switch's tint is also a second amber emphasis beside the primary action. A
  latched key's corner light is the accent itself, also outside that list.
- **Search-only flat disabled cap:** the amber text cursor now covers every field, but the
  flat disabled cap is still local to the find row. The row's disabled step lies flat on
  the well's floor with no side, where every other disabled cap keeps its face and a 1px
  side.
- **Hue-only marks under 3:1 in some light palettes:** `--ok` and `--attention` as LED and
  bell colours measure 2.96:1 (`--ok`, Catppuccin Latte, settings panel), 2.05:1
  (`--attention`, Dawnfox, settings panel) and 2.32:1 (`--ok`, Latte, code panel). Each
  sits beside words that carry the state, so it is never the only signal. The status bar's
  LED uses the same tokens.
- **Focus under `GLANCE`:** no palette's neutral key clears `GLANCE`, the 20 ΔE step
  `theme.test.ts` treats as telling two colours apart at a glance, and keyboard focus
  shows only as a control's hover face. Steps here are CIE76 colour differences (ΔE),
  where about 2.3 is just noticeable. In dark a hover face is `--paper` 27% toward
  `--ink`, where Catppuccin Frappé's `--ink` holds 4.90:1. In light it steps only as far
  as its tightest pair, the cursor on a chosen row, needs to clear the 4.5 ΔE floor. The
  weakest light steps are that pair in Catppuccin Latte, 4.7, and Dawnfox's amber key,
  4.8. The weakest dark steps are in Catppuccin Frappé: 4.7 for a crumb on the bar, where
  `--ink` is at 4.53:1, 5.3 for the cursor on the outline row being read, and 6.4 for a
  menu row. `theme.test.ts` holds every hover step to 4.5 in every palette.
- **Focus fails WCAG 2.4.13 Focus Appearance (AAA):** that criterion asks for a focus
  indicator whose pixels change by at least 3:1 in contrast, over an area at least as
  large as a 2px outline round the control. A hover face changes its pixels by 1.13:1 (a
  light knob) to 1.95:1 (a Dracula settings row). Focus stays visible, which meets 2.4.7
  (AA). Meeting 2.4.13 would take a ring, or a face so far off its rest that a light hover
  reads as disabled and dark's `--ink` labels fall under AA. "Focus looks like hover"
  (2026-10-31) and "A light hover lifts, and the last corners and labels" (2026-11-01)
  rule both out.
- **Splitter targets under 24px:** both splitters fail WCAG 2.2's 2.5.8 and 2.5.7, and the
  user decides the remedy.
  - **2.5.8, target size:** the outline column's edge is 0.5rem (8px) wide and the file
    drawer's 6px, under the 24px floor. The spacing exception doesn't apply, because a
    24px circle centred on either edge overlaps the outline's rows or the plan. A wider
    edge would take their clicks, so widening it is not the fix.
  - **2.5.7, dragging movements:** neither edge offers a single-pointer alternative to the
    drag. The arrow keys reach every size, but both criteria count pointer input only.
  - **The conforming route:** an equivalent pointer control at least 24px across meets
    both criteria and takes no click from the panes. One example is a Narrower, Default
    and Wider stepper for the outline's width in Settings, with another for the drawer's.
    It adds UI the user hasn't asked for, so it waits on their decision.
- **Calls left to the user from the 2026-10-31 pass:** the one left was built and is
  waiting on the user's verdict.
  - `--ink-faint` line numbers in the file preview's gutter, 3.10:1 on Dawnfox's paper.
- **Call left to the user from the 2026-11-01 outline build:** a hidden outline stays
  hidden across reloads. The browser remembers it, as it remembers Preview. The handoff
  left this open; it was built that way and is waiting on the user's verdict.
- **Calls left to the user from the 2026-11-02 polish:** both were built and are waiting
  on the user's verdict.
  - The working-directory path in a bed at the centre of the status bar.
  - The outline key's latch riding its travel as the column stands and folds.
- **Calls left to the user from the 2026-11-02 drawer title bar:** both were built and are
  waiting on the user's verdict.
  - The close circle stays an 11px disc on no bed, rather than becoming a Close key in a
    bed like the plan header's keys.
  - As the drawer narrows, the esc hint ("esc to close") and then the kind tag ("Preview")
    leave the bar.

## 2026-11-02: a filter query peeks at the row it selects

Typing a query into the outline's filter selected the first match but opened no peek on
it. The peek came only once the user moved to another row. They asked for it to "appear
immediately (after a small delay) on the current selection".

- **A query peeks at the row it selects.** Once you stop typing, the selected row peeks
  after the same 350ms a row under the pointer or the keys waits. The filter selects the
  first match, so that is the row that peeks.
- **Each keystroke starts the wait again.** An edit closes an open peek, and the selected
  row waits 350ms from that keystroke. An open peek follows the pointer and the keys to
  the next row at once, but not the query: a peek that swapped its copy at every keystroke
  would change before anyone could read it.
- **A query that matches nothing shows no peek.** It selects no row, so only "No headings
  match" shows under the field.
- **Emptying the query closes the peek, and it stays closed.** The field's ×, Escape and
  deleting the last character all empty it. The whole outline comes back with its first
  row selected, a row you didn't pick. Backing out of a search never opens a peek. Moving
  the pointer or the keys to a row and resting there opens it again.
- **The query starts the wait itself.** bits-ui, the library under the outline's list,
  selects the first match just after each edit. An edit that keeps the same first match
  changes no selection, so a peek that waited for a selection change would never open. The
  outline starts the wait on its own first match instead, which is the row bits-ui selects
  because the list keeps the plan's order.

## 2026-11-02: a clicked outline row goes down at once and stays down

The user: "when I click on an item in the outline, it should immediately animate to its
"depressed" button variant I think". A click now takes the row down under the press, and
the latch the click sets holds it there through the jump. The row latched before lets go
at the same click.

- **Why it stood up:** the rules that raise the row under the cursor had a higher CSS
  specificity than the press and the latch. That cursor is the pointer's hover while the
  filter is closed, and the keyboard's selection while it is open. So a pressed row stayed
  risen, and the row the click had latched stayed risen too, until the pointer left it or
  the closing filter slid it away. The latch itself already moved at the click. In the
  float, the selection's rise also hid the press the float holds on a picked row
  (`data-key-pressed`). The rise rules in `PlanToc.svelte` now carry no more specificity
  than the press and the latch, which follow them and win.
- **A click:** the row goes down as a press does, on `--ease-out`, and the click latches
  it where it stands. On pointer-up only its face changes: `--neutral-face-latched-hover`
  while the pointer stays on it, then `--neutral-face-latched`. A press dragged off the
  row still cancels, so the latch waits for pointer-up, as any button's action does.
- **Enter:** a pick by keyboard latches the row at once, with no hold before it. In the
  column, Enter closes the filter and the row goes from risen to latched. In the float,
  the float marks the picked row pressed as it closes, so the row stays down while the
  float leaves.
- **A jump that lands elsewhere, or is interrupted:** unchanged. The latch holds the
  picked heading until the plan reaches it, or for 480ms, twice the jump's 240ms travel.
  Then it moves, with no motion, to the heading in the reading zone, as a scroll moves it.
  The latch marks where the reader is, and a heading the plan could not bring to the
  reading zone is not where the reader is.
- **The latch's motion:** a latch goes down on `--ease-out` over `--dur-state`, as a press
  does, so it no longer springs past where it stops. Only a key's return springs. A pick
  still moves the latch with motion, and a scroll still moves it with none, because motion
  confirms a change the reader made. Motion through a scroll reads as lag.
- **Reduced motion:** no key travels, so the press and the latch show only as the row's
  shading turning concave. The shading stays concave until the latch moves on.
- `test/e2e/plan-toc.e2e.ts` holds:
  - a row clicked in the column or the float never drawn above its resting position, from
    the press until the jump lands;
  - a row Enter picks in the column going down no further than where it stops.

## 2026-11-02: the cwd path shows whole from `~`, and a copy confirms on the path

The user asked for the status bar's working-directory path to start from `~` and be "the
'real' path to the current working directory", in place of its last two segments. They
asked for its middle to give way when the bar is too narrow, and for a copy to have "a
nice little animation for it instead of just having the toast message".

- **What it shows:** inside the home directory, the whole path from `~`, so
  `/Users/dev/wt/caret/plan-header` reads `~/wt/caret/plan-header`. Outside it, the whole
  absolute path. A cwd the coding agent already reports from `~`, such as the README
  hero's `~/acme-web`, reads as given. A click still copies the whole absolute path, never
  the `~` form.
  - The daemon reports its user's home directory on `/api/health` as `home`. Until the
    UI's health check returns, or from a daemon that predates the field, the path shows
    absolute.
- **The middle cut:** when the whole path outruns the room between the version and the
  review's status, it gives up whole segments to one `…`. It cuts into a name only when
  the leaf alone outruns the room, and then the leaf ends in an ellipsis.
  - It keeps its start (`~`, or an absolute path's first directory) and its leaf. It gives
    up the segment after the start first, so the leaf's nearest parents, usually the repo
    and the worktree, stay longest: `~/…/caret/plan-header`, then `~/…/plan-header`.
  - Widening the bar gives the segments back.
  - While the path is cut, the bed fills the whole room and narrows smoothly with the
    window. The text inside it drops one segment at a time. A path that fits sets the
    bed's width, unless "Copied" is wider.
  - CSS `text-overflow` was ruled out, because it cuts mid-name: an ellipsis in the middle
    of a segment (`~/wt/ca…/plan-header`) shows a name that doesn't exist.
- **The sides keep their width:** a long path took room from the version, which wrapped
  onto two lines at its hyphen. The version and the review's status now never shrink below
  their own width.
- **The copy roll:** on a copy that lands, the path rolls up out of the bed, and "Copied",
  with a check in `--ok`, rolls up into it from below, on `--dur-state` and `--ease-out`.
  After 1.5s they roll back. The version badge's "Copied" holds for the same 1.5s. The bed
  holds its width, so nothing beside it moves.
  - Under reduced motion the swap is instant and "Copied" still holds for 1.5s, so the
    confirmation stays readable without movement.
  - A copy the clipboard refuses, in an insecure context or with permission denied,
    confirms nothing, and a screen reader hears nothing. The toast confirmed every click,
    even a refused one.
- **No toast:** the confirmation sits where the reader is already looking, and the version
  badge beside it confirms its own copy the same way. A toast in the far corner said it a
  second time and stacked on repeated clicks. A status region still announces "Copied path
  to clipboard" to a screen reader, as the toast did.

## 2026-11-02: the README hero is one screenshot per appearance

The user disliked the hero's four-theme stitch and asked for two screenshots, one in
caret-light and one in caret-dark, with no composites. They also asked the hero to show
more of the app: a file preview on the right, a second comment, and the comment list ⇧C
opens. The README shows the pair through a `<picture>` element, so a reader sees the one
that matches their system appearance. `mise run assets` captures both.

- **Composition:** the plan in the source view fills the left, and the file it cites fills
  the right in the preview docked there. The two shots differ only in theme.
  - The first comment sits on the line citing `scripts/release/log.ts:9` and asks for
    `quiet` to go into `createLogger`. The preview opens on that file with line 9,
    `createLogger`, marked, so the eye runs from the comment to the code it is about.
  - The second comment is the old hero's comment, on step 3 of the demo plan. One card
    sits mid-plan and one near the foot, so they don't stack.
  - The comment list stands in the bottom right over the space under the 20-line file, so
    it covers no code.
  - The outline column is folded, because the app folds it beside a drawer at this width.
- **Frame:** 1440×900 CSS pixels at 2×, as before. The drawer is pinned at 560px, because
  at its default width the plan's 90-column lines run past the pane's edge.
  `scripts/tasks/assets.ts` keeps the previewed file's lines short enough to fit that
  width.
- **What stays out:** the first-run onboarding modal and the one-time drag tip are marked
  seen, and the pointer rests in the top bar's empty middle, so no tip or hover shows.
- **Privacy:** the status bar's cwd reads `~/acme-web`. The daemon reads the previewed
  file from a real temporary project, and the task swaps that directory for `~/acme-web`
  in the review JSON the UI reads.

## 2026-11-02: the find row closes from a Close key, and opening holds the plan still

The user saw the right side of the view jump open and back as the find row opened. They
also asked for the row's Esc hint to be a button, and, with Shortcut hints off, for a
button reading "Close" where the row showed no way out.

- **The jump:** the find row's field took focus while the row still sat past the crumbs'
  slot, at `translateX(100%)`. The slot's `clip-path` clips only what paints, so the row's
  box still reached past the slot. Focus scrolls the nearest scroll container to bring the
  field into view. `.plan-body` (`overflow: hidden`) is one, so the whole plan slid 170px
  left, then back as the row arrived. The field now takes focus with `preventScroll`, and
  `plan-search.e2e.ts` fails if `.plan-body` scrolls at all while the row opens.
- **Close:** one key replaces the row's × key and its Esc hint. It holds an ×, the word
  "Close" and, with Shortcut hints on, the `esc` cap. With hints off, Close keeps its ×
  and word and drops the cap, as the Search entry does.
  - It stands at the end of the crumbs' slot, where the Search entry stood, so the control
    that opened the row is the one that closes it. It is a key in a bed of its own, at the
    height of Versions and Preview beside it.
  - It carries `aria-keyshortcuts="Escape"`, so Escape on a committed search plays the
    press echo on Close.
  - The key hints after the step keys keep only the keys Close doesn't show: ↵ while
    editing, and `n`, ⇧N and `/` once committed. With none to show, they are not drawn.
- **Narrow widths:** Close with its word and cap takes about 5.4rem more than the × did,
  so every threshold the row gives way at moved. They are the `@container` queries in
  `PlanSearch.svelte`, and the header's cap rule in `DiffPlanView.svelte`. A change to
  Close's width moves all four.
  - Its word and cap go with the key hints, in a row under 30.4rem (was 25rem). That
    leaves an × the size of the step keys, the × the row had before.
  - The slash and the count's spaces now go under 16.6rem and 15.65rem (were 15.9rem and
    14.95rem). The header keys' caps go under 31.3rem (was 30.6rem).
  - At the narrowest window, 480px, the row with "No matches" has about 3px to spare.
    `narrow-regression.e2e.ts` measures Close as part of the row.

## 2026-11-02: the file drawer's title bar stands as tall as the plan header

The user asked for the file drawer's title bar to be as tall as the plan header beside it,
and allowed its contents to grow to suit the taller bar.

- **Height:** one token, `--pane-header-h` in `ui/src/styles/layout.css`, sets three
  heights: the plan header's, that of the box casting the plan header's foot shade
  (`.pane-lip::before`), and that of the header the file drawer and the folder card share
  (`.ref-header`). The plan header stays 2.85rem (45.6px). The drawer's bar grows from
  29.25px to match.
  - Docked right, the two bars share their top and bottom edges.
  - Docked bottom, and on the folder card, nothing sits beside the bar. It keeps the same
    height anyway.
- **What grew:**
  - The path, the bar's one emphasis, from `--text-2xs` to `--text-sm`, the size of the
    plan header's crumbs.
  - The kind tag ("Preview" or "Folder"), the line range and the esc hint ("esc to
    close"), from `--text-2xs` to `--text-xs`, the size of the plan header's "/ to
    search". The tag and the line range share one pocket height, 1.25rem.
  - The gap between the bar's parts, to the plan header's 0.6rem, and its side padding, to
    the plan header's 1.15rem. At that inset the close circle sits about as far in from
    the pane's side as from its top.
  - The folder card's refresh key, from 20px to the crumbs' 24px, with its glyph from 11px
    to 13px. It now meets the 24px minimum target size without an invisible margin around
    it.
- **What stayed:**
  - The close circle keeps its 11px size and its 25px target, because macOS keeps a
    window's close, minimize and zoom buttons about 12px across at every title-bar height.
  - The kind tag and the line range stay stamps rather than keys in a bed. Neither can be
    pressed, and the kit keeps keys for what can be.
- **Narrow widths:** at the drawer's narrowest, 240px, the old bar already squeezed the
  path to nothing, and its esc hint ran 46px past the pane's edge. The larger type would
  have pushed the hint 79px past it. The bar now gives way as it narrows:
  1. The esc hint goes when the bar, less its side padding, is under 26rem (416px) wide. A
     container query on the bar measures it.
  2. The kind tag goes under 20rem (320px).

  The line range stays, because it is the live region that announces each chunk of the
  file as it loads. At 240px the path now keeps about 45px beside "lines 9–67 of 67". At a
  480px window, docked bottom, every part still shows.
- **Tests:** `test/e2e/file-drawer.e2e.ts` holds:
  - both reference headers at the plan header's height, docked right and docked bottom;
  - the drawer's top edge level with the plan header's when docked right;
  - the bar at the drawer's narrowest, with nothing overflowing and the path in view.

## 2026-11-02: a filter clears from inside its field

The user found no obvious way to empty the outline's filter. Its "Clear filter" button
showed only once a query matched nothing, and it sat at the column's foot. They asked for
the way other products do it: Trello, Apollo, Behance and Mural all put an × inside the
field.

- **The ×:** a shadcn Command filter field, the outline's and the breadcrumb bar's, shows
  an × at its trailing edge whenever it holds text, a space included. A press empties the
  query and leaves the filter open, with focus in the field. In the outline's column,
  Escape still clears the query first.
- **Its look:** a ghost control, flat at rest and washed with `--ink-wash` under the
  pointer. A raised key would stand up out of the field, which is sunk into the surface.
  Its glyph is `--ink-soft`, a step above the search glyph's `--ink-faint`, so it reads as
  something to press, and it takes `--ink` on hover. It is 24px square and rounds at
  `--radius` less 3px, so its corner nests in the field's.
- **No motion:** it appears with the first character and leaves with the last, with no
  fade. It shows on nearly every query, so a fade would play constantly. The match count
  beside it already appears without one.
- **The count:** the outline's match count stands just before the ×.
- **The empty state:** "No headings match" keeps its line and loses its button. In the
  column it now sits under the field, where the rows would start. It used to sit at the
  column's foot, because the empty list still filled the column.

## 2026-11-02: the unsent row reads centred on dark paper

The user said the unsent row looked off-centre in dark mode and right in light. Its
content was centred to the pixel: the Resume key stands 3px off both edges, and the label
centres on the box. The shading moved where the eye took the edges.

- **Cause:** the row's tinted floor is lighter than dark paper. The bed's shade,
  `--bed-shade`, darkens the floor's top 2 to 2.5px to the paper's own lightness, so they
  merge into the paper and the top edge read inside the box. The bed's lit lip drew an
  edge 1.5px below the box. The row read 2px lower than its content, and the Resume key
  seemed to touch its top. The gap was widest on paper near black: caret dark and GitHub
  dark, and, in the preview, Catppuccin Mocha and Duskfox. On light paper the floor is the
  darker of the two, so the same shade makes the top edge sharper instead.
- **Change:** in dark the row takes `--unsent-shade`, the bed's shade with its top shadow
  at 0.4 alpha rather than 0.95 and no lip. The visible row now centres within 0.25px of
  its box in every dark palette, in the source view and the preview. Light keeps
  `--bed-shade` and renders the same pixels as before. `unsent-marker.e2e.ts` reads the
  edges off a screenshot in every dark palette.

## 2026-11-02: search opens from a Search entry in the plan header

The user asked for a way into search by the pointer. The "/ to search" hint looked like a
control but did nothing, and with Shortcut hints off the header offered no way in at all.
They also asked for the find row to "transform + slide open" from that place rather than
drop from the pane's top edge, kept simple and polished.

- **The entry:** a button named "Search" in the hint's place, at the end of the crumbs and
  before the view keys. It holds a magnifier, the word "Search" and, with Shortcut hints
  on, the `/` cap at its end. With hints off, only the cap goes. A click or Enter opens
  the find row as `/` does, with focus in its field. It carries the shortcut in
  `aria-keyshortcuts`, as the other header keys do.
  - It lies in a text field's shallow cut (`--field-floor` and `--panel-recess`) rather
    than standing as a key. A fourth key would weigh as much as Outline, Versions and
    Preview, and the crumbs are the header's main content. A search button shaped as a
    field is also the common pattern on the web (Whop, Evernote, Gusto), and the cut is
    the material of the find row's own field.
  - Under the pointer or keyboard focus, it takes `--ink-wash` and its label steps to
    `--ink`, as a ghost control does. A press, or the press echo of the `/` key, leaves
    the ghost's dimple. `theme.test.ts` holds the wash 4.5 ΔE off the field's floor, and
    the `--ink-soft` label at 4.5:1 on it, in every palette.
  - A touch device keeps the entry and drops only its cap, which is a key hint.
  - Its word goes with Versions' word in a header under 37.45rem. The magnifier, the cap
    and its accessible name stay.
- **The motion:** the find row slides sideways out of the entry, and tucks back into it.
  - The entry is the last thing in the crumbs' slot, which clips at its end. The row
    starts past that edge (`translateX(100%)`) and slides left to its place, over the
    entry and then the crumbs. It moves by transform alone, so the compositor runs it.
  - It opens on `--dur-pane` (240ms), because a slide across the header is as long a move
    as a pane's, and reads as a jump cut at 160ms. It closes on `--dur-state`, sliding
    back into the entry as the crumbs fade in.
  - The entry stays under the arriving row and hides once the row has covered it. Closing
    gives it back at once, under the leaving row.
  - Closing now plays with hints off too. Before, hints off removed the row at once,
    because there was no hint for it to tuck into.
  - Under reduced motion, the global switch drops the slide, so the row appears and goes.
- **The swap stays:** opening still lays the row over the crumbs, as the 2026-11-01 entry
  chose with its Swap option. At rest the entry resembles the resting field of its Inset
  option, which it passed over, but the entry never widens in place.

## 2026-11-02: search marks stand out, the outline key latches, the cwd sits in a bed

The user asked for three pieces of the review screen to look designed and of a piece with
the rest of caret.

- **Search marks.** The current match of a `/` search had to be the most obvious thing on
  the page in every theme, and the other matches clearly marked, a step below it.
  - The current match is the mark itself, opaque (`--mark-active`). Its text is whichever
    of `--ink`, `--paper`, `--paper-raised` and `--paper-sunk` reads most strongly on it
    (`--mark-active-ink`). The preview draws its bands over the text, so they tint the
    mark and its text alike: a held selection's `--accent-wash`, then up to 9% `--ink`
    from the cursor's or the pointer's band. `V`, then `/`, extends a selection to a
    match, so the current match can sit under both. Where not even white or black text
    would reach 4.5:1 under the bands, the mark first steps away from its text, only as
    far as it needs: Catppuccin Latte's and GitHub light's marks are mixed 10% toward
    black. Then, where the bands would take the text under 4.5:1, the text steps toward
    white if it is lighter than the mark, or black if darker, until it reaches 4.5:1.
    Catppuccin Frappé and Latte, Dawnfox and Dracula step their text.
    `ui/src/lib/theme.test.ts` holds the text to 4.5:1 under both bands in every palette.
    Before, the current match was a 34% (dark) or 28% (light) wash of the mark, with the
    line's own syntax colour as its text.
  - Every other match is a 36% wash of the mark (`--mark-match`), a step over the 18%
    (dark) or 14% (light) `--mark` a comment span wears. Its text is `--ink`
    (`--mark-match-ink`). The source view sets that text on the wash over two kinds of
    ground:
    - paper, or a code or table card's floor, under the cursor's or the pointer's band and
      any inline chip;
    - a table header's pad, the raised `--body` fill under the header row, lit toward its
      top edge by `--pad-top`.

    Where a palette's `--ink` falls under 4.5:1 on any of them, the text steps toward
    white in dark or black in light, only as far as 4.5:1 needs. caret's own palettes and
    both GitHub palettes keep their `--ink`. Before, every other match wore `--mark`.
  - A chip inside a table header is left out of those grounds, because on the pad's lit
    top under a chip no text colour reaches 4.5:1 in five dark palettes. Where a header's
    text sits, below that top, a match on a header's code chip measures 4.52:1 (Catppuccin
    Frappé) or more.
  - Both marks set their own text colour, over a syntax, heading or quote colour. An
    italic run's last glyph can slant past the mark's box, and the part outside keeps the
    mark's text colour, so on the paper beside the mark it can vanish. `::highlight()`
    takes no padding to widen the box, so this is accepted.
  - Measured as painted on a plain line, across the eleven bundled palettes and both
    views, as CIE76 colour differences (ΔE):

    | Pair | Before | After |
    | --- | --- | --- |
    | Other match against its line | 8.0 (Dawnfox) to 20.6 (caret dark) | 20.6 (Dawnfox) to 40.3 (Catppuccin Latte) |
    | Current match against its line | 15.1 (Dawnfox) to 35.3 (caret dark) | 52.6 (Dawnfox) to 103.1 (Catppuccin Latte) |
    | Current match against the others | 9.7 (caret light) to 20.2 (GitHub dark) | 35.1 (Dawnfox) to 64.1 (Catppuccin Latte) |

    Text contrast was read from screenshot pixels: the pixel inside a glyph furthest from
    the mark's colour, against the mark. At 1x, antialiasing blends a thin stem with the
    mark, so that read comes out low; the 4.5:1 minimum is therefore checked at 2x. The
    lowest text contrast rose from 2.9:1 (Catppuccin Frappé, read at 1x, so if anything
    lower than the true value) to 4.8:1 (Catppuccin Frappé, an other match on a table
    header, read at 2x). Under a held selection, the current match's text reads 4.6:1
    (Catppuccin Latte) or more. Before, it read 3.9:1 to 4.4:1 there in five palettes.
  - `test/e2e/search-marks.e2e.ts` holds, in every bundled palette and in both views:
    - an other match at least 18 ΔE off its line, and at least 1.5 times as far off it as
      a comment span's `--mark` on that line, which measures 1.86 (GitHub dark) to 2.62
      (GitHub light) times;
    - the current match at least 45 ΔE off its line and 30 ΔE off the others;
    - the text inside every match at 4.5:1, a code chip under the cursor's band and a
      table header among them;
    - in the preview, the current match's text at 4.5:1 under a held selection.
  - On a comment span, a selection, the cursor's and the pointer's bands, a heading, a
    code block and a quote, an other match stays at least 17.9 ΔE off what it sits on
    (Dawnfox, on a comment span). The current match stays at least 44.1 ΔE off it
    (Catppuccin Frappé, on a selected line). A thematic break (`---`) draws a rule in
    place of its dashes, which it paints transparent. A match on it keeps them
    transparent, so the mark shows as a plain band.
  - Not built: an underline on the other matches, because a link already underlines. A
    wash weakened per palette until its `--ink` held 4.5:1, because Catppuccin Latte's
    would have fallen under the old `--mark`.
- **The outline key latches.** The column's key and the header's are one toggle named
  "Outline", which supersedes the "Hide outline" and "Show outline" names of 2026-11-01. A
  press, or ⇧ + `\`, opens or folds the outline. The key latches down with its corner
  light while the outline is open, as the Preview key does, and stands up while it is
  closed.
  - The latch rides the key's travel. As the column stands, the key latches on
    `--dur-pane`; as it folds, the key lets go on `--dur-state`. Both run on `--ease-out`
    from the slide's first frame, not on the spring a key's return takes.
  - A click stands the column with the header's key already pressed down, so the column's
    key comes in latched. ⇧ + `\` stands it with the key up, so the key latches on the
    way.
  - A shortcut plays its press on the control it stands for, holding the key down for
    110ms (the press echo). A fold from ⇧ + `\` drops that echo from the key, which would
    otherwise hold it down past the end of its travel.
  - Reduced motion snaps the latch with the slide.
  - The column's head floors the key's bed with `--paper`, matching the floor under the
    key's bed in the plan header. A latched key drops its side and cast shadow, so only
    its face shows where it is. In every dark palette that face is at or under the body's
    lightness, so on the body the key read as a hole. Its ⇧ + `\` hint cap stood in the
    hole as if it were the key. The user saw this as the key looking misaligned.
    `test/e2e/tactile-kit.e2e.ts` holds the face lighter than its floor in every dark
    palette, by a colour difference (ΔE, CIE76) of at least 4.5.
- **The working-directory path sits in a bed.** It is centred on the status bar, between
  the version and the review's status, in a bed with no key, a `button.tray`. It shows
  whenever a review is open, whether the outline is shown or not. It first sat at the
  outline column's foot. The user asked to move it: "I meant like, the footer of the
  entire view, on the same line as the version number, the keyboard helper button, etc - I
  want it there in the middle". Three variants were tried on the real app in light and
  dark:
  - Bed, built: the `.tray` recipe, cut into the body like the header's beds. The user
    described it as "not a proper button, but just the bed".
  - Copy box: a text field's floor and `--panel-recess`. In light its white floor and edge
    read as a field to type in.
  - Pocket: a stamp's darker floor, as a pill. The kit stamps passive labels this way, and
    it read as a tag.

  The bed takes `--ink-wash` under the pointer and keyboard focus, and the path inks up,
  as a ghost control does. A press leaves the ghost control's dimple in it. When the path
  outruns the room between the bar's other segments, the path shortens to an ellipsis, and
  the version and the review's status keep their full width.

## 2026-11-02: the outline column resizes from its edge

The user asked to make the outline column resizable, "polished and intuitive, cohesive
with the rest of caret". This replaces the fixed 15.5rem width from 2026-11-01.

- **Bounds:** the column opens at 15.5rem, narrows to 12rem and widens to 30rem.
  - At 12rem an H5 row, four steps in, still holds a few words a line.
  - At 30rem a label's line reaches about 75 characters, the longest measure that reads
    well.
  - It widens only while the plan beside it keeps `MIN_READING_PX`, its 800px reading
    column. A window too narrow for that still lets the column stand at 15.5rem, so no
    window gives it less room than before.
  - A width the window can't hold shrinks with the window, and comes back as the window
    widens.
- **Beside a file:** the column yields, folding into the header's float, at the width the
  reader chose. A narrowed column stays beside a file that the opening width would yield
  to, and a widened one yields sooner. No gesture on the edge drops the column to a float.
  A drag beside a file stops where the column would yield. A double-click there returns
  the opening width if it fits beside the file, and otherwise the widest width that does.
  The browser remembers the width the double-click set, so the column keeps it once the
  file closes.
- **One splitter for both edges:** the file drawer's edge moved onto the same
  `Splitter.svelte`, so the two edges look and behave alike. Its 2px `--ink-faint` seam
  gave way to the grip. A full-height rule read as a hard line, which the chrome never
  draws. A double-click on the drawer's edge returns it to its opening share, 45% of the
  surface, and forgets the dragged size.
- **The grip:** it is the switch's key, at a key's 2rem height. It rises in the gap under
  the pointer and goes down while held. It follows the pointer along the edge, and stays
  where it was grabbed during a drag. It takes the key's rest face, `--knob-face`, rather
  than its hover face, because the hover face measures 2.94:1 on Catppuccin Frappé's body.
  A mouse drag leaves the edge focused, so the arrow keys can fine-tune it, but that focus
  doesn't raise the grip: only focus from the keyboard does. Otherwise every drag would
  leave a lit grip standing in the gap.
- **The edge covers only the gap:** the 0.5rem (8px) the outline's rows leave before the
  plan pane. The outline's list hides its scrollbar, so the edge overlaps no scrollbar.
  The edge starts below the column's head, because the head's outline key reaches 2.4px
  into the gap. When the edge ran the column's full height, it took a press on the key's
  rim, and its grip rose over the key.
- **No transform or throttle on the drag:** the drag needs neither, because it already
  holds the display's frame rate. The column resizes live, and the plan lays out again
  each frame. Measured with bare `requestAnimationFrame` timestamps and the Long Animation
  Frames API at 1440px in headless Chromium on `scripts/tasks/dev/fake-plan.md`, a drag
  holds 16.7ms frames, the display's rate, in both views. The page's first gesture pays
  one 100 to 130ms frame, which is caret's sound unlocking audio on the window's first
  `pointerdown`, whatever the gesture. Under a 4x CPU throttle the source view drops to 33
  to 50ms frames during a drag, and a window resize to 67 to 83ms. The preview holds
  16.7ms even there.
- **Not built:** the window splitter's optional Home, End and Enter keys.

## 2026-11-02: an outline row peeks at its section

The user asked for "a little hover preview window to the right of the selection that shows
you a snippet of what is in that section if you were to navigate to it", shown on hover
and while walking the outline by keyboard, and looking "accurate to the current view
type".

- **The peek is a copy of the live view, not a second render.** The source view draws
  every row and Preview every block, with no virtualizing, so the section is already in
  the DOM, themed and highlighted. Copying its rows or blocks matches the plan exactly in
  every theme for the cost of a clone. Rendering the slice again would need a second
  diff-library instance and caret's whole layer pipeline for source, would restart the
  line numbers, and would leave Preview's code plain until its highlight pass ran.
  - The source copy stands in a shadow root that adopts the live root's sheets and theme.
    It leaves out comment rows, whose cards live outside the shadow root, and the rows'
    hover, cursor and selection.
  - The Preview copy keeps the live root's class, so its scoped rules reach the copy, and
    its text wraps to the peek. The room the preview holds open for comments closes.
  - Images are the plan's own `<img>` elements, copied, so they come from the browser's
    cache rather than standing in as placeholders. One that fails to load hides, as it
    does in the plan.
  - Neither copy shows the search's marks. The search marks its matches with ranges over
    the live text, which a copy doesn't carry.
- **A heading with no text of its own shows its subsections.** Under `## Phase 1` sitting
  straight above `### Step 1.1`, the peek runs on to the next heading of its level or
  higher. Cut at the next heading of any level, it would show only the row's own name. 145
  of 836 headings across the user's 93 saved plans have this shape.
- **One dwell opens it, then it follows at once.** 350ms on a row, by the pointer or by
  the keys, opens it, so a quick walk to a known heading never flashes one. Once open, the
  next row's peek replaces it with no dwell and no re-entry.
- **It closes when the reader turns elsewhere.** That is the pointer leaving the list, the
  list losing focus, a row picked, the query changing, a wheel, a pointer press or a
  resize. It also closes on any key but a walk key (the arrows, Tab, Home and End) or `p`,
  Escape included. Escape still clears the query, closes the filter or closes the float as
  it would, so the peek never adds a step to backing out.
- **The list or the plan moving on its own leaves it open.** A list scroll carries the
  peek with its row, as when the list keeps a walked row in view. The plan keeping the
  reader's place across a flip between source and Preview does not close it. Closing on
  every scroll had cancelled the dwell whenever a hovered row scrolled itself into view.
- **`p` keeps it open on the other view.** The user asked for a peek "accurate to the
  current view type", and the flip is when that shows. The peek swaps in the new view's
  copy once that view has drawn the section, and closes if that takes more than three
  frames. On the 1,062-line rendering fixture the copy was there on the first frame, both
  ways.
- **A theme change closes it.** The plan draws the section again in the new theme, which
  takes longer than the three frames the peek waits for: about 80ms in source and 95ms in
  Preview. So the peek closes rather than keep the old theme's copy.
- **It sits where the eye already is.** It stands past the outline's right edge, measured
  live so a resized column carries it, level with the row. It stays 0.5rem inside the plan
  pane, so it never covers the top bar, the status bar or an open file. It measures itself
  again whenever its copy grows, as when an image in it loads. So it keeps inside the
  pane, and fades where the grown section is cut. When the outline is folded into its
  float, the peek stands past the float's edge.
- **It is a float on the view's floor.** The shadow is the menus' height, `--float-mid`,
  so it reads as something over the plan. The face is the plan view's own floor, the
  background the plan's text sits on, so the copy reads as the plan it came from. There is
  no arrow and no label; the heading it starts on names it.
- **Its edge holds 3:1 against its face and against the plan.** The peek lays plan text
  over plan text, so the edge is the one cue between the two. The menus' `--rule` ring
  measured 1.19:1 in dark, and the plan's lines seemed to run on into the copy.
  - The ring is `--ink-faint` stepped a quarter toward `--ink-soft`, which holds at least
    3.33:1 against both floors in every bundled palette. `--ink-faint` alone falls to
    2.99:1 on catppuccin-latte's source floor.
  - A thin raised frame around a floor-coloured well was the other option.
    `--paper-raised` stands only 1.03 to 1.07:1 from the floors, so the frame still needed
    the same ring, and the frame and the ring read as a double border.
- **Size:** up to 36rem by 16rem, about eleven source lines or a heading and seven lines
  of Preview, at the plan's own type size. Under 18rem of room it does not show. At 480px
  wide the float leaves too little room, so there is no peek there.
- **Accessibility:** the peek is `inert`, so it takes no focus, no pointer and no screen
  reader's attention, and Tab never lands on a link in the copy. It repeats text one jump
  away, and the row already names the heading and describes its comments and changes. A
  description of the snippet on every walk step would read whole paragraphs to a screen
  reader at each arrow press.
- **While you compare versions, there is no peek.** Compare draws a diff of two versions,
  not one plan's sections, so the `outlinePeek` row in `SURFACE_BEHAVIORS` covers source
  and Preview only.
- **Measured** on the 1,062-line rendering fixture (`scripts/tasks/dev/fake-plan.md`) at
  1440px in headless Chromium, one test worker: hovering, opening, and walking 20 rows by
  pointer and by keys gave no long animation frame (a frame over 50ms) and no gap between
  frames over 16.8ms, in both views. Under four parallel test workers, single frames of 50
  to 80ms showed at the hover and the open. One worker never showed them, so they are
  likely the machine's load rather than the peek's work. With the peek measuring itself
  again on every resize, the same run gave the same result, and the peek opened 353 to
  357ms after the pointer's first move on a row.
- **Not built:**
  - Comments in the peek. Their cards are live components slotted from outside the shadow
    root, and the peek shows the plan's text.
  - A peek on touch, where nothing hovers.
  - Scrolling inside the peek. It takes no pointer, so it never steals a hover or a click
    from the plan beneath it.

## 2026-11-01: the layout moves as one, and panes enter slower than they leave

The user asked for "nice animations when transitioning between various states", naming the
outline sidebar opening and closing, Preview hiding as compare opens, and Versions "doing
a nice little slide animation to take the preview button's place".

- **Panes enter on 240ms and leave on 160ms.** The outline column and the file drawer
  enter on `--dur-pane` and leave on `--dur-state`. At 160ms a 248px column moves about
  1.5px per millisecond, which reads as a jump cut. Material 3 puts container moves in its
  250 to 400ms tier and pairs an exit at about 0.6 of its enter. Every other change stays
  at 160ms.
- **The outline and the file drawer move on the page itself.** A change applies at once,
  so the plan is laid out where it ends in one pass, on the first frame. Each part that
  moved is then drawn back where it stood and slides home on a CSS transform transition.
  - Folding, the column leaves the layout and slides off the window's edge. Its Hide
    outline key travels to where the header's Show outline key will stand.
  - Folding or standing, the column shifts only the plan's left edge, and the plan pane
    itself holds still, so the view keys and the search hint against its right edge stay
    where they are. The pane's floor (its background) and recess (the inset shade at its
    edges) are layers of their own that stretch from the column's edge. Only what that
    edge carries slides: the plan's text, the crumbs and the find row.
  - Every part moves by transform alone, which the compositor (the browser's thread that
    moves layers already painted) runs. An animated clip runs on the main thread, which
    the long frame that lays out the change holds back. A clip on the crumbs' slot fell
    behind the slide that way and cut the search hint mid-word.
  - Opening a file, the drawer comes in at its full width and slides in from its edge, and
    a column it folds slides out in the same frame.
  - Closing one, the drawer leaves the layout where it stands and slides out. A column it
    folded stands again in the same frame.
  - A move that catches another mid-slide takes every part on from where it has got to,
    the folding column included. Left to its own CSS transition, a column turned back
    mid-flight ran for less time than the slide. It outran the plan's floor and opened a
    band of the window's background up to 195px wide between them. A file opening or
    closing slides the pane whole, so the floor's left edge carries on from where an
    outline toggle left it, and its right edge goes with the pane.
  - The slide starts about as soon as an instant change would paint. On a real two-version
    plan at 1440px in Chromium, an outline toggle's first moving frame lands 39 to 59ms
    after the key. The same change under reduced motion paints in 38 to 44ms. One or two
    frames of 25 to 42ms follow as the moved parts first draw, and reduced motion shows
    them too. After them, frames come 8 to 17ms apart.
- **Compare runs as one view transition,** because its content swaps as it moves, and the
  snapshot is what lets the old view fade through to the new. The plan, the header's
  controls and the column folding or standing all move on one clock, and the column moves
  as the outline's own slide moves it.
  - Each slot, a place where one thing replaces another, fades through: what leaves is
    gone by 40% of the run, and what arrives starts there, so no slot shows two images at
    once. The plan pane's own background holds under its images while they fade.
  - Standing again as compare ends, the column waits until the plan's old image has gone,
    then arrives with the plan. The plan's box changes width as it moves, so the main
    thread animates it and it trails the column, which only slides. Without the wait, the
    column's labels came in over the fading diff.
  - While the transition runs, a click lands on nothing: for 237ms entering compare, and
    410ms leaving it.
  - Leaving compare, the update itself takes about 100ms inside the transition, behind the
    old image. The new layout's first paint lands after the transition is ready, so the
    animations start over on the frame after it, and the motion plays whole rather than
    losing its start to that frame.
- **Compare's controls take turns.** Entering compare, the crumbs fade out as they slide
  6px toward the header's start, and Preview shrinks away. Only then does Versions slide
  into Preview's place, and the Base → Target controls fade in from 6px the other side
  once Versions has passed. Leaving, the controls fade out first, Versions slides back
  across their place, and Preview grows back once Versions has gone by.
- **A jump moves the latch once.** The latch is the outline row marked as the one being
  read. An outline pick, a crumb or a heading key latches its heading at once and holds it
  while the plan travels there, fading across in 160ms. The plan scrolling under the
  outline moves the latch with no motion.
- **A file's first open is coloured ahead.** Once the plan's file references resolve,
  caret reads the opening of the first file the plan cites in each language and highlights
  it while the reader reads. The highlighter compiles each rule of a language's grammar
  the first time a line reaches it. An earlier build warmed each grammar on a short
  hand-written sample, which left most of what a real Svelte component reaches uncompiled,
  so Svelte stayed slow on this plan. A Svelte file's first open now has no frame past
  34ms after the drawer's first frame, against one of 50 to 59ms after the sample and 165
  to 209ms with nothing warmed.
  - The cost moves to just after load, while nothing animates: one task of about 80 to
    90ms, about 0.8s after the page loads. It is the Svelte grammar loading and
    highlighting its first lines. Those run back to back once the grammar's code arrives,
    so a pause between reading the file and highlighting it leaves that task whole. A key
    pressed in that window waits for it.
- **Not built:**
  - View transitions for the outline and the drawer. Measured the same way, the snapshot
    held the first moving frame back 160 to 200ms after the key, and it took the pointer
    for 250 to 400ms, so a click in that window was lost. A second toggle snapped the
    column shut rather than reversing it.
  - A latch that glides between rows. The latched face is the row's own sunk key, and a
    separate indicator would part the key from its row for a glide that only near jumps
    would show.

## 2026-11-01: the outline joins the screen, and search swaps into the plan's header

Chosen through side-by-side previews, over two rounds. The user asked to "put the table of
contents into the plan view itself (I guess on the left-hand side)" and to keep it in
view, because "most people are visual and I bet don't even use the contents button". The
breadcrumbs stay and keep their behaviour, "'sticky' to the top of the plan view". The kit
stays: "I'm not looking for like, radical redesigns or anything; just optimizing layout".

- **Layout:** "Plan header", chosen over One bar (Versions and Preview beside the plan's
  name in the top bar, the outline as a column on the pane's sunken floor) and Three panes
  (the outline as a pane of its own, the view keys in the status bar). The user, of Plan
  header, which the previews labelled C: "I kinda like C if I'm honest." The control row
  goes:
  - The outline is a 15.5rem column cut into the body left of the plan pane. Its rows lie
    as keys on the rubber, and the cwd path sits at its foot.
  - The plan pane gains a header stuck to its top edge, with the breadcrumbs on the left
    and Versions and Preview on the right.
- **Contents:** the outline replaces the Contents popover, which supersedes "Peek" from
  2026-10-30. `\` moves focus into the outline and opens a filter at its top. The peek's
  facts become quiet row marks: the comment and draft count, and a dot on a section that
  changed since the last version.
- **Outline rows:** a label wraps to two lines, then truncates. Rows draw no H-level
  glyph; the indent alone shows the level.
- **Outline keys:** Lucide's `panel-left`, already vendored, with no word. The user: "The
  'outline' button doesn't need to say 'Outline' — it can just be an icon in the button."
  - At the column's head it is a plain button named "Hide outline".
  - With the column closed, the header leads with a toggle named "Show outline", pressed
    while the outline is out.
  - Neither name changes with the state, as ARIA's toggle pattern asks.
- **⇧ + `\` toggles the outline:** the cap shows the shift glyph then `\`, as Reject's ⇧R
  does, not a `|` glyph. The user asked for "'<shift>\' instead, where `<shift>` is the
  icon we use on other 'shift' keys".
- **A file open:** the column yields entirely whenever the plan would drop below its 800px
  reading column beside the file drawer, below about 1,710px at the drawer's default 45%.
  The header's outline key brings the outline back over the plan.
- **Under 960px:** the drawer docks below, as today. The outline drops from the header's
  latched outline key as a panel, with its filter focused.
- **Compare:** the header shows Base → Target and the diff toggles where the crumbs were.
  Versions is latched and Preview is gone. The outline folds away. The user's reason:
  compare tracks no reading position, and the split diff needs the width.
  - Entering compare slides the column out. It is a mode, so it never changes the reader's
    remembered outline choice, and leaving compare brings the column back as that choice
    has it.
  - The header leads with the outline key, as it does whenever the column is folded. `\`
    and ⇧ + `\` open the float.
  - The float lists only the sections that changed, each with a line count such as +8. A
    pick jumps to the section's hunk. With nothing changed, it says "No sections changed".
- **Narrow widths:** the build made these calls, and the user has not chosen them. The
  plan header gives way in steps, where the compare picker used to wrap to a second line.
  - **Versions' word:** it goes once the plan header is tight, before the compare controls
    give anything up. The header's own width decides, so a wide file drawer counts as much
    as a narrow window.
  - **The compare controls:** the Base and Target words go first, then the Bars, +/− and
    Both toggles. Settings holds the same choice as those toggles.
  - **The find row's key hints:** they go once the field is down to about 8rem.
  - **The query's floor:** the field keeps room for about five characters of query (3rem).
    Past that, the slash goes, then the match count's spaces, then, if the header is still
    too tight, its keys' hint caps while the row is open.
  - **The drawer's floor:** a file drawer docked right stops widening where the plan pane
    would drop below 468px, the width the narrowest window (480px) leaves it. The header
    then holds there whatever it holds at that window.
- **Search:** "Swap", chosen over Inset (a field resting in the header that widens on `/`)
  and Shelf (a find row under the header, across the pane). This supersedes "Sheet" from
  2026-10-30 and the hanging "/ to search" tab. The user had found the sheet "kinda just
  floating around" and "a bit amateurish", and picked Swap: "it feels more elegant."
  - On `/` the find row drops from the pane's top edge over the crumbs. It sits between
    the outline key and the view keys, which stay.
  - The match count sits at the field's end, and the key hints follow the step keys as
    text.
  - Closing lifts the row as the crumbs fade back in.
  - Closed, with Shortcut hints on, "/ to search" sits in the header before the view keys.
  - The cost is the trail. While search is open the crumbs are hidden, so the outline's
    latched row is the only "you are here" while `n` jumps between sections. The agents
    recommended Shelf for that reason.
- **Re-measured once built:** two steps moved to keep the floors on the new grounds.
  - The outline's quieter text (its title, and levels 4 to 6) takes `--toc-quiet`. On the
    float's raised paper that is `--ink-soft`. On the body it steps toward `--ink`,
    because `--ink-soft` measures 4.38:1 on Catppuccin Latte's body. `theme.test.ts` holds
    the stepped ink to 4.5:1 on the body in every palette.
  - In light, a crumb's risen face steps toward black from the raised paper. The face it
    took before, a key's white face, sat too close to the plan's own floor to read as
    risen. `theme.test.ts` holds it to 4.5 ΔE on both of the plan's floors, `--paper` and
    `--paper-sunk`, in every palette.

## 2026-11-01: every modal rounds as Settings does

Every modal now rounds at 14px (`--modal-radius`), the corner Settings had: its search
field's `--radius` plus the 0.5rem padding round the field. The user preferred that corner
to the 27px of the Request changes, Approve and Reject modals, and asked for it on those
modals. Those modals rounded at their action tray's corner plus the footer shelf's 1rem
padding, per the nested-corners rule. Like a setting group's padding, that inset is too
wide for you to compare the gap at the corner with the gap along the sides. Modals without
a footer shelf take the same corner. Below 640px wide, Settings keeps its own wider
corner, 20.6px, so its section picker's bed still nests in it.

## 2026-11-01: coloured hovers lift, and focus holds 4.5 ΔE

In light, a hovered amber or danger key turned dark (Approve in caret light went dark
brown), the way a neutral key did before "A light hover lifts, and the last corners and
labels". Reject's hover label missed AA in Dawnfox and Catppuccin Latte. Keyboard focus,
which wears the hover face, was hard to find in the faintest palettes. Each step below is
CIE76 ΔE as the browser paints it.

- **The floor is 4.5 ΔE, as the browser mixes it:** every hover face reads at least 4.5
  off its rest in every palette, about twice the just-noticeable step. `theme.test.ts` now
  mixes the derived tier in lab, as `color-mix(in lab)` does, where it mixed in sRGB. sRGB
  overstated dark steps by up to a third, so Catppuccin Frappé's crumb measured 3.8 there
  but painted 2.5. A browser probe of all eleven palettes matches the test within 0.1.
- **A light face steps toward black:** the neutral hover, chosen, knob, amber and danger
  faces in light mix toward black, not toward `--ink`. The light palettes' papers share a
  lightness, but Latte's and Dawnfox's ink sits nearer their paper, so a step toward
  `--ink` moved them a third less than caret light. The hover, 10%, and the knob, 5%, are
  the smallest steps that keep their tightest pair at 4.5 in all four light palettes; the
  hover's is the cursor on a chosen row. The chosen face, 5%, sits 4.9 off a resting key
  in every light palette. A neutral key moves 9.5 to 10.1 off its rest, where it moved 8.3
  to 12.2. The cursor on a chosen row moves 4.7 to 5.3, where it moved 4.3 to 6.6.
- **The amber hover lifts:** in light, `--accent-face-hover` is the accent 10% toward
  black, where it was 30%. A hovered Approve in caret light moves 8.7 off its rest, where
  it moved 25.7. Dawnfox's dark teal moves least, 4.8. The label holds 5.5:1 or more. A
  press keeps the hover face. Dark is unchanged: there a hover lightens the key, which
  reads as a lift.
- **The danger key holds AA, and Reject turns into it:** Dawnfox's `--danger` is too light
  for a light label: `--accent-ink` on it measured 3.84:1 on the Discard confirm, and
  Reject's `--paper` label 3.36:1.
  - In light the danger key rests on `--danger-face`, the danger 10% toward black, and
    hovers 18% toward black, where it hovered 30% toward `--ink`. Dark keeps `--danger`.
  - Under the pointer, keyboard focus or a press, Reject wears the danger key's face and
    label: `--danger-face` with `--accent-ink`, and `--danger-face-press` while pressed.
  - Every amber and danger label holds 4.5:1 on each face it wears, in every palette. The
    lowest is Dawnfox's danger key at rest, 4.64:1. `theme.test.ts` reads each coloured
    cap rule from the sheet and checks its label on every face the rule sets.
- **The cursor darkens a latched face:** the Contents row being read and the latched
  compare toggle rest on `--neutral-face-latched`, the chosen face tinted with the accent.
  In every light palette that face is darker than the hover face, so the cursor lightened
  them and dropped the tint. They now take `--neutral-face-latched-hover`, the latched
  face 6% toward black, which keeps the tint and darkens it by 4.9 to 5.4. Dark keeps the
  hover face, which is lighter than the latched face there.
- **A dark crumb steps further:** a crumb rests flat on the bar's `--body`, which the
  Catppuccin darks lift close to the hover face. In dark, `--crumb-face-hover` is now
  `--paper` 30% toward `--ink`, where it was the hover face's 27%. Frappé's crumb moves
  4.7, where it moved 2.5. 30% is as far as Frappé's `--ink` keeps 4.5:1 (4.53). Caret
  dark's crumb moves 18.7, where it moved 16.1.
- **A press never lightens the preview "+":** it pressed back to `--accent`, lighter than
  its hover in light, and now takes `--accent-face-press`. The gutter "+" never looks
  pressed, because @pierre/diffs cancels the press, so it never matches `:active`.
- **Focus still fails WCAG 2.4.13 (AAA):** the open item above records the measured change
  and the cost.

## 2026-11-01: a ghost hover washes its surface, and stamps take sentence case

- **A ghost control's hover is a wash of ink:** the vendored ghost Button's hover,
  keyboard focus and open menu paint `--ink-wash`, 8% ink over whatever the control sits
  on. It painted the opaque `bg-muted`, which in light is paler than a saved comment's
  lifted card, so the card's delete control turned paler than the card under the pointer.
  A wash darkens any surface in light and lightens it in dark, and the delete glyph still
  turns `--danger`. The card's header chip takes no wash: it fills the header, and the
  card's lift already shows the pointer or the keys are on it. The composer's Cancel and
  Keep for later are ghost Buttons, so they take the wash too.
- **Stamps and labels take sentence case:** the `.tag` stamp ("Folder", "Preview", "In
  use") drops its spaced capitals and keeps its pill, size, weight and ink. So do the
  version compare labels, a thread's comment count, the comment navigator's title, the
  Request changes dialog's "Context" label, and the table header in both the source view
  and the preview. A key's legend (the letters on a shortcut keycap, such as `ESC`) stays
  in capitals, because it mirrors the key. `ui/src/lib/sentence-case.test.ts` fails on any
  CSS rule in `ui/src` that sets `text-transform: uppercase`, except the key legend's.

## 2026-11-01: a setting group rounds as a bed

A setting group now rounds at 11px, the radius every bed takes (`--key-radius` plus
`--well-pad`), where it rounded at 25px. The user said its corner was "way too round", and
asked to bring it "closer to the corner radius that is used for the buttons". It is the
one shape that breaks the nested-corners rule. The group's padding, `--group-pad`, is wide
enough that the gap at its corner can't be compared with the gap along its sides, so
matching them made the group much rounder than its keys.

## 2026-11-01: a light hover lifts, and the last corners and labels

The 2026-10-31 focus pass made a hovered key or menu row in light a mid-grey slab. It was
darker than the chosen row beside it and darker than a pressed key, so a press lightened
the key, and the row read as disabled rather than as a key under the finger. Dark was
right and is unchanged. This pass fixes light and tidies what the 2026-10-31 passes left.

- **A light hover takes the smallest step the floor allows:** `--neutral-face-hover` moves
  13% toward `--ink` in light, half its old 26%. That is the smallest step at which every
  hover face still reads 3.5 ΔE off its rest in every light palette. The cursor on a
  chosen row is the tightest case, at 3.9 in Catppuccin Latte. The rise and cast shadow
  carry the rest of the lift. A neutral key in caret light now moves 10.8 off its rest,
  where it moved 21.5. The switch's knob steps 7% toward `--ink` where it stepped 20%.
  That is the same face it takes when pressed. `theme.test.ts` keeps the light step within
  1 ΔE of the floor.
- **A press never lightens a key:** a press in flight takes a press face
  (`--neutral-face-press`, `--accent-face-press`, `--danger-face-press`) with the concave
  press shading. In light that face is the hover face, which is already the darker; in
  dark it is the down face, as before. A latched toggle, a chosen segment and a chosen row
  still rest on `--neutral-face-down`, and the cursor on one still takes the hover face on
  the latched shape.
- **A crumb rises to a key's face:** on the bar's grey `--body`, a 13% step lands on the
  bar's own shade, 1.7 ΔE off it in Catppuccin Latte. So in light a crumb under the
  pointer or the keys rises to `--neutral-face`, the white face the bar's keys rest on,
  through `--crumb-face-hover`. Dark keeps the hover face.
- **The last corners nest:** the Discard confirm bubble pads its action tray evenly and
  rounds at the tray's corner plus that padding. A saved comment's header controls round
  at the card's corner less the header's padding. The Folder and Preview stamps stay as
  they are: equal insets would push the Folder stamp 4px tighter into its corner than the
  header's far end, and round the folder tree near 15px only to fit a label. The Preview
  stamp sits after the close disc, not in a corner.
- **No section label is set in capitals:** the shortcut groups and the Contents panel's
  breadcrumb headers move from spaced capitals to `.form-label`, the sentence-case recipe
  the dialogs and Settings use. The `.eyebrow` atom had no other users and is gone.
- **Focus stays where it is shown:** the gutter "+" stays while it holds keyboard focus.
  Before, it vanished when the pointer left and took the focus with it. The breadcrumb
  bar's filter field wears the Contents filter's cut and lit wall (the `.field-well` focus
  recipe), where it showed no focus at all.

## 2026-10-31: focus looks like hover

The user asked for keyboard focus to look exactly like pointer hover: "also I really don't
like the focus ring when using the keyboard to navigate the breadcrumbs menu, or honestly
any element for that fact. the visual should look clear, like I were a user hovering with
the mouse itself. it should look identical when using the keyboard."

- **No focus ring:** no control draws an outline, halo, inset ring or glow on focus. A
  control under keyboard focus wears its hover look: the same face, shadow, lift and ink.
  Text fields are the exception, below. In a menu or a list whose highlight follows both
  the keys and the pointer, the row the keys move to looks exactly like the row the
  pointer moves to. Forced colors strips faces and shadows, so there `base.css` keeps a
  transparent outline, which the browser repaints in a system colour.
- **What it supersedes:**
  - the Keypad entry's focus ring: the solid 2px `--accent` ring, and the inset ring on a
    Select's or command list's chosen option under the highlight;
  - the Contents panel's `--accent` outline while keys drive its selection;
  - the folder tree's ring on a row with keyboard focus, from "one tactile look";
  - the 2026-10-30 "Text fields" bullet's separate keyboard indicator for controls, which
    is now their hover look;
  - the call on the accent focus ring on a highlighted menu row, which this settles.
- **Hover strong enough to find:** with no ring, a hover face is the only mark of keyboard
  focus, and several were too faint to find. Measured as a CIE76 colour difference (ΔE),
  where about 2.3 is just noticeable, a hovered key in caret light moved 3.1 off its rest,
  the highlight on a chosen row 1.0, and a settings nav row 0.0, since its hover face
  matched the bed's floor. They now measure 21.5, 16.7 and 18.4. The neutral hover face
  steps as far toward `--ink` as Catppuccin Frappé's `--ink` (dark) and Catppuccin Latte's
  (light) keep 4.5:1 on it. A chosen key, segment or row under the highlight stays down on
  the hover face, rather than a mix of its down and hover faces. The accent key and the
  gutter "+" take `--accent-face-hover`, and the danger key's and the switch's hover faces
  step further too. On a face that far off, only `--ink` holds AA, so quieter text on a
  risen face steps up to `--ink`, as a hovered row's labels already did. Glyphs there need
  only 3:1 and step to a neutral key's label ink, a rung under the text.
- **The floor:** every hover face reads at least 3.5 ΔE off its rest, in all eleven
  palettes, and `theme.test.ts` pins it. The target was `GLANCE` (20 ΔE), the step
  `theme.test.ts` takes for two colours that read apart at a glance. It cannot hold in
  every palette: with `--ink` at 4.5:1, a neutral key's face can move about 10 ΔE in
  Frappé and 13 in Latte. One mix serves every palette of a scheme, so it stops a little
  short of those to keep a margin. The open item above lists the shortfall.
- **Controls with no hover look got one:** a link chip in the preview takes a reference
  chip's wash and keeps its text colour, the reference hint dot darkens, a comment
  navigator row with nothing to scroll to rises as a key, and a comment card lifts while a
  control in it holds focus. The file preview's code region is read-only text, so its
  focus lights one wall, as a field's does.
- **Text fields keep their focus look:** one lit wall of the cut. A field is where typing
  goes, not a control with a hover look to borrow.

## 2026-10-31: calls handed over

The user handed the calls left from the "one tactile look" pass to the agents: "Honestly
at this point, I feel like I would trust your judgement on this for now until I feel
differently, I'll just have you adjust it. go with your gut". The agents made these:

- **Modal titles stand alone:** a modal no longer stamps its kind as a tag over its title,
  such as "APPROVE" over "Approve this plan?". A small label set above a heading reads as
  a generated page, and caret never uses one. Every title but two already named its modal.
  The shortcuts modal is now titled "Keyboard shortcuts". Onboarding, whose tag read
  "Welcome to caret", now takes that as its title, over the notifications invite. This
  supersedes the modal's kind in the "one tactile look" Tags bullet.
- **Form labels:** a dialog's field and section labels, such as "General comment" and
  "Unsent comments", are sentence case at `--text-sm`, weight 600, `--ink-soft`, as
  Settings' section headings are. They were spaced capitals, and caret sets no section
  label in all capitals. "(optional)" follows its label at body weight. The capitals'
  tracking had hidden a missing space in Request changes' "General comment(optional)". On
  the modal's panel the labels measure 5.19:1 in Catppuccin Frappé and up to 8.82:1 in
  caret dark. Request changes and the Approve and Reject guards are the only users of
  `.form-label`.
- **Source floor:** the source view showed a hard step where the plan ended, with the rows
  on `--paper-sunk` and the pane below them on `--paper`. Wherever the diff library draws
  the plan, the pane past the rows now takes the rows' floor. That covers the source view
  and the version compare, which had the same step. The preview stays on `--paper`, pixel
  for pixel. `--diffs-bg` is unchanged, because the library derives its context, buffer
  and hover surfaces from it. The unanchored comment list's ink measures at least 4.73:1
  on the sunk floor, in Catppuccin Latte. The code-block and table scoops, the cursor and
  hover bands and the scroll-past-end room were checked in all eleven bundled palettes.

These stay as built:

- **The composer's footer shelf:** the composer's actions rest on the same shelf as a
  modal's, so every action tray in caret rests on one kind of surface.
- **Cited line numbers in bold `--ink`:** the accent fails 4.5:1 on the cited band, and
  the full-bleed band carries the citation.
- **The task box's 1px edge:** without it an unchecked box measures about 1.0 to 1.2:1.
- **Settings rows parted by space alone:** space groups them, and the user wants borders
  "almost nonexistant".
- **A key's sub-pixel dead band:** a key moves its box as it travels, so a press within a
  pixel of its top edge can lose its click. The band is under a pixel, and closing it
  means restructuring every key.

## 2026-10-31: Keypad

Chosen through two rounds of mockups.

- **Kit:** "Keypad", a silicone keypad like the rubber buttons on a remote or a
  calculator. The user found the tactile kit "a little boring" and asked to "lean more
  into skeuomorphism" so it would look "a little more fun". Controls are soft rubber keys
  that stand above rubber wells and travel when pressed. Tables and code blocks stand on
  the plan as raised rubber pads. The directions that lost:
  - round one: Machined, which the user liked but for its screws; Molded, which the user
    liked; and Glazed;
  - round two: Sculpted and Pillow.
- **Keys:** a rounded rectangle with 8px corners, in a bed that rounds at 8px plus its
  pad. The face is domed: a lift along its top, kept above the label, and a darker foot.
  Below the face shows the key's rubber side, then a soft cast shadow. A press takes the
  key below its place: its shading flips concave, its side and shadow fold away, and it
  springs back past rest when released. A toggle that is on stays down and shows a small
  amber light in its corner. The build first gave the side 3px, a 1.5px rise and a 1px
  sink; the Depth bullet below lowers them.
- **Key corners:** the build first rounded keys at 9px. After seeing it, the user asked
  for the keys and their wells to be "a tiny bit less round". Shots at 8px and 7px kept
  8px, because 7px read closer to a plain button.
- **Split Approve:** two keys 4px apart, each rounded to 4px where it faces the other. The
  fused button split only on hover; on two keys the split always shows, so each key hovers
  and presses on its own, as every key does.
- **Code blocks:** raised, the one change the user asked for after the mockup: "go with
  keypad, but make code blocks feel raised above the surface, similar to the buttons." A
  block is a raised pad of the window's body, with its code in a shallow scoop on the
  pad's face, as a table's rows are. Chosen over a pad with the code straight on its face.
  In the dark palettes that face is lighter than the paper, and syntax colours fell under
  the 4.5:1 floor on it: punctuation measured 2.98:1 in Catppuccin Frappé, 3.77:1 in
  Catppuccin Mocha and 3.95:1 in Dracula. The scoop keeps the floor the code sat on
  before.
- **Keycaps:** little rubber nubs with 5px corners, a face tinted from the text colour
  around them, a soft lift, a 1.5px side and a small shadow. After the mockup the user
  asked for them "a little more narrow for the single key cap icons", for "better up arrow
  icon for the shift modifier", and that "in general the keycap icons should look a little
  smaller". A one-glyph key is now 14.9px wide and 17.5px tall in the top bar, down from
  19.8px square, with its glyph centred to within about half a pixel. The shift key keeps
  Lucide's `arrow-big-up`, now drawn at a keycap glyph's height with a 2.5 stroke, the
  weight of the glyphs beside it; the help modal drew it larger than its letters. Two
  other Lucide 1.31.0 icons lost: `arrow-big-up-dash`, which reads as Caps Lock, and
  `arrow-up`, which reads as the Up arrow key.
- **Plan pane:** a deeper, softer screen recess with 14px corners. The search sheet's foot
  rounds at 14px too, so its corner stays concentric with its key tray.
- **Beds:** after seeing the build, the user found the keys in their wells "a little out
  of place". The wells were a darker floor round each group, which read as an outline
  drawn round the keys rather than a cut, and their pads differed from surface to surface.
  A mockup drew four boards: Now, Free (keys straight on the chrome), Plate (a hole per
  key) and Bed (a well cut from the chrome's own rubber). Deck, a group on a raised mat,
  was built and dropped, because it kept an edge round each group and white keys lost
  their edge on its near-white mat in light. The user picked Bed. A bed has no floor, only
  the cut's shading, so the keys cast onto the rubber they stand on. Every bed shows an
  even 3px gap round the key and rounds at 11px. The bell and settings keys drop to the
  top bar's 28px.
- **Segmented controls:** a gang of keys 3px apart, with 4px inner corners like the split
  Approve. The user had first found the compare view's segments "a little too big" for
  their wells. The chosen segment now latches down, as a latched toggle does, with no
  amber light, so "on" reads one way across the kit. The sliding pill behind the compare
  view's segments is gone.
- **Depth:** with Bed, the user said "I think I like the bed, but I think the buttons feel
  a little too tall", and then "honestly everything feels a little too tall, not just the
  buttons". They then corrected it: "sorry by "tall" I didn't mean like, the height on the
  screen. the height of the buttons was fine. What I didn't like was how tall the buttons
  *felt*, like if they were physical buttons the way they looked they literally fellt too
  tall, like they were coming out of the screen too much". So the keys keep their size on
  screen and stand lower. One token, `--key-side`, now sets the side, and the rise, the
  press and the cast shadow scale from it. Shots at a 3px side (the build), 2px and 1.5px
  kept 1.5px: a 0.75px rise, a 0.5px sink and a cast shadow half as long. It is the step
  that clearly reads lower, and the key still stands as rubber in its bed, with its
  latched and pressed states still down beside a resting key in every checked palette.
  This changes the rise and side the Keys bullet above had settled. Everything else that
  stands on a surface also stands half as far out, because the user's "everything feels a
  little too tall, not just the buttons" covers more than keys. The table and code-block
  pads (`--pad-stand`), the raised chips (`--chip-raised`) and the low floats
  (`--float-low`, under a saved comment and the "/ to search" tab) all scale from
  `--key-side`. Menus, popovers, toasts and modals (`--float-mid`, `--float-high`) keep
  their depth, because they hover above the page rather than stand on it, and a sunken
  surface has no height to lower. The keycaps' nubs stand no higher than the lowered key
  (a 1.5px side on both), so they are unchanged. The Contents row's key now takes the key
  row's rise and press (`--key-row-*`), and keeps its own faces and its
  `--neutral-face-latched` latch. It had kept its own side and cast shadow at the old
  depth, about twice as thick as any other key row.
- **Gutter "+":** the user asked, "can you make the "+" button on the left-hand rail
  follow a similar style as the buttons at the top? it doesn't need a "bed"." So the
  comment "+" beside a hovered line, in both the source and preview views, is now an
  accent key like the top bar's Approve, on no bed: the same face, grain and press, at the
  same lowered rise (`--key-side`). It keeps its one-line size. Its old drop shadow is
  gone.
- **Focus ring:** a solid 2px `--accent` ring. The old ring, `--accent-bright` at 30%,
  measured 1.54:1 in light and 1.96:1 in dark, under the 3:1 floor for a non-text
  indicator. The accent measures 4.07:1 in light and 7.28:1 in dark. The cursor of a
  Select or a command list is the list's `aria-activedescendant` and takes no focus. On
  the chosen row it showed only as a face mixed from the latched and risen faces. In the
  light palettes that mix differs from the latched face by a CIE76 colour difference (ΔE)
  of 0.6 to 0.9, under the 2.3 that marks a just-noticeable difference, so a keyboard user
  opening the theme Select saw no cursor. The cursor on a chosen option now also wears the
  ring, inset so a list's first row doesn't clip it.
- **Window body:** grain, and a faint gradient lit from above over the chrome.
- **Tables:** a raised rubber pad of the window's body, with the keys' side and cast
  shadow. The header sits on a lit band along the pad's top, and the rows sit in a soft
  scoop on its face.
- **Stamps:** a rubber pocket with a darker floor. The beds no longer have one.
- **Status light:** a lit LED with a soft glow of its own colour.
- **Radii:** the keypad rounds with its own tokens (see
  [`exceptions.md`](exceptions.md#radii)); fields, menus, cards and modals keep `--radius`
  and `--radius-lg`.
- **Motion:** a key's return springs past rest (see
  [`exceptions.md`](exceptions.md#a-keys-spring)). Under reduced motion no key moves, and
  only its shading changes.
- **Floors:** a dark neutral key's face is mixed from `--paper` toward `--ink`, rather
  than from `--paper-raised`, and its label is `--ink-soft` stepped 15% toward `--ink`.
  Before, the label measured 4.09:1 on Catppuccin Frappé's face. Every palette's neutral
  label now holds 4.5:1 at rest, hovered, pressed and latched. Quieter text on a risen or
  latched key row also takes that label ink (`--ink-soft` stepped 15% toward `--ink`): the
  comment navigator's line label, comment text and unsent tag, the version menu's
  "(current)" marker, and the enclosing heading that the breadcrumb bar's `/` filter shows
  beside each result. On GitHub dark's risen face, `--ink-faint`, the old ink of the
  marker, the enclosing heading and the navigator's line label, measured 2.23:1.
  `--ink-soft`, the old ink of the navigator's comment text and unsent tag, measured
  4.05:1. The label ink measures 4.80:1.
- **Status bar:** 2.25rem tall, so the help key's deeper well clears the pane and the
  window's edge.

## 2026-10-31: one tactile look

The user asked for the rest of the UI to match the keys, beds and finishes: "it'd also be
awesome if you could make adjustments to many other aspects of the UI that would bring it
inline with the latest aesthetic that we've landed on with the "beds", the button styles
and tactile "finishes", etc. to make this all feel cohesive". They named five surfaces:

- "the popup for when a user clicks on a piece of text in the file that is a folder";
- "the look and feel of some of the UI elements for previews of files that are shown when
  you click on some text that refers to a file that exists in the repository";
- "the look and feel of the commenting card itself (not the buttons, but like, the
  surrounding UI, text field, etc)";
- "The look and feel of the settings modal again; I kinda like the "beds" that we made for
  the buttons in the header and whatnot, let's take that similar style to this as well for
  things like the selected view, the way that grouped controls look, etc";
- "the look and feel of the approve / request changes / reject modals … focusing on the
  way the UI looks for comments in the Approve / Request changes / Reject modals look - I
  want those to get a touch up so that it fits in with the aesthetic that we've been
  building".

They added: "There are probably other things."

- **Text fields:** a field is a cut, `--panel-recess`, with no ink ring. On focus one wall
  of the cut firms to `--field-edge-focus` (`--ink-faint`): the lower wall in dark, the
  upper in light (`--field-wall`). This supersedes the earlier focused edge of
  `--rule-strong`, which measured 1.26 to 1.65:1, and a 1px focus ring the pass first
  built, which read as a drawn border where the user wants borders "almost nonexistant". A
  lip under the field was tried and dropped, because it read as an underline. The accent
  text cursor now covers every field. The flat disabled cap stays search-only.
- **Modal bands:** a band on a floating surface is a step in the modal's panel, not a
  ruled strip. The header is a lip the content tucks under, and the footer is a shelf on
  `--group-floor` one step below, where the action tray rests. These replace the hairline
  dividers. The esc hint loses its chip, moves to `--ink-soft`, and reads "esc to close"
  in modals and preview cards.
- **Tags:** `.tag` is one stamp recipe for Folder, Preview, In use and a modal's kind.
- **Key rows:** `.key-row` moved into `atoms.css`, with its states in the `--key-row-*`
  tokens so a list in a shadow root can wear them. A row rises under the pointer or the
  keyboard and latches down on `--neutral-face-down` when chosen. Its users are now the
  Settings nav, the theme list, every dropdown row, the breadcrumbs, the comment
  navigator, the version picker, the folder tree, the cwd path, and the Select listbox.
  The amber leaves the crumb menu's current row, the navigator's current rail, the version
  check (now ink) and the folder tree's selected row (`--accent-wash`), which retires
  those "amber on a state" sites. In a menu or listbox a row rises on the highlight alone,
  never on hover, because the highlight already follows the pointer and hover would raise
  a second row under keyboard travel. A Select's chosen row is named by `data-active` and
  latched, because bits-ui's `[data-selected]` marks the chosen option, not the cursor.
  The crumbs in the bar are flat keys that borrow the risen state and never latch; the
  current crumb is marked by weight.
- **Settings beds:** the nav's sections share one bed and the chosen one latches down.
  This supersedes the 2026-10-30 "Inset groups" flat rail with the section stamped in, on
  the user's "beds … for things like the selected view". Standing keys in the bed were
  tried and dropped, because five raised keys the rail's width read as a stack of buttons.
  Each setting group is a bed on `--group-floor` with `--bed-shade` at its corners, with
  no ring and no hairline between rows. A bed at panel scale takes the group floor because
  a bare cut's lit lip is white on white on a light panel. The bed also fades out below
  its first rows. Section headings are sentence case at `--text-sm`, weight 600,
  `--ink-soft`; the uppercase caption is gone, for the all-caps refusal and the
  `--ink-faint` floor.
- **LEDs:** status lights in Updates, Advanced and the safe-mode toast are lit LEDs,
  through the `.led` and `.led-off` atoms. The safe-mode light is an `--attention` LED.
- **Stamped marks:** the Notifications bell sits in a stamp's pocket, and its status word
  takes the comment stamps' word ink. The file preview's loaded-range readout, the waiting
  screen's hint and the build tag's "Copied" are stamps. Release-note inline code wears
  the plan's stamped code chip in ink.
- **Folder popup:** the tree's rows are key rows, and its glyphs step up to `--ink-soft`
  on a risen or latched face. Its scrollbar is the code block's bar, and the refresh
  control is a key lying flat.
- **File preview:** the close disc is a round rubber key on no bed, kept red, the recipe
  the gutter "+" uses. The cited-line band runs full-bleed, through the gutter and across
  the scroll width. The gutter draws no rule; its edge shades code scrolled sideways under
  it, and the pane shades its foot while more of the file lies below, as the plan pane
  does.
- **Composer and dialogs:** the composer's actions rest on a footer shelf. In Request
  changes, a committed row is a paper card, the saved comment's low float, resting in a
  recessed tray cut into the panel, and an unsent row stays a tinted well on the panel.
  The sections lose their ruled boxes, and their labels sit on the panel. This supersedes
  the 2026-10-29 "Request changes rows" bullet, the 1px `--rule` ring. Cards on the bare
  panel were tried and dropped, because they nearly vanished in dark. The Approve and
  Reject guards list committed comments in a recessed group with hairline rows, and unsent
  ones in a tinted well; the Reject guard now splits "Your comments" from "Unsent
  comments" as Approve does. A thread of saved comments rests in a recessed group with no
  hairlines between cards. Count chips in both dialogs are stamps, and the unsent count is
  tinted at the stamp's strength. Read-only text in a dialog, such as the compiled preview
  and the context lines, sits in a cut on `--group-floor`.
- **Ink floors:** the dialogs' notes and summaries, anchors, the "Context" label,
  chevrons, the thread's count and ordinals, and "Keep for later" at rest move from
  `--ink-faint` to `--ink-soft`. A hovered row's labels step up to `--ink`, because the
  `--ink-wash` hover takes `--ink-soft` under 4.5:1 on the tint. Cited line numbers in the
  file preview are bold `--ink`, not the accent, which measured 3.66:1 on the band and
  4.45:1 on paper in Catppuccin Latte.
- **Plan surface:** a task box is a stamped pocket (`--well-floor`, a pressed shade,
  `--well-lip`) with a 1px `--ink-soft` contact edge and its check or slash pressed in,
  drawn in CSS, in both views. The edge holds WCAG 1.4.11, since the pocket's floor alone
  measures 1.00 to 1.17:1. This supersedes EXC-860's Lucide `square` masks and the
  preview's filled grey box and dash. Images stand on the table's pad in both views,
  replacing the source view's hairline card; the pass tried no frame at all and dropped
  it, because a white-ground screenshot dissolves into light paper. The unanchored comment
  list moved inside the plan's scroller, and its items wear the saved card.
- **Navigator and tooltips:** the comment navigator marks an unsent row as the tinted well
  with the glyph and "unsent"; hovered or current, it is a key like any other row. Its
  footer legend is a shelf. Tooltips are small hints on `--paper-raised` with
  `--shadow-chip` and no arrow.
- **Focus on open:** Onboarding and What's new hand focus to their panel.
- **Voice:** an error names its fix: "Couldn't load what's new — close this and open it
  again to retry."
- **Concentric corners:** the user said "the corner radius of the approval / request
  changes display of the comments that will be submitted could be a bit more polished". A
  card in the Request changes tray rounded wider than the tray round it, so the gap at the
  corner was wider than along the sides. Every nested corner in the tactile look is now
  concentric, per **Nested corners** in [`patterns.md`](patterns.md#the-tactile-kit).
  Where the inset is large, the container rounds wider: a modal with a footer shelf, the
  comment composer and a setting group. The popup menus round a little wider too, to hold
  their key rows. Moving the keys to a bed's 3px from the edge instead was tried in shots
  and dropped, because the keys crowded the edge.

## 2026-10-30: tactile surfaces

Chosen through side-by-side previews.

- **Window:** "Inlay", chosen over Islands (the chrome floating over an open background)
  and Deck (a raised slab). The window is one body, every control is cut into it, and no
  bar paints a face or a rule. The plan is a pane set into the body. The user found it
  strongest in light, so dark was tuned past the preview: the body lifts 7% toward ink, so
  the pane reads as a darker screen set into the body on every dark palette.
- **Contents:** "Peek", chosen over Keys (rows as keys in a 26rem panel) and Tray (the
  outline in a well at 32rem, with columns). A split float: the outline beside a peek at
  the section under the selection.
- **Search:** "Sheet", chosen over Plate (a one-row find bar) and the earlier pill
  restyled in the kit. The search hangs from the pane's top edge and tucks under its lip.
- **Settings:** "Inset groups", chosen over One sheet (the rail as a segmented well) and
  Bezel and screen (the panel framed as a device screen). The rail is flat, with the
  current section stamped in. Each section's rows sit in a recessed group. Below 640px a
  bar with a section picker, a search key and a close key replaces the rail. Settings
  spends amber only on the primary action and the tint of a switch that is on.
- **Text fields:** no text field draws a focus ring. A field shows focus by its text
  cursor and its well's edge firming to `--rule-strong`. The user asked for this on the
  Contents filter and the search box, and it now holds kit-wide. Controls keep a visible
  keyboard indicator.
- **Modals:** a modal that takes focus on open draws no focus ring around itself. The user
  asked for this on Settings opened with the `,` shortcut.
- **Switch, on:** the channel takes the accent mixed into the well's floor, 30% in dark
  and 18% in light. The earlier channel, the floor stepped toward ink, read too subdued.
  Two alternatives lost: a green channel would give `--ok` a second meaning, and an amber
  knob was louder than the subtle colour the user asked for. The latched knob also dropped
  its blurred press shade for hard edges, because the blur read as fuzzy in dark.
- **Unsent comments:** the plan marks a comment kept with **Keep for later** by a
  full-width well under its line, tinted toward `--attention`. A saved comment floats on a
  card, and an unsent one sits in a coloured, recessed well. The well holds:
  - the `message-square-more` glyph, a speech bubble with an ellipsis, so it reads as a
    comment still waiting at 14px, and the word **Unsent** in the comment stamps' word
    ink;
  - the kept text in `--ink-soft`;
  - a neutral **Resume** cap at the right, which reopens the comment in its editor.

  "Draft" already labels a saved comment, and the pencil is its glyph, so neither is
  reused. The same word, glyph and `--attention` tint mark unsent comments on every
  surface, with a pill-sized count taking the stamp's lighter strength: the source marker,
  the Contents panel's count and peek ("N unsent"), the Request changes dialog's unsent
  rows, and the Approve guard's unsent list (the confirm shown before approving with
  unsent comments). The Request changes dialog's hint reads "N unsent comments below", and
  its demote button is **Mark as unsent**. In a dialog, a committed comment is a paper
  card and an unsent one a tinted well inside the same plain section, so material alone
  tells them apart. Chosen over:
  - a plain neutral well, which the user found too easy to miss as comments waiting to be
    revised;
  - a neutral well holding a tinted "Unsent" pill, which read as another state stamp from
    the saved card's set;
  - a dashed bubble glyph, which reads as a marquee square at 14px.
- **Tables:** "Inlay", superseded on 2026-10-31 by a raised pad (Keypad). Chosen over two
  other tactile builds:
  - Engraved: the recessed panel with every rule cut into it as a groove, and the header
    pressed in;
  - Keys: the table as a tray, with each row a rubber key in it that lifts on hover and
    sinks when pressed.

  The user preferred Inlay and gave no reason against the other two. A table is now built
  like the window. A raised bezel of the window's body material carries the header on its
  top rail, and the body rows sit in a pane sunk into the bezel. A faint hairline splits
  the rows, and no rule divides the columns, which read from their alignment. This
  replaces the recessed panel that tables took on 2026-10-29. An earlier round kept that
  panel and varied only its lines: a header band, alternating row stripes, and an open
  table with three rules. The user found those "very minor variations of the current
  design", not tactile enough. The build differs from the mockup in two places:
  - The header ink is `--ink-soft` stepped 10% toward `--ink`. Plain `--ink-soft` on the
    bezel falls under the 4.5:1 text floor in Catppuccin Latte, Catppuccin Frappé and
    Dawnfox.
  - Hovered and cursor rows band 7% toward ink off the pane's floor. The source view's
    light hover band is the same colour as the light floor, so it disappeared there.
- **Code blocks:** "Bezel", chosen over two other builds:
  - Inlay: the table's build, with the opening fence and the copy and wrap tray on a top
    rail, the closing fence in the pane, and a rim below;
  - Rails: both fences on rails, so the pane holds only code.

  Superseded on 2026-10-31: a code block is a raised pad (Keypad). The user chose Bezel
  because it "gets out of the way but still looks close to the aesthetic we're going for".
  A fenced block is framed as a table is, without the rail: a raised bezel of the window's
  body material, an even 0.25rem on all four sides, round a pane sunk into it on the
  table's floor. Every line sits in the pane, both fences included, so a block is only the
  bezel's 0.5rem taller than before. The copy and wrap tray floats over the end of the
  first line, inside the pane. The preview frames its code the same way and shows no
  language. This replaces the recessed panel that code blocks took on 2026-10-29. The
  build differs from the mockup in two places:
  - The pane keeps the old panel's padding: 0.5rem above the opening fence (the mockup's
    was 0.375rem) and 0.1rem below the closing one (the mockup's was 0.3rem).
  - The bezel's lit top edge stops where its corners start to curve. It is drawn across
    the bezel, because `--float-rim` would light the pane's top edge instead.
- **Framed-row bands:** a hovered or cursor row in a table card or a code card bands
  inside its pane alone. The gutter keeps its resting fill, and no band paints across the
  card's margin or its bezel. The line number and the hover "+" mark a hovered row, and
  the 3px bar marks a cursor row. The user approved this from screenshots. It was chosen
  over keeping a band on the number cell, which still read as two pieces and showed as a
  smudge in dark. A drag's amber keeps its gutter half and its strip, so a selected range
  reads as one band. The preview's bands stay full-bleed.
- **Caps:** superseded on 2026-10-31 by Keypad's keys. Domed and seamless in their wells.
  A cap draws no line round its face, so its edge is where its shading meets the well. A
  soft lift lights its top, its shading rolls off toward its sides and foot, and a soft,
  low shadow settles it onto the well's floor. This replaced a 1px dark ring round the
  face, a crisp lit line along its top, and, on a tinted cap in dark, a ring of well floor
  inside its edge. The user said the ring "just looks like a border" rather than a tactile
  button. They asked for caps "kinda 'seamless' in their wells", "slightly domed, slightly
  convex", that "end at those borders" rather than "sharply turning into the UI at the
  edges". Chosen over two other builds:
  - the dome alone, with no shadow, which floated off the well's floor in light;
  - the dome and the shadow plus a faint lit edge on the well's floor above the cap, which
    drew a pale line round the cap's top in light and did not show in dark.

  The lift stays within the face's top few pixels. A lift reaching the label fell under
  the 4.5:1 text floor: caret light's amber label measured 4.36:1 at the tops of its
  letters, and Catppuccin Macchiato's neutral label 4.47:1.
- **Keycaps:** superseded on 2026-10-31 by Keypad's rubber nubs. Tiny laptop keys. A key
  is a flat face with small, even corners, square for one glyph and wider for a chord at
  the same height. It stands slightly raised above its cap: a darker skirt shows at its
  foot and a soft contact shadow sits under it, with no outline. Its face stays a
  translucent tint of its container's text colour, so no glyph loses contrast. This
  replaced a tiny dome borrowed from the caps, which read as a soft lozenge printed on the
  cap. The user wished the keys "looked a little closer to tiny keycaps on a macbook".
  Chosen over two other builds:
  - the face and the skirt without the shadow, which read less raised;
  - the face, the skirt and the shadow plus a faint lit top edge, which drew a bright line
    along the top of the amber Approve key in light, as a cap's lit edge did.

  Flex-centred, a capital sits about 1.5px high in the key, and the square face makes that
  plain. The key's top padding drops the glyph to the face's middle.
- **Plan pane:** superseded on 2026-10-31 by Keypad's screen recess. Sunk a step deeper
  into the window's body. Its inset shade (`--pane-recess`) reaches about twice as far
  below the pane's top edge, to about 7px, and softens as it goes. A faint shade rims all
  four sides, and the body's lit edge below the pane (`--pane-lip`) is brighter. The 1px
  edge where the pane meets the body keeps its strength. The plan's first line starts
  about 22px down, clear of the shade. The user asked for the frame around the plan to
  look "just a tiny bit more 'sunken'". Chosen over a smaller step, which left caret
  dark's pane looking unchanged: its near-black paper leaves the shade almost no room to
  darken.

## 2026-10-29: tactile refresh

Chosen through side-by-side previews.

- **Material:** "Rubber remote", chosen over a hairline-bordered flat step and over deep
  keys with a visible side below the face. Controls sit in 3px wells. Caps are domed, lit
  along the top and shaded toward the edges inside their own box, and sink 1px into the
  well when pressed. Grain shows on button faces. Modals float on a deep layered shadow.
  Plan chips split by what they do: passive ones are pressed into the line, clickable ones
  stand 1px above it. Fenced code blocks and tables are recessed panels, in the preview
  and the source view alike. One geometry serves every palette, with alphas keyed per
  scheme over palette tokens, and no palette file changes.
- **Submit rows:** smaller than the rest of the kit, with 28px caps and `--text-base`
  labels where the other caps are 32px. The preview's submit caps were 30px and still took
  up too much space, so the rows shipped two pixels smaller. A submit tray is marked
  `.tray-submit` where it is used rather than inferred from its cap, so Enable
  notifications, an amber cap that submits nothing, keeps the full size. Reject anyway
  wears the danger cap. A bright face on dark paper reads larger than the same box on
  light, so dark draws the amber cap's edge darker and its top highlight softer.
- **Key presses:** a shortcut plays the press of the control it names for 110 ms, the same
  press a click plays, and runs at once. Holding the action until the press had shown
  would keep a modal's dimmed backdrop off the press, but then keys typed straight after a
  shortcut, such as `b` then `/`, would land before the surface it opens. So a modal holds
  its entrance instead: while a press echoes, the overlay and the content start 110 ms
  late, and focus and typed keys land as they did.
- **Request changes rows:** an inline comment row has no rail and takes a 1px `--rule`
  ring. Unsent rows in this dialog and the Approve guard: see 2026-10-30.
- **Toggles:** a toggle that is on stays latched down in its well.
- **Key hints:** caret's own `[data-slot="kbd"]` keycap, unchanged. A keycap rides along
  with its control.
- **Comment cards:** no accent rail. A saved comment sits on the composer's sheet and
  carries its state as a stamp in its header: a glyph and a word in the state's own hue.
  Draft is `--attention`, Requested `--danger`, Accepted `--ok`, and Expired has no ink.
  Every word and glyph clears 4.5:1 on its stamp in every bundled palette. Both schemes
  keep the preview's 24% tint on the stamp, so dark and light stamps read alike, and the
  contrast comes from a deeper ink than the preview's. Chosen over a tinted header band
  and over sinking settled cards into the page. Draft used to take the amber accent. It
  now takes `--attention`, and the accent stays for the wordmark, the primary action,
  focus and the cursor.

## 2026-10-23: code caught up

The open items from the direction entry below, closed the same day. The calls made along
the way:

- **`caret-light` contrast:** darkened `inkFaint` and `accentBright` until both clear
  4.5:1 on every surface. The bright accent is now the hover step *away* from the paper,
  darker than `accent` in light and lighter in dark, so link hovers, comment-editor code,
  and the primary action's label on hover all pass. `theme.test.ts` holds caret's two
  palettes to that floor.
- **Motion:** one duration, `--dur-state`, replaced the 120 / 220 / 140 ms ladder, and
  `--ease-in` and the spring went with it. The closed-state arms that only re-timed an
  exit were deleted. The cursor's follow scroll moved to `--dur-state` with the cursor
  band it lands beside; the plan's jump keeps `--dur-travel`.
- **Key hints:** hidden on touch devices with `(hover: none) and (pointer: coarse)`,
  whatever the setting says.
- **Colour gate:** one check, `wantsColor` in `src/lib/color.ts`, shared by `caret doctor`
  and `caret install`, which both gained `--no-color`.

## 2026-10-23: direction set

Chosen through side-by-side previews.

- **Adopted the house direction,** most of which caret already carried: Geist and Berkeley
  Mono; a warm near-black and warm light palette with a vivid accent used verbatim;
  keyboard first with vim keys and key hints on controls; sound on by default; a light and
  a dark theme following the system; quiet roles for selection and focus.
- **Motion:** every state transition takes 160 ms on `cubic-bezier(0.22, 1, 0.36, 1)`,
  replacing the 120 / 220 / 140 ms ladder and the spring slide. Chosen over 240, 190, and
  180 ms, and over a plain ease-out and a sharper stop for the curve.
- **Radii:** kept caret's 10 / 6 / pill over 12 / 6 / 3. See
  [`exceptions.md`](exceptions.md#radii).
- **Waiting screen:** kept caret's centred `^` screen over one plain sentence and over a
  blinking-cursor line. See [`exceptions.md`](exceptions.md#the-waiting-screen).
- **`caret doctor`:** failures first in a rounded block with the fix command for each, the
  remaining lines restyled rather than dropped, and a final next step. Chosen over the
  current in-order layout.
