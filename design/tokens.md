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
| Accent | `--accent`; `--accent-bright` for link and text hovers, `--accent-ink` for text on the accent, `--accent-wash` for tints |
| Destructive | `--danger` |
| Status | `--ok`, `--danger`, and `--attention` for novelty (new, unread) |
| Highlight bands | `--mark`, `--mark-orphan`; the search's `--mark-match` and `--mark-active`, and their text, `--mark-match-ink` and `--mark-active-ink` |
| Inline chips in the plan | `--chip-bold`, `--chip-italic`, `--chip-code`, `--chip-link`, `--chip-ref`, `--chip-skill` |
| Syntax and markdown colours | the `syntax` and `markdown` blocks of each theme file |

The derived tier, colours a palette implies rather than sets (`--chip`, `--chip-hover`,
`--ink-wash`, `--attention-wash`, `--code-panel`, the window's `--body`, a table's
`--table-floor`, `--table-floor-rule` and `--table-head-ink`, a raised pad's lit band
`--pad-top` and side `--pad-side`, and the tactile kit's `--well-floor`, `--field-floor`,
`--group-floor` (the settings beds and nav, the modal footer shelf, and a dialog's
read-only cuts), `--field-edge-focus` (a focused field's lit wall, `--ink-faint`), the
`--neutral-face` steps (with `--neutral-face-press`, the face a press takes, and
`--neutral-face-latched-hover`, the face the cursor gives a latched one), a crumb's risen
face `--crumb-face-hover`, the key row's `--key-row-up`, `--key-row-up-image`,
`--key-row-down` and `--key-row-down-image`, the danger key's face `--danger-face`, the
accent and danger keys' hover and press faces `--accent-face-hover`,
`--accent-face-press`, `--danger-face-hover` and `--danger-face-press`, the switch's
`--knob-face`, `--knob-face-hover`, `--knob-face-down`, `--knob-edge` and `--switch-on`,
the meter's `--meter-off`, and the `--float-surface-low`, `-mid` and `-high` composites),
is mixed in `ui/src/styles/derived.css`. In light, the top bar, the outline column and the
status bar re-cut `--well-floor` from `--body`, so a stamp's or a count chip's pocket
stays visible on it. The outline's quieter text takes `--toc-quiet`, local to
`ui/src/components/PlanToc.svelte`: `--ink-soft` on the float's raised paper, stepped
toward `--ink` on the body, where `--ink-soft` falls under 4.5:1 in some palettes. Focus
has no token of its own, since it wears each control's hover faces. shadcn-svelte's token
names map onto these roles in `ui/src/styles/shadcn-bridge.css`.

## Type, motion, radius, depth

All in `ui/src/styles/tokens.css`:

- **Faces:** `--font-sans` and `--font-display` (Geist), `--font-mono` (Berkeley Mono). No
  font files ship; each stack falls back to the platform.
- **Size:** the `--text-2xs` … `--text-xl` ramp, and the role-keyed `--leading-*` tokens.
  The reading base is the 15px on `<body>` in `ui/src/styles/base.css`.
- **Motion:** `--dur-pane` for a pane or column entering, `--dur-state` and `--ease-out`
  for every other state transition, `--ease-spring` for a key's return from a press,
  `--dur-travel` for the plan's scroll. `ui/src/lib/motion.test.ts` pins the set.
- **Radius:** `--radius` for fields and menu rows, `--radius-lg` for panels, `99px` for
  badges. The keypad has its own: `--key-radius` for keys, `--nub-radius` for keycaps and
  the switch's key, `--pad-radius` for a table's or a code block's pad, and
  `--pane-radius` for the plan pane. `--modal-radius` (14px) rounds every modal: the
  `--radius` of Settings' search field plus the 0.5rem padding round it. Settings widens
  its corner below 640px wide. `--composer-radius` rounds the comment composer: its tray's
  corner plus `--composer-inset`, its padding.
- **Depth:** the tactile geometry is hand-written here, its alphas keyed per scheme:
  - the beds: `--well-pad` (the gap round a key), `--well-top` and `--well-foot` (the pads
    above and below a key, which take its rise and side), `--tray-gap`, and `--bed-shade`;
    a stamp's pocket: `--well-shade` and `--well-lip`;
  - the keys: `--key-side` (the depth of a key's rubber side, which its rise, press and
    cast shadow scale from), `--key-rise` (how far a resting key stands above its place)
    and `--key-sink` (how far below it a press takes the key), the last two 0 under
    reduced motion. `--pad-stand`, `--chip-raised` and `--float-low` scale from it too;
    the `--rubber-*` set that lights and shades a neutral key (`--rubber-lift`,
    `--rubber-foot`, `--rubber-side`, `--rubber-gloss`, `--rubber-cast-near`,
    `--rubber-cast`, `--rubber-press`); the `--tinted-*` set for an amber or danger key
    (`--tinted-lift`, `--tinted-foot`, `--tinted-side`); `--press-shade` and
    `--press-blur` for a ghost control's press; `--grain`; and the submit tray's
    `--cap-submit-h`;
  - the keycaps: `--nub-side` for a keycap's side and `--nub-cast` for its shadow;
  - the window: `--chrome-light`, the faint light over the chrome; the plan pane's
    `--pane-recess`, `--pane-lip` and `--pane-shade`;
  - the pads: `--pad-stand` for a table's or a code block's side and cast shadow, the
    scoop's `--scoop-top` (the shade under its top edge), `--scoop-foot` (its lit lip),
    and their colours `--scoop-shade` and `--scoop-lip`, which the preview's gradients
    spend too; a code block's `--code-bezel` (its pad's rim, which the copy and wrap tray
    steps in by); and the pressed-in label shadow `--label-pressed`;
  - the sockets (`--socket-shade`, `--count-shade`), the comment stamp's `--stamp-*`
    strengths, `--unsent-floor` (the share of `--attention` in an unsent comment's well,
    16% dark and 8% light), and `--unsent-shade` (the unsent row's bed shade: in dark, a
    weaker shade with no lip; in light, `--bed-shade`);
  - the floats (`--float-rim`, `--float-rim-ink`, `--float-low`, `--float-mid`,
    `--float-high`) and `--shadow-chip` for small hints;
  - the plan's `--chip-stamped` and `--chip-raised`, `--panel-recess` for text fields and
    copy boxes, and `--field-wall`, the wall of a focused field's cut that
    `--field-edge-focus` lights: the lower in dark, the upper in light.

  `--checkbox-size`, a task box's side, lives in the `:host` of
  `ui/src/lib/diffview/coreStyles.ts`.

  `--shadow-card` still comes from the palette.
- **Layout:** `--pane-gap` (6px), the inset around the plan pane, and `--status-bar-h`
  (2.25rem), the status bar's height, are in `ui/src/styles/layout.css`. The outline
  column's opening, narrowest and widest widths are `OUTLINE_REM` in
  `ui/src/lib/outlineColumn.ts`. The plan's reading width is `MIN_READING_PX` in
  `ui/src/lib/fileDrawer.ts`. The column stops widening, and yields to a file, to keep it.

## Terminal

Terminal output has no tokens. It uses the terminal's own ANSI colour slots, so the user's
terminal theme supplies every colour.
