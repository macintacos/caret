// The color-palette registry and the single source of truth for every color the
// UI paints (EXC-730). Each theme is a plain object of CSS-custom-property values;
// `paintTheme` writes them as inline properties on the document root, where they
// override app.css's :root defaults (inline style wins over a stylesheet rule), so
// the whole chrome — plus everything that reads `var(--token)`: dialogs, the
// .diffview bridge — retints in realtime with no per-component change. Defining a
// new palette is one more entry in THEMES.
//
// This module owns PALETTES only. Which palette is live — the light/dark/system
// mode and the two per-scheme theme slots — is selection policy, and lives in
// appearance.ts (EXC-773); paintTheme is the painting half it calls.
//
// app.css's :root holds the caret-dark values too, as the static first-paint /
// no-JS fallback; theme.test.ts pins THEMES["caret-dark"] equal to that :root
// block so the two never drift (the same test-guarded duplication EXC-370 uses
// for caret-theme.ts). The shiki highlighter derives its palettes from THEMES
// here (see caret-theme.ts), so there is one place colors live.
//
// This module touches `document` only inside function bodies, never at module
// load, so caret-theme.ts can import THEMES under bun-test without a DOM.

export type ThemeId = "caret-dark" | "caret-light";

/** A native color scheme. Every theme declares one, and it is what
 * `color-scheme` / `data-theme` carry and what a theme slot is keyed by. */
export type Scheme = "dark" | "light";

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
  /** Native color scheme; drives `color-scheme` and the diff view's themeType,
   * and decides which appearance slot the theme is selectable in. */
  scheme: Scheme;
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

/** Selectable ids in display order — caret-dark first. Drives the per-slot
 * preference allow-lists and the Settings dropdowns. */
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

/** The themes selectable for one scheme's slot, in THEME_IDS order. A light slot
 * offers only light palettes (and vice versa), so the live theme can never
 * contradict the resolved scheme. Every scheme has at least one, which
 * theme.test.ts pins — a slot with no options would render an empty picker. */
export function themesForScheme(scheme: Scheme): Theme[] {
  return THEME_IDS.map((id) => THEMES[id]).filter((theme) => theme.scheme === scheme);
}

/** Paint a theme onto the document root — inline custom properties +
 * color-scheme + data-theme. Painting only: what to paint is decided (and
 * persisted) by appearance.ts. Returns the painted theme. */
export function paintTheme(id: ThemeId): Theme {
  const theme = THEMES[id];
  const root = document.documentElement;
  for (const [name, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(name, value);
  }
  root.style.setProperty("color-scheme", theme.scheme);
  root.dataset.theme = theme.scheme;
  return theme;
}
