// caret's own two palettes — the reference every other theme is mapped against.
// Written out token by token rather than through ./recipe.ts, because these are the
// values app.css's :root carries as its static first-paint fallback (theme.test.ts
// pins caret-dark against that block) and because a few of their washes predate the
// recipe: the marks and the accent wash ride a mid-amber that is deliberately not
// --accent, and the dark rules ride pure white rather than the ink.

import type { ColorToken, Theme } from "$lib/theme.ts";

const darkTokens: Record<ColorToken, string> = {
  "--paper": "#0a0a0a",
  "--paper-raised": "#171717",
  "--paper-sunk": "#131313",
  "--ink": "#fafafa",
  "--ink-soft": "#a1a1a1",
  "--ink-faint": "#737373",
  "--rule": "#ffffff1a",
  "--rule-strong": "#ffffff29",
  "--accent": "#fb923c",
  "--accent-bright": "#fdba74",
  "--accent-wash": "#ec7c3829",
  "--accent-ink": "#0a0a0a",
  "--mark": "#f3953c2e",
  "--mark-active": "#f3953c57",
  "--mark-orphan": "#9b9b9b29",
  "--ok": "#4ade80",
  "--danger": "#f87171",
  "--attention": "#a78bfa",
  "--shadow-card": "0 1px 2px #00000066, 0 10px 30px #00000080",
};

// The neutral surfaces and ink carry a subtle warm (brown-ish) undertone so the
// light theme reads as a sibling to caret-dark rather than a cool grey (EXC-776):
// each grey has R > G > B instead of a flat R = G = B. The warmth stays subtle —
// no perceptible yellow/orange cast — and preserves the prior luminance ordering
// (raised > paper > sunk) and text contrast. theme.test.ts pins R > B on these.
const lightTokens: Record<ColorToken, string> = {
  "--paper": "#faf9f5",
  "--paper-raised": "#fffdf8",
  "--paper-sunk": "#f4f1ea",
  "--ink": "#1c1714",
  "--ink-soft": "#57504a",
  "--ink-faint": "#8a827a",
  "--rule": "#1c17141a",
  "--rule-strong": "#1c171429",
  "--accent": "#c2410c",
  "--accent-bright": "#ea580c",
  "--accent-wash": "#ec7c381f",
  "--accent-ink": "#fff7ed",
  "--mark": "#ec7c3824",
  "--mark-active": "#ec7c3847",
  "--mark-orphan": "#78706829",
  "--ok": "#15803d",
  "--danger": "#b91c1c",
  "--attention": "#7c3aed",
  "--shadow-card": "0 1px 2px #0000000f, 0 8px 24px #00000014",
};

export const caretDark: Theme = {
  id: "caret-dark",
  label: "caret dark",
  scheme: "dark",
  tokens: darkTokens,
};

export const caretLight: Theme = {
  id: "caret-light",
  label: "caret light",
  scheme: "light",
  tokens: lightTokens,
};
