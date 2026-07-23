// The color-palette registry and the single source of truth for every color the
// UI paints (EXC-730). Each theme is a plain object of CSS-custom-property values;
// `applyTheme` writes them as inline properties on the document root, where they
// override app.css's :root defaults (inline style wins over a stylesheet rule), so
// the whole chrome — plus everything that reads `var(--token)`: dialogs, the
// .diffview bridge — retints in realtime with no per-component change. Defining a
// new palette is one more entry in THEMES.
//
// app.css's :root holds the caret-dark values too, as the static first-paint /
// no-JS fallback; theme.test.ts pins THEMES["caret-dark"] equal to that :root
// block so the two never drift (the same test-guarded duplication EXC-370 uses
// for caret-theme.ts). The shiki highlighter derives its palettes from THEMES
// here (see caret-theme.ts), so there is one place colors live.
//
// This module touches `document`/`localStorage` only inside function bodies, never
// at module load, so caret-theme.ts can import THEMES under bun-test without a DOM.

import { definePref } from "$lib/definePref.ts";

export type ThemeId = "caret-dark" | "caret-light";

/** Every color custom property app.css declares in :root — the exhaustive set a
 * palette must supply. Typing `tokens` against this union makes a missing or
 * stray token a compile error, and lets the shiki derivation in caret-theme.ts
 * index tokens without a non-null assertion. */
export type ColorToken =
  | "--paper"
  | "--paper-raised"
  | "--paper-sunk"
  | "--ink"
  | "--ink-soft"
  | "--ink-faint"
  | "--rule"
  | "--rule-strong"
  | "--accent"
  | "--accent-bright"
  | "--accent-wash"
  | "--accent-ink"
  | "--mark"
  | "--mark-active"
  | "--mark-orphan"
  | "--ok"
  | "--danger"
  | "--attention"
  | "--shadow-card";

export interface Theme {
  id: ThemeId;
  /** Human label shown in the Settings dropdown. */
  label: string;
  /** Native color scheme; drives `color-scheme` and the diff view's themeType. */
  scheme: "dark" | "light";
  /** CSS custom property → value, covering every color token app.css declares. */
  tokens: Record<ColorToken, string>;
}

// caret-dark = the values app.css's :root now carries (the default). caret-light =
// the values app.css used to serve under prefers-color-scheme: light.
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

export const THEMES: Record<ThemeId, Theme> = {
  "caret-dark": { id: "caret-dark", label: "caret dark", scheme: "dark", tokens: darkTokens },
  "caret-light": { id: "caret-light", label: "caret light", scheme: "light", tokens: lightTokens },
};

/** Selectable ids in display order — caret-dark (the default) first. Drives both
 * the persisted-preference allow-list and the Settings dropdown. */
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

/** localStorage key holding the remembered theme. Browser-origin-scoped, so it
 * survives daemon restarts (EXC-730 requirement) with no daemon-side state. */
export const THEME_KEY = "caret.theme";

export const DEFAULT_THEME_ID: ThemeId = "caret-dark";

const pref = definePref<ThemeId>(THEME_KEY, THEME_IDS, DEFAULT_THEME_ID);

/** Read the remembered theme id, defaulting to caret-dark on a missing,
 * unrecognized, or unreadable value. */
export const readThemeId = pref.read;

/** Apply a theme to the document root — inline custom properties + color-scheme +
 * data-theme — and persist the choice. Returns the applied theme. */
export function applyTheme(id: ThemeId): Theme {
  const theme = THEMES[id];
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(name, value);
  }
  root.style.setProperty("color-scheme", theme.scheme);
  root.dataset.theme = theme.scheme;
  pref.write(theme.id);
  return theme;
}
