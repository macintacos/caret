# Tokens

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

Where each design value lives. Change values there, never here.

## Colour

Every palette is a theme file under `ui/src/lib/themes/<id>.json`; `caret-dark` and
`caret-light` are caret's own, and the rest are bundled third-party palettes.
`ui/src/lib/theme.ts` loads them into `THEMES`, and `paintTheme()` writes the active one
onto `:root` as custom properties. `ui/src/lib/appearance.ts` decides which palette is
live. `ui/src/styles/palette.generated.css` is the generated pre-JS fallback; never edit
it. User theme files follow
[`doc/CONFIGURING.md` § Theme files](../doc/CONFIGURING.md#theme-files).

| Role | Tokens |
| --- | --- |
| Canvas | `--paper`, with `--paper-raised` and `--paper-sunk` for surfaces above and below it |
| Text | `--ink` |
| Secondary text | `--ink-soft`, then `--ink-faint` |
| Separator | `--rule`, `--rule-strong` |
| Accent | `--accent`; `--accent-bright` for hovers, `--accent-ink` for text on the accent, `--accent-wash` for tints |
| Destructive | `--danger` |
| Status | `--ok`, `--danger`, and `--attention` for novelty (new, unread) |
| Highlight bands | `--mark`, `--mark-active`, `--mark-orphan` |
| Inline chips in the plan | `--chip-bold`, `--chip-italic`, `--chip-code`, `--chip-link`, `--chip-ref`, `--chip-skill` |
| Syntax and markdown colours | the `syntax` and `markdown` blocks of each theme file |

The derived tier, colours a palette implies rather than sets (`--chip`, `--chip-hover`,
`--ink-wash`, `--attention-wash`, `--code-panel`, the window's `--body`, a table's
`--table-floor`, `--table-floor-rule` and `--table-head-ink`, and the tactile kit's
`--well-floor`, `--field-floor`, `--group-floor`, `--neutral-face` steps,
`--danger-face-hover`, the switch's `--knob-face`, `--knob-face-hover`,
`--knob-face-down`, `--knob-edge` and `--switch-on`, the meter's `--meter-off`, and the
`--float-surface-low`, `-mid` and `-high` composites), is mixed in
`ui/src/styles/derived.css`. In light, the top bar, control row and status bar re-cut
`--well-floor` from `--body`, so their wells stay visible on it. shadcn-svelte's token
names map onto these roles in `ui/src/styles/shadcn-bridge.css`.

## Type, motion, radius, depth

All in `ui/src/styles/tokens.css`:

- **Faces:** `--font-sans` and `--font-display` (Geist), `--font-mono` (Berkeley Mono). No
  font files ship; each stack falls back to the platform.
- **Size:** the `--text-2xs` … `--text-xl` ramp, and the role-keyed `--leading-*` tokens.
  The reading base is the 15px on `<body>` in `ui/src/styles/base.css`.
- **Motion:** `--dur-state` and `--ease-out` for every state transition, `--dur-travel`
  for the plan's scroll. `ui/src/lib/motion.test.ts` pins the set.
- **Radius:** `--radius` for controls, `--radius-lg` for panels, `99px` for badges.
- **Depth:** the tactile geometry is hand-written here, its alphas keyed per scheme: the
  wells (`--well-pad`, `--well-pad-tight`, `--well-shade`, `--well-lip`), the caps
  (`--rim-*`, `--dome-*`, the `--press-*` set, the `--tinted-*` set that lights an amber
  or danger face, `--grain`), the sockets (`--socket-shade`, `--socket-ring`,
  `--count-shade`), the floats (`--float-rim`, `--float-low`, `--float-mid`,
  `--float-high`) and `--shadow-chip` for small hints, `--float-rim-ink` (the colour of
  `--float-rim`'s lit edge, for a float that draws it as a border, such as the plan's code
  card), the submit tray's `--cap-submit-h`, the comment stamp's `--stamp-*` strengths,
  `--unsent-floor` (the share of `--attention` in an unsent comment's well, 16% dark and
  8% light), the switch knob's `--knob-hi` and `--knob-lo`, the plan pane's
  `--pane-recess`, `--pane-lip` and `--pane-shade`, a table's pane (`--table-pane-edge`
  for its crisp 1px edges, `--table-pane-sink` for the shade under the rail plus the
  pane's top edge, and `--table-pane-sink-shade` for that shade's colour, which the
  preview's gradient spends too), a code block's `--code-bezel` (the bezel's width, which
  the copy and wrap tray steps in by), the pressed-in label shadow `--label-pressed`, the
  plan's `--chip-stamped` and `--chip-raised`, and `--panel-recess` for the recessed
  groups in Settings and the Contents peek. `--shadow-card` still comes from the palette.
- **Layout:** `--pane-gap` (6px), the inset around the plan pane, and `--status-bar-h`
  (2rem), the status bar's height, are in `ui/src/styles/layout.css`.

## Terminal

Terminal output has no tokens. It uses the terminal's own ANSI colour slots, so the user's
terminal theme supplies every colour.
