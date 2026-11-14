# Built-in themes

_Audience: anyone choosing a caret theme, or reusing a built-in one as a starting point._

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

Each theme follows its original's published colors. These are the choices its file's
colors don't explain on their own.

### caret dark and caret light

caret's own themes use earth pigments: no color is at full strength, and none is violet,
so keywords are red ochre. The skill chip uses the color of types in code, because no
other status color differs enough from `ok` to tell it apart from the file-reference chip.
Types and functions, numbers and escapes, and attributes and properties each get clearly
different hues, in both schemes. The eight colored code roles share one narrow band of
strong colors.

### Catppuccin

Catppuccin follows its own editor convention: page chrome on `mantle`, code on `base`, and
panels on `surface0`. Latte has nothing lighter than `base`, so it shifts each surface
down a step. Text uses the deeper `subtext1` and `overlay2`, so it stays readable on
raised surfaces. Latte's low-contrast `green` and `lavender` stay as published, because
reading Latte's own colors is the point of picking it.

### Dracula

Dracula publishes only two text colors, so caret mixes `inkSoft` and `inkFaint` between
its Foreground and Comment colors.

### GitHub

The GitHub themes use GitHub's own interface colors throughout: the page on GitHub's
canvas color, cards on the brightest surface, and code on the recessed one. GitHub Light's
`accentBright` is a deeper blue, `#0550ae`, not a lighter one, because it colors inline
code and code blocks on a white surface.

### Dawnfox and Duskfox

These come from the Nightfox family, with a few changes. `sunk` uses the bg2 color,
because bg1 has to be `raised`. Body text uses fg0, because fg1 is too faint to read once
quoted text fades it. `inkFaint` is mixed from fg2 toward the comment color. `accent` is
blue, because no neutral text reads on magenta. Neither theme colors the file-reference
chip green, because Nightfox's greens are too muted.
