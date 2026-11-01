# Decisions

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

Open items first, then the log, newest first.

## Open: where the code still differs

- **`--ink-faint` on raised surfaces:** falls under the 4.5:1 text contrast floor in
  several bundled third-party palettes. On `--paper-raised` it measures 4.45 in Catppuccin
  Mocha, 3.49 in Catppuccin Latte, 3.26 in GitHub dark, 3.45 in GitHub light and 3.59 in
  Dracula; in Dracula the Contents peek's small text is 3.99 and its match count 4.46.
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
  remain: the Contents row being read takes `--neutral-face-latched`, and a switch that is
  on takes `--switch-on`. Both are amber tints on a state. They follow the version compare
  toggle, whose face latches onto `--neutral-face-latched` while it compares. They break
  the accent rule in
  [`patterns.md` § Surfaces and emphasis](patterns.md#surfaces-and-emphasis) twice: they
  mix the accent rather than using it verbatim, and they fall outside its list of uses. In
  Settings, the switch's tint is also a second amber emphasis beside the primary action. A
  latched key's corner light is the accent itself, also outside that list.
- **Amber and danger labels in some third-party palettes:** the label on the amber key's
  hover face (`--accent-ink` on `--accent-bright`) measures 2.78:1 in Catppuccin Latte and
  3.97:1 in Dawnfox. The label on Reject's danger face (`--paper` on `--danger`) measures
  3.26:1 in Dawnfox, 4.39:1 in Dracula and 4.41:1 in Catppuccin Latte. Both pairs are the
  palettes' own tokens, and the key's shading leaves the face behind the letters at that
  colour. They stay open until a fix changes those palettes' colours or the way the kit
  picks a label for a bright face. `theme.test.ts` holds only caret's two palettes to
  these pairs.
- **Search-only flat disabled cap:** the amber text cursor now covers every field, but the
  flat disabled cap is still local to the search sheet. The sheet's disabled step lies
  flat on the well's floor with no side, where every other disabled cap keeps its face and
  a 1px side.
- **Hue-only marks under 3:1 in some light palettes:** `--ok` and `--attention` as LED and
  bell colours measure 2.96:1 (`--ok`, Catppuccin Latte, settings panel), 2.05:1
  (`--attention`, Dawnfox, settings panel) and 2.32:1 (`--ok`, Latte, code panel). Each
  sits beside words that carry the state, so it is never the only signal. The status bar's
  LED uses the same tokens.
- **Focus under `GLANCE`:** keyboard focus shows only as a control's hover face. Steps
  here are CIE76 colour differences (ΔE), where about 2.3 is just noticeable. In dark a
  hover face steps as far as the palette's `--ink` keeps 4.5:1 on it. In light it steps
  only as far as the 3.5 ΔE floor needs. So no palette's neutral key clears
  `theme.test.ts`'s `GLANCE` (20 ΔE). The weakest dark steps are in Catppuccin Frappé: 3.8
  for a crumb on the bar, 5.7 for the cursor on the Contents row being read, 8.1 for a
  menu row and 8.2 for a neutral key. The weakest light step is the cursor on a chosen row
  in Catppuccin Latte, 3.9. `theme.test.ts` holds every hover step to 3.5 in every
  palette.
- **Calls left to the user from the 2026-10-31 pass:** the one left was built and is
  waiting on the user's verdict.
  - `--ink-faint` line numbers in the file preview's gutter, 3.10:1 on Dawnfox's paper.

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
