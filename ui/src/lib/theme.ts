// The color-palette registry and the single source of truth for every color the
// UI paints (EXC-730). Each theme is a plain object of CSS-custom-property values;
// `paintTheme` writes them as inline properties onto a target element. Its default
// target is the document root, where they override app.css's :root defaults (inline
// style wins over a stylesheet rule), so the whole chrome — plus everything that
// reads `var(--token)`: dialogs, the .diffview bridge — retints in realtime with no
// per-component change. A compiled-in palette is one more entry in THEMES; a theme
// built from a theme file joins at runtime through `addTheme`.
//
// A caller may pass any element instead, painting the palette onto that subtree
// rather than the page (EXC-884) — the scoped preview card previews a palette the
// app is not currently wearing. Both targets carry the full stamp — tokens,
// color-scheme, data-theme — so scheme-keyed rules resolve against the painted
// scheme, not the app's.
//
// Known limitation of a scoped stamp: it makes the subtree match its own scheme's
// rules, but does not unmatch the page's. app.css's `dark:` custom variant and
// atoms.css's `[data-theme="dark"]` keycap rules key on *any* ancestor, so the stamp
// cuts both ways; and styles/derived.css re-derives its tier per painted scope while
// styles/shadcn-bridge.css is still :root-only, so inside a scoped paint the two
// disagree. Both are harmless while the scoped adapter renders only Skeleton, which
// carries no `dark:` variant — but a preview that renders real chrome hits components
// that do (kbd, input), so it needs the `dark:` variant reworked to a nearest-ancestor
// form first: every `dark:` utility in the tree, hence a separate change.
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
// app.css's static first-paint / no-JS fallback is a :root block emitted from
// THEMES["caret-dark"] by ui/generate-palette-css.ts, so the palette is never
// transcribed into CSS by hand.
//
// This module touches `document` only at call time — including the default `target`
// expression, which a parameter default evaluates per call, not at module load — so
// caret-theme.ts can import THEMES under bun-test without a DOM.

import type { ThemeRegistrationRaw } from "shiki/core";
import { SvelteMap } from "svelte/reactivity";

import type { CaretShikiThemeId } from "$lib/caret-shiki.ts";
import type { FileTheme } from "$lib/theme-file.ts";
import { caretDark, caretLight } from "$lib/themes/caret.ts";
import {
  catppuccinFrappe,
  catppuccinLatte,
  catppuccinMacchiato,
  catppuccinMocha,
} from "$lib/themes/catppuccin.ts";
import { dracula } from "$lib/themes/dracula.ts";
import { githubDark, githubLight } from "$lib/themes/github.ts";
import { dawnfox, duskfox } from "$lib/themes/nightfox.ts";
import type { UpstreamShikiThemeId } from "$lib/upstream-shiki.ts";

/** Every shiki theme a palette may name: the vendors' published ones (EXC-896) and
 * the two caret authors for its own pair (EXC-903). One union over both maps is what
 * lets caret-theme.ts resolve any palette through a single lookup. */
export type ShikiThemeId = UpstreamShikiThemeId | CaretShikiThemeId;

export type BuiltinThemeId =
  | "caret-dark"
  | "caret-light"
  | "catppuccin-latte"
  | "catppuccin-frappe"
  | "catppuccin-macchiato"
  | "catppuccin-mocha"
  | "dracula"
  | "github-light"
  | "github-dark"
  | "dawnfox"
  | "duskfox";

declare const customThemeId: unique symbol;
/** A runtime theme's id. Only `addTheme` mints one, so a typo'd literal is still a
 * compile error rather than a silently unknown theme. */
export type CustomThemeId = string & { readonly [customThemeId]: true };

export type ThemeId = BuiltinThemeId | CustomThemeId;

/** A native color scheme. Every theme declares one, and it is what
 * `color-scheme` / `data-theme` carry and what a theme slot is keyed by. */
export type Scheme = "dark" | "light";

