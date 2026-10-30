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
`--paper-veil`, `--ink-wash`, `--attention-wash`, `--code-panel`, and the tactile kit's
`--well-floor`, `--field-floor` and `--cap-face` steps), is mixed in
`ui/src/styles/derived.css`. shadcn-svelte's token names map onto these roles in
`ui/src/styles/shadcn-bridge.css`.

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
  wells (`--well-pad`, `--well-shade`, `--well-lip`), the caps (`--rim-*`, `--dome-*`,
  `--sunk*`, the `--accent-*` set, `--grain`), the floats (`--float-rim`, `--float-low`,
  `--float-mid`, `--float-high`) and `--shadow-chip` for small hints, and the plan's
  `--chip-stamped`, `--chip-raised` and `--panel-recess`. `--shadow-card` still comes from
  the palette.

## Terminal

Terminal output has no tokens. It uses the terminal's own ANSI colour slots, so the user's
terminal theme supplies every colour.
