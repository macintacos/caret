# Decisions

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

Open items first, then the log, newest first.

## Open: where the code still differs

Nothing open.

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
  up too much space, so the rows shipped two pixels smaller. A bright face on dark paper
  reads larger than the same box on light, so dark draws the amber cap's edge darker and
  its top highlight softer.
- **Key presses:** a shortcut plays the press of the control it names for 110 ms, the same
  press a click plays, and runs at once. Holding the action until the press had shown
  would keep a modal's dimmed backdrop off the press, but then keys typed straight after a
  shortcut, such as `b` then `/`, would land before the surface it opens.
- **Toggles:** a toggle that is on stays latched down in its well.
- **Key hints:** caret's own `[data-slot="kbd"]` keycap, unchanged. A keycap rides along
  with its control.
- **Comment cards:** no accent rail. A saved comment sits on the composer's sheet and
  carries its state as a stamp in its header: a glyph and a word in the state's own hue.
  Draft is `--attention`, Requested `--danger`, Accepted `--ok`, and Expired has no ink.
  Every word and glyph clears 4.5:1 on its stamp in every bundled palette, which took a
  deeper ink than the preview's. Chosen over a tinted header band and over sinking settled
  cards into the page. Draft used to take the amber accent. It now takes `--attention`,
  and the accent stays for the wordmark, the primary action, focus and the cursor.

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
