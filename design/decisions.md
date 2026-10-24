# Decisions

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

Open items first, then the log, newest first.

## Open: where the code still differs

Nothing open.

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
