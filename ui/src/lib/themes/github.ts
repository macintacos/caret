// GitHub Light and Dark — https://github.com/primer/github-vscode-theme, whose
// colors come from @primer/primitives. Every hex here is a Primer functional token,
// named in the comment beside it, so the pair reads as GitHub rather than as an
// approximation of it.
//
// The surfaces map onto GitHub's own: the page sits on the canvas GitHub itself
// uses (`bgColor.muted` in light, `bgColor.default` in dark), cards take the
// brightest canvas, and the code body takes the recessed one — which lands on
// caret's ordering without reaching outside Primer for a value.

import { paletteTheme } from "$lib/themes/recipe.ts";

export const githubLight = paletteTheme({
  id: "github-light",
  label: "GitHub Light",
  scheme: "light",
  paper: "#f6f8fa", // bgColor.muted — GitHub's page background
  raised: "#ffffff", // bgColor.default
  sunk: "#eff2f5", // bgColor.disabled
  ink: "#1f2328", // fgColor.default
  inkSoft: "#59636e", // fgColor.muted
  inkFaint: "#818b98", // fgColor.disabled
  accent: "#0969da", // fgColor.accent — the link blue
  // The deeper blue GitHub itself gives constants and entities: this token is the
  // shiki entity color as well as the accent's hover, and on a white code surface
  // a lighter blue would be the palette's least readable text.
  accentBright: "#0550ae", // prettylights syntax constant
  accentInk: "#ffffff", // fgColor.onEmphasis
  neutral: "#818b98", // fgColor.disabled, the base of Primer's own neutral wash
  ok: "#1a7f37", // fgColor.success
  danger: "#d1242f", // fgColor.danger
  attention: "#9a6700", // fgColor.attention
  // The `-default` pair, not the unsuffixed one: the latter is the legacy Primer
  // theme, and these surfaces come from current Primer.
  shikiTheme: "github-light-default",
});

export const githubDark = paletteTheme({
  id: "github-dark",
  label: "GitHub Dark",
  scheme: "dark",
  paper: "#0d1117", // bgColor.default — GitHub's page background
  raised: "#151b23", // bgColor.muted
  sunk: "#010409", // bgColor.inset
  ink: "#f0f6fc", // fgColor.default
  inkSoft: "#9198a1", // fgColor.muted
  inkFaint: "#656c76", // fgColor.disabled
  accent: "#4493f8", // fgColor.accent
  accentBright: "#79c0ff", // prettylights syntax constant
  accentInk: "#010409", // bgColor.inset
  neutral: "#656c76", // fgColor.disabled
  ok: "#3fb950", // fgColor.success
  danger: "#f85149", // fgColor.danger
  attention: "#d29922", // fgColor.attention
  shikiTheme: "github-dark-default",
});
