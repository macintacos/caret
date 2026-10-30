# Patterns

*Audience: contributors and coding agents changing how caret looks, moves, sounds, or
prints.*

How caret builds things. Values live where [`tokens.md`](tokens.md) says; the rules for
specific code areas live in [`doc/agents/`](../doc/agents/).

## Review UI

### Surfaces and emphasis

- Anything that can be pressed stands as a rubber cap, and anything that can't is stamped
  into the surface. The kit lives in `ui/src/styles/atoms.css`.
- Floating surfaces are smooth, never grained, and lit along their top edge: `--float-mid`
  under menus, popovers, toasts and the composer, `--float-high` under modals, and
  `--float-low` under a saved comment. Each adds a `--rule` ring at the use site.
  `--shadow-chip` stays under small hints and overlays, such as the search box.
- One emphasis per view. The amber accent is used verbatim, never lightened, and only for
  the wordmark, the primary action, focus, and the cursor. Everything else steps down
  through `--ink-soft` and `--ink-faint`.
- Page structure is left-aligned.
- Compose from shadcn-svelte first ([`shadcn-rules.md`](../doc/agents/shadcn-rules.md));
  icons are vendored ([`icon-rules.md`](../doc/agents/icon-rules.md)).

### The tactile kit

- **Wells.** A control sits in a `.tray`, a 3px well cut into the surface. A group of
  controls shares one tray, and a lone control gets its own. A tray adds `--well-pad`
  around its controls, so a bar holding trays trims its own padding by the same amount to
  keep its height.
- **Caps.** Every neutral control wears `.float-chip`, and the amber primary wears
  `.cap-accent`, which the vendored Button's default variant applies. A destructive
  confirm wears `.cap-danger`. A component tunes a cap through the custom properties the
  cap rule in `atoms.css` declares (its face, label, rim, dome and pressed colours), never
  with a `background` shorthand, which drops the grain.
- **Press.** A cap sinks into its well in place: its face draws in 1px, and its shading
  flips, dark at the top where it was lit. Nothing translates. A ghost control
  (`.cap-ghost`) has no cap, so a press leaves a shallow inset shadow instead. A toggle
  that is on (`aria-pressed`) stays pressed down.
- **Submit rows.** A tray holding the amber or danger cap is smaller than the rest of the
  kit: 28px caps with `--text-base` labels, where the other caps are 32px. Every cap in
  that tray shrinks with it.
- **Stamps.** Passive labels (`.stamp`, counts, the comment states) take a well's floor
  and shade with no cap. Text fields (`.field-well`) take a shallower cut.
- **Keycaps.** Key hints stay caret's own `[data-slot="kbd"]` keycap and ride along with
  their control. They get no rubber, well or press of their own.
- **Saved comments.** A comment card has no rail. Its state is a stamp in its header, a
  glyph and a word in the state's own hue, at strengths `theme.test.ts` holds to 4.5:1 on
  every palette.
- **Schemes.** A value that differs between light and dark keys on the `data-theme`
  attribute `paintTheme()` sets, never on `light-dark()`. Lightning CSS, which builds
  caret's stylesheets, rewrites a `light-dark()` into variables that never see the inline
  `color-scheme` set by `paintTheme()`, so it always resolves to the dark value.
- Off the table: glass, heavy gradients, and glows.

### Type and shape

- Geist for UI text and prose; Berkeley Mono for code, the `^` carets, paths, line
  references, and the version tag.
- Every font size comes from the `--text-*` ramp. A raw `font-size` fails the type-scale
  contract test; a genuine display one-off stays literal with a comment saying why.
- Radii follow size: 10px panels (`--radius-lg`), 6px controls (`--radius`), pill badges
  and meters.

### Motion

- Every state transition takes 160 ms on the strong ease-out
  `cubic-bezier(0.22, 1, 0.36, 1)` (`--dur-state`, `--ease-out`): hover and focus tints,
  surfaces entering and leaving, and controls sliding between positions. The curve covers
  most of the distance at once, then brakes hard.
- Ambient loops (the empty screen's floating `^`, the reference-hint ping, the safe-mode
  pulse) and the plan's scroll travel are not state transitions and keep their own timing.
- Motion is CSS only. A Svelte JS transition throws under happy-dom and ignores reduced
  motion; `ui/src/lib/motion.test.ts` enforces this.
- Reduced motion stops every animation. Where a timer swaps content (the carrot fact), the
  timer stops too.

### Plan surface

- Hover and drag highlights in the preview cover full visual lines, never part of a line.
- Passive chips (bold, italic, code) are pressed into the line with `--chip-stamped`, and
  clickable ones (links, file references) stand 1px above it with `--chip-raised`. Fenced
  code blocks and tables are recessed with `--panel-recess`. The preview and the source
  view share these values, and `coreStyles.test.ts` pins the preview's copies to the
  source view's.
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
  `aria-keyshortcuts` for `PRESS_HOLD_MS` (`ui/src/lib/shortcuts/dispatcher.ts`).

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
  [`exceptions.md`](exceptions.md). Any other empty view is one plain sentence.
- **Loading:** no indicator under about 1s. From about 2s, a labelled spinner, and the
  data animates in gently when it lands. Past about 10s or for many items, a count or
  percentage.
- **Errors:** shown beside what caused them, naming the problem and the fix. App-level
  notices go through `AlertHost.svelte`.

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
