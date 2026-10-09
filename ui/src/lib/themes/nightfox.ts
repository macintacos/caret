// Nightfox — https://github.com/EdenEast/nightfox.nvim, `lua/nightfox/palette/`. Each
// flavor publishes bg0…bg4 surfaces, fg0…fg3 text, a comment shade, and named hues
// with `.bright` variants; the mapping below takes those directly, except where a
// slot bends:
//
// - Dawnfox's `sunk` is bg2, not the tmTheme's bg1: bg1 is its lightest surface and
//   has to be `raised`. Catppuccin Latte makes the same trade.
// - Dawnfox's `ink` is fg0, not fg1: fg1 is 4.37:1 as quoted ink on `sunk`.
// - Dawnfox's `inkFaint` is mixed along fg2 → comment: no Nightfox neutral, fg3 or
//   comment, clears 3:1 on `paper`.
// - Dawnfox's `accent` is blue, not magenta: no Nightfox neutral reaches 4.5:1 as
//   magenta's `accentInk` (best 3.79).
// - `chipRefHue` is not green on either: Nightfox's greens are too desaturated for the
//   chip-ref floor, and Duskfox's sits too close to its yellow `attention`.

import { paletteTheme } from "$lib/themes/recipe.ts";

export const dawnfox = paletteTheme({
  id: "dawnfox",
  label: "Dawnfox",
  scheme: "light",
  paper: "#ebe5df", // bg0
  raised: "#faf4ed", // bg1, the default background and Dawnfox's lightest
  sunk: "#ebe0df", // bg2
  ink: "#4c4769", // fg0, the tmTheme's foreground
  inkSoft: "#625c87", // fg2
  inkFaint: "#837e9a", // mixed fg2 → comment
  accent: "#286983", // blue
  accentBright: "#2d81a3", // blue.bright
  accentInk: "#faf4ed", // bg1
  neutral: "#9893a5", // comment
  ok: "#618774", // green
  danger: "#b4637a", // red
  attention: "#ea9d34", // yellow
  chipRefHue: "#d685af", // pink
  shikiTheme: "dawnfox",
});

export const duskfox = paletteTheme({
  id: "duskfox",
  label: "Duskfox",
  scheme: "dark",
  paper: "#191726", // bg0
  raised: "#2d2a45", // bg2
  sunk: "#232136", // bg1, the default background and the tmTheme's
  ink: "#e0def4", // fg1
  inkSoft: "#cdcbe0", // fg2
  inkFaint: "#817c9c", // comment
  accent: "#c4a7e7", // magenta, the tmTheme's accent
  accentBright: "#ccb1ed", // magenta.bright
  accentInk: "#191726", // bg0
  neutral: "#817c9c", // comment
  ok: "#a3be8c", // green
  danger: "#eb6f92", // red
  attention: "#f6c177", // yellow
  chipRefHue: "#9ccfd8", // cyan
  shikiTheme: "duskfox",
});
