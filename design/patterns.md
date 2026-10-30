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
  `--float-low` under a saved comment. A float's ring follows its height: low and mid
  floats take a `--rule` ring and modals a `--rule-strong` one. A surface wears the
  composite for its height, `--float-surface-low`, `-mid` or `-high` in
  `ui/src/styles/derived.css`, which carries the rim, the ring and the shadow, so a call
  site never picks a ring. `--shadow-chip` stays under small hints and overlays, such as
  the search box.
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
  keep its height. Every cap rounds at `--radius`, whatever its Button `size`. A tray
  rounds at `--radius` plus its pad, so the two corners stay concentric. A well with a
  different pad, such as `--well-pad-tight`, rounds at `--radius` plus that pad.
- **Caps.** `.float-chip` is the neutral cap, and every neutral control wears it. The
  amber primary wears `.cap-accent`, which the vendored Button's default variant applies.
  A destructive confirm, such as Reject anyway, wears `.cap-danger`; the top bar's Reject
  stays neutral and takes the danger face on hover (`.cap-danger-hover`). One cap rule in
  `atoms.css` paints the face for every cap, the on segment of a toggle group and the
  `.seg-pill`. A component tunes a cap through that rule's `--cap-*` properties
  (`--cap-face`, `--cap-face-hover`, `--cap-face-down`, `--cap-label`,
  `--cap-label-hover`, `--cap-rim-side`, `--cap-rim-top`, `--cap-dome-hi`,
  `--cap-dome-lo`, `--cap-press-shade`, `--cap-press-ring` and `--cap-inset`), never with
  a `background` shorthand, which drops the grain.
- **Press.** A cap sinks into its well in place: its face draws in 1px, and its shading
  flips, dark at the top where it was lit. Nothing translates. A ghost control
  (`.cap-ghost`) has no cap, so a press leaves a shallow inset shadow instead. A toggle
  that is on (`aria-pressed`) stays pressed down.
- **Submit trays.** A tray that submits is marked `.tray-submit` at the call site, never
  inferred from the cap it holds. It is smaller than the rest of the kit: caps of
  `--cap-submit-h` (28px) with `--text-base` labels, where the other caps are 32px, and
  every cap in it shrinks with it. The submit trays are Approve in the top bar, Comment
  and Save in the composer, Send for revision, the guard confirms (Approve with comments,
  Reject anyway) and the confirm bubble's Discard. Enable notifications is not a submit
  and keeps the full size.
- **Stamps.** Passive labels (`.stamp`, counts, the comment states) take a well's floor
  and shade with no cap. Text fields (`.field-well`) take a shallower cut.
- **Keycaps.** Key hints stay caret's own `[data-slot="kbd"]` keycap and ride along with
  their control. They get no rubber, well or press of their own.
- **Saved comments.** A comment card has no rail. Its state is a stamp in its header, a
  glyph and a word in the state's own hue. The stamp's strengths are the `--stamp-floor`,
  `--stamp-word-toward` and `--stamp-word-mix` tokens in `ui/src/styles/tokens.css`, per
  scheme, and `theme.test.ts` reads them there and holds every word to 4.5:1 on its stamp
  in every palette.
- **Schemes.** In a stylesheet or a `.svelte` `<style>` block, a value that differs
  between light and dark keys on the `data-theme` attribute `paintTheme()` sets, never on
  `light-dark()`. Lightning CSS, which builds caret's stylesheets, rewrites a
  `light-dark()` into variables that never see the inline `color-scheme` set by
  `paintTheme()`, so it always resolves to the dark value. The diff library's shadow-DOM
  sheet (`ui/src/lib/diffview/coreStyles.ts`) is not built by Lightning CSS and keeps its
  `light-dark()`.
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
  clickable ones (links, file references, citations) stand 1px above it with
  `--chip-raised`, in both views. Fenced code blocks and tables are recessed with
  `--panel-recess`. The preview and the source view share these values, and
  `coreStyles.test.ts` pins the preview's copies to the source view's.
- A chip has one depth. It sits on the chip's outermost member; a nested member, such as
  bold inside a link, carries it on its `::after` through `--nest-depth`, so the members
  show no seam (`ui/src/lib/diffview/coreStyles.ts`).
- Only a link that is itself a chip sinks when pressed in the preview, along with
  reference and citation code. A link wrapping code, a file reference or an image does not
  (`ui/src/components/PlanPreview.svelte`).
- The recess is a contact edge, not a shadow: every outer layer of `--panel-recess` has no
  blur or spread and moves at most 1px, in both schemes, which `coreStyles.test.ts` pins.
  A code block that fits without scrolling draws its edges on its end rows: the first row
  carries the top edge and the `0 2px 3px` shade, the last the bottom edge and the 1px
  outer lip.
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
  `aria-keyshortcuts` for `PRESS_HOLD_MS`, 110 ms, a click's mousedown-to-mouseup
  (`ui/src/lib/shortcuts/pressEcho.ts`, which the dispatcher calls through its `onRun`
  hook). Pressing the key again restarts the hold.
- A key that opens a modal holds the modal's entrance, not the action. While a press
  echoes, the root carries `data-key-echo`, which delays the overlay's and the content's
  entrance by `PRESS_HOLD_MS`, so the cap's sink shows before the scrim. Focus and typed
  keys land at once, as they would without the hold.

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
