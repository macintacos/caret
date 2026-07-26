// The color-palette registry and the single source of truth for every color the
// UI paints (EXC-730). Each theme is a plain object of CSS-custom-property values;
// `paintTheme` writes them as inline properties onto a target element. Its default
// target is the document root, where they override app.css's :root defaults (inline
// style wins over a stylesheet rule), so the whole chrome — plus everything that
// reads `var(--token)`: dialogs, the .diffview bridge — retints in realtime with no
// per-component change. Defining a new palette is one more entry in THEMES.
//
// A caller may pass any element instead, painting the palette onto that subtree
// rather than the page (EXC-884). Two adapters justify the parameter: the document
// in production, and the scoped preview card that previews a palette the app is not
// currently wearing. Both carry the full stamp — tokens, color-scheme, data-theme —
// so scheme-keyed rules resolve against the painted scheme, not the app's.
//
// Known limitation of a scoped stamp. It makes the subtree match its own scheme's
// rules, but it does not unmatch the page's: app.css's
// `@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *))` and
// atoms.css's `[data-theme="dark"] [data-slot="kbd"]` both key on *any* ancestor, so
// under `<html data-theme="dark">` a subtree stamped light matches both. Today that
// is harmless (the disjoint kbd rules union rather than conflict), but a preview
// that renders real chrome needs the `dark:` variant reworked to a nearest-ancestor
// form first — every `dark:` utility in the tree, hence a separate change.
//
// The palettes themselves live in ./themes/ — one module per family, each carrying
// its upstream source and the mapping onto the tokens below. This module owns the
// types, the assembled registry, and the painting; ./themes/recipe.ts owns the
// tokens a palette derives rather than decides.
//
// Which palette is live — the light/dark/system mode and the two per-scheme theme
// slots — is selection policy, and lives in appearance.ts (EXC-773); paintTheme is
// the painting half it calls.
//
// app.css's :root holds the caret-dark values too, as the static first-paint /
// no-JS fallback; theme.test.ts pins THEMES["caret-dark"] equal to that :root
// block so the two never drift (the same test-guarded duplication EXC-370 uses
// for caret-theme.ts). The shiki highlighter derives its palettes from THEMES
// here (see caret-theme.ts), so there is one place colors live.
//
// This module touches `document` only inside function bodies, never at module
// load, so caret-theme.ts can import THEMES under bun-test without a DOM.

import { caretDark, caretLight } from "$lib/themes/caret.ts";
import {
  catppuccinFrappe,
  catppuccinLatte,
  catppuccinMacchiato,
  catppuccinMocha,
} from "$lib/themes/catppuccin.ts";
import { dracula } from "$lib/themes/dracula.ts";
import { githubDark, githubLight } from "$lib/themes/github.ts";

export type ThemeId =
  | "caret-dark"
  | "caret-light"
  | "catppuccin-latte"
  | "catppuccin-frappe"
  | "catppuccin-macchiato"
  | "catppuccin-mocha"
  | "dracula"
  | "github-light"
  | "github-dark";

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

// Insertion order is display order: caret's own pair first, then each vendor family
// kept together, so a slot's dropdown groups the way a reader expects to find it.
export const THEMES: Record<ThemeId, Theme> = {
  "caret-dark": caretDark,
  "caret-light": caretLight,
  "catppuccin-latte": catppuccinLatte,
  "catppuccin-frappe": catppuccinFrappe,
  "catppuccin-macchiato": catppuccinMacchiato,
  "catppuccin-mocha": catppuccinMocha,
  dracula,
  "github-light": githubLight,
  "github-dark": githubDark,
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

/** Paint a theme onto an element — inline custom properties + color-scheme +
 * data-theme. Painting only: what to paint is decided (and persisted) by
 * appearance.ts. Returns the painted theme.
 *
 * @param target - The element to paint. Defaults to the document root, which is
 * the production path; pass an element to scope the palette to that subtree
 * instead (see the module header's note on what a scoped stamp does and doesn't
 * insulate). */
export function paintTheme(id: ThemeId, target: HTMLElement = document.documentElement): Theme {
  const theme = THEMES[id];
  for (const [name, value] of Object.entries(theme.tokens)) {
    target.style.setProperty(name, value);
  }
  target.style.setProperty("color-scheme", theme.scheme);
  target.dataset.theme = theme.scheme;
  return theme;
}