/** Every color custom property app.css declares in :root — the exhaustive set a
 * palette must supply. Typing `tokens` against this union makes a missing or
 * stray token a compile error, and lets caret-theme.ts index the tokens its
 * structural marker rules read without a non-null assertion. */
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
  // The six inline chip tints (EXC-858, EXC-1186): the wash behind a rendered
  // markdown span. They tint CONTENT, which is what separates them from
  // styles/derived.css's --chip / --chip-hover, the chrome's floating-surface fill.
  | "--chip-bold"
  | "--chip-italic"
  | "--chip-code"
  | "--chip-link"
  | "--chip-ref"
  | "--chip-skill"
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
  /** The shiki theme this palette highlights code with — the vendor's own published
   * one for a palette named after a vendor (EXC-896), caret's own theme of the
   * same name for its own pair (EXC-903). Required, so a palette that names none is
   * a compile error rather than a page of uncolored code. A runtime theme carries
   * its shiki theme inline. */
  shikiTheme: ShikiThemeId | ThemeRegistrationRaw;
}

// Insertion order is display order: caret's own pair first, then each vendor family
// kept together, so a slot's dropdown groups the way a reader expects to find it.
export const THEMES: Record<BuiltinThemeId, Theme> = {
  "caret-dark": caretDark,
  "caret-light": caretLight,
  "catppuccin-latte": catppuccinLatte,
  "catppuccin-frappe": catppuccinFrappe,
  "catppuccin-macchiato": catppuccinMacchiato,
  "catppuccin-mocha": catppuccinMocha,
  dracula,
  "github-light": githubLight,
  "github-dark": githubDark,
  dawnfox,
  duskfox,
};

/** The built-in ids in display order — caret-dark first. Runtime themes are not
 * here; `themesForScheme` is the live list of what a slot can select. */
export const THEME_IDS = Object.keys(THEMES) as BuiltinThemeId[];

// A SvelteMap so a template reading `themesForScheme` re-runs when a theme registers.
const runtimeThemes = new SvelteMap<string, Theme>();

export function isBuiltinThemeId(id: string): id is BuiltinThemeId {
  return Object.hasOwn(THEMES, id);
}

/** Register a theme built from a theme file, returning its now-selectable id.
 *
 * @throws When the id is a built-in or already registered: both highlighters key
 * themes by this id, so a collision would shadow or half-replace a theme. */
export function addTheme(file: FileTheme): ThemeId {
  if (isBuiltinThemeId(file.id) || runtimeThemes.has(file.id)) {
    throw new Error(`theme id "${file.id}" is already taken`);
  }
  const theme: Theme = { ...file, id: file.id as CustomThemeId };
  runtimeThemes.set(file.id, theme);
  return theme.id;
}

/** The theme for an id, built-in or registered.
 *
 * @throws On an unregistered id — unreachable, since only `addTheme` mints one. */
export function themeFor(id: ThemeId): Theme {
  const theme = isBuiltinThemeId(id) ? THEMES[id] : runtimeThemes.get(id);
  if (theme === undefined) throw new Error(`no theme registered as "${id}"`);
  return theme;
}

/** The themes selectable for one scheme's slot: built-ins in THEME_IDS order, then
 * runtime themes in registration order. A light slot
 * offers only light palettes (and vice versa), so the live theme can never
 * contradict the resolved scheme. Every scheme has at least one, which
 * theme.test.ts pins — a slot with no options would render an empty picker. */
export function themesForScheme(scheme: Scheme): Theme[] {
  return [...THEME_IDS.map((id) => THEMES[id]), ...runtimeThemes.values()].filter(
    (theme) => theme.scheme === scheme,
  );
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
  const theme = themeFor(id);
  for (const [name, value] of Object.entries(theme.tokens)) {
    target.style.setProperty(name, value);
  }
  target.style.setProperty("color-scheme", theme.scheme);
  target.dataset.theme = theme.scheme;
  return theme;
}
