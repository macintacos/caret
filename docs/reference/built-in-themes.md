# Built-in themes

*Audience: anyone choosing a caret theme, or reusing a built-in one as a starting point.*

caret ships these themes. Pick one per scheme in **Settings → Appearance**. No theme file
may reuse their ids; caret skips a file that does (see
[Where caret finds theme files](theme-files.md#where-caret-finds-theme-files)). Their
files, in
[ui/src/lib/themes/](https://github.com/macintacos/caret/tree/main/ui/src/lib/themes), are
a starting point for
[your own theme](../how-to/make-a-theme.md#start-from-a-built-in-theme).

## The themes

| Theme | `id` | Scheme |
| --- | --- | --- |
| caret dark | `caret-dark` | dark |
| caret light | `caret-light` | light |
| Catppuccin Latte | `catppuccin-latte` | light |
| Catppuccin Frappé | `catppuccin-frappe` | dark |
| Catppuccin Macchiato | `catppuccin-macchiato` | dark |
| Catppuccin Mocha | `catppuccin-mocha` | dark |
| Dracula | `dracula` | dark |
| GitHub Light | `github-light` | light |
| GitHub Dark | `github-dark` | dark |
| Dawnfox | `dawnfox` | light |
| Duskfox | `duskfox` | dark |

## How each theme maps its colors

Each vendor theme follows its original's published colors. These are the choices its
file's colors don't explain on their own.

### caret dark and caret light

caret's own themes use earth pigments: nothing is at full chroma, and nothing is violet,
so keywords are red ochre. The skill chip uses the color of types in code, because no
other status color differs enough from `ok` to tell it apart from the file-reference chip.
Types and functions, numbers and escapes, and attributes and properties are each held at
least 130° apart in hue (measured in OKLCH), in both schemes. The eight colored code roles
sit in one narrow, high-chroma band.

### Catppuccin

Catppuccin follows its own editor convention: page chrome on `mantle`, code on `base`, and
panels on `surface0`. Latte has nothing lighter than `base`, so its panels and code
surface each move down a step, while the page chrome stays on `mantle`. Secondary text and
metadata (`inkSoft`, `inkFaint`) use the deeper `subtext1` and `overlay2`, so they stay
readable on raised surfaces. Latte's low-contrast `green` and `lavender` stay as
published, because reading Latte's own colors is the point of picking it.

### Dracula

Dracula publishes only two text colors, so caret mixes `inkSoft` and `inkFaint` between
its Foreground and Comment colors.

### GitHub

The GitHub themes use GitHub's own interface colors (Primer's functional tokens)
throughout: the page on GitHub's canvas color (Primer's `bgColor.muted` in light,
`bgColor.default` in dark), cards on the brightest surface, and code on the recessed one.
GitHub Light's `accentBright` is the deeper blue from GitHub's code palette
(prettylights), `#0550ae`, not a lighter one, because it colors inline code and code
blocks on a white surface.

### Dawnfox and Duskfox

These come from the Nightfox family. In Dawnfox, `sunk` uses the `bg2` color, because
`bg1` has to be `raised`. Dawnfox's body text uses `fg0`, because `fg1` drops below 4.5:1
contrast once quoted text fades it. Dawnfox's `inkFaint` is mixed from `fg2` toward the
comment color, and its `accent` is blue, because no neutral text reads on magenta. Neither
theme colors the file-reference chip green, because Nightfox's greens are too muted.
