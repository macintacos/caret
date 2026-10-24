# Decisions

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

Open items first, then the log, newest first.

## Open: where the code still differs

- **Motion tokens.** `ui/src/styles/tokens.css` still uses the 120 / 220 / 140 ms ladder,
  a separate ease-in for exits, and a spring on the segmented control, and
  `ui/src/lib/motion.test.ts` pins that ladder. Move them to the single 160 ms strong
  ease-out from the 2026-10-23 entry.
- **`caret doctor` layout.** `renderStdout` in `src/doctor/report.ts` still prints checks
  in order with a `remedy:` line under each failure. Move it to the report layout in
  [`patterns.md`](patterns.md#reports-caret-doctor).
- **Floor: `caret-light` faint text.** `--ink-faint` (`inkFaint` in
  `ui/src/lib/themes/caret-light.json`) reaches 4.10:1 on `--paper`, below the 4.5:1 text
  floor, and is the colour of 63 text rules. `caret-dark` passes at 5.54:1.
- **Floor: `caret-light` bright accent as text.** `--accent-bright` reaches 3.28:1 on
  `--paper` and colours text in `SourceAnnotationCard.svelte`, `WhatsNewDialog.svelte`,
  `PlanPreview.svelte`, and `ui/src/lib/markdownEditor.ts`. An accent that fails the text
  floor stays off text and is never lightened to pass.
- **Terminal colour gate.** `src/commands/doctor.ts` and `src/commands/install/ui.ts` turn
  colour off for a non-TTY stdout, `NO_COLOR`, or `CI=true`. They don't yet check stderr
  separately, `TERM=dumb`, or `--no-color`.
- **Key hints on touch devices.** The on-control key hints show on touch devices too; they
  should show on desktop only.

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
