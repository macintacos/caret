// caret's own two palettes — the reference every other theme is mapped against, and
// the values app.css's :root carries as its static first-paint fallback
// (theme.test.ts pins caret-dark against that block).
//
// Both go through ./recipe.ts like every vendor palette, with hue overrides for the
// three washes caret decides apart from the color they would otherwise derive from:
// the accent wash rides a mid-amber that is deliberately not --accent, caret-dark's
// marks ride a second, slightly lighter amber, and caret-dark's rules ride pure
// white so its hairlines stay neutral on near-black paper.

import { paletteTheme } from "$lib/themes/recipe.ts";

export const caretDark = paletteTheme({
  id: "caret-dark",
  label: "caret dark",
  scheme: "dark",
  paper: "#0a0a0a",
  raised: "#171717",
  sunk: "#131313",
  ink: "#fafafa",
  inkSoft: "#a1a1a1",
  inkFaint: "#737373",
  accent: "#fb923c",
  accentBright: "#fdba74",
  accentInk: "#0a0a0a",
  neutral: "#9b9b9b",
  ok: "#4ade80",
  danger: "#f87171",
  attention: "#a78bfa",
  ruleHue: "#ffffff",
  washHue: "#ec7c38",
  markHue: "#f3953c",
});

// The neutral surfaces and ink carry a subtle warm (brown-ish) undertone so the
// light theme reads as a sibling to caret-dark rather than a cool grey (EXC-776):
// each grey has R > G > B instead of a flat R = G = B. The warmth stays subtle —
// no perceptible yellow/orange cast — and preserves the prior luminance ordering
// (raised > paper > sunk) and text contrast. theme.test.ts pins R > B on these.
export const caretLight = paletteTheme({
  id: "caret-light",
  label: "caret light",
  scheme: "light",
  paper: "#faf9f5",
  raised: "#fffdf8",
  sunk: "#f4f1ea",
  ink: "#1c1714",
  inkSoft: "#57504a",
  inkFaint: "#8a827a",
  accent: "#c2410c",
  accentBright: "#ea580c",
  accentInk: "#fff7ed",
  neutral: "#787068",
  ok: "#15803d",
  danger: "#b91c1c",
  attention: "#7c3aed",
  // The marks cascade from the wash: both ride the same mid-amber here, where
  // caret-dark lifts its marks a step lighter than its wash.
  washHue: "#ec7c38",
});
