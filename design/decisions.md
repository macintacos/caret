# Decisions

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

Open items first, then the log, newest first.

## Open: where the code still differs

- **`light-dark()` in the preview's hover band:** `.preview-hover` in
  `ui/src/components/DiffPlanView.svelte` still picks its band with `light-dark()`, so it
  can resolve to the dark value on light paper
  ([`patterns.md` § The tactile kit](patterns.md#the-tactile-kit), Schemes).
- **`--ink-faint` on raised surfaces:** falls under the 4.5:1 text contrast floor in
  several bundled third-party palettes. On `--paper-raised` it measures 4.45 in Catppuccin
  Mocha, 3.49 in Catppuccin Latte, 3.26 in GitHub dark, 3.45 in GitHub light and 3.59 in
  Dracula; in Dracula the Contents peek's small text is 3.99 and its match count 4.46.
  `theme.test.ts` holds only caret's two palettes to the floor. CommentNavigator's
  `.nav-hints` is unchecked.
- **Keycap hints on GitHub dark's body:** keycaps and breadcrumb chevrons keep
  `--ink-faint`, about 2.9:1 on GitHub dark's `--body`. The old raised bar gave about
  3.2:1, also under the floor.
- **`--pane-recess` has no contact-edge test:** `coreStyles.test.ts` pins `--panel-recess`
  to 1px outer layers with no blur or spread, and nothing pins `--pane-recess` the same
  way.
- **Amber on a latched state:** the Contents row being read takes
  `--neutral-face-latched`, and a switch that is on takes `--switch-on`. Both are amber
  tints on a state. They follow the version compare toggle, whose face latches onto
  `--neutral-face-latched` while it compares. They break the accent rule in
  [`patterns.md` § Surfaces and emphasis](patterns.md#surfaces-and-emphasis) twice: they
  mix the accent rather than using it verbatim, and they fall outside its list of uses. In
  Settings, the switch's tint is also a second amber emphasis beside the primary action.
- **Search-only choices that may go kit-wide:** the flat disabled cap and the amber text
  cursor (`caret-color: var(--accent)`) are local to the search sheet.
- **The search sheet's 12px foot:** its nested radius is a new radius on screen, beside
  the 10px panels.

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
- **Tables:** "Inlay", chosen over two other tactile builds:
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
  [`exceptions.md`](exceptions.md#radii-10--6--pill).
- **Waiting screen:** kept caret's centred `^` screen over one plain sentence and over a
  blinking-cursor line. See [`exceptions.md`](exceptions.md#the-waiting-screen).
- **`caret doctor`:** failures first in a rounded block with the fix command for each, the
  remaining lines restyled rather than dropped, and a final next step. Chosen over the
  current in-order layout.
