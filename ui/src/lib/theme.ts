// The color-palette registry and the single source of truth for every color the
// UI paints (EXC-730). Each theme is a plain object of CSS-custom-property values;
// `paintTheme` writes them as inline properties onto a target element. Its default
// target is the document root, where they override app.css's :root defaults (inline
// style wins over a stylesheet rule), so the whole chrome — plus everything that
// reads `var(--token)`: dialogs, the .diffview bridge — retints in realtime with no
// per-component change. A compiled-in palette is one more entry in THEMES; a theme
// built from a theme file joins at runtime through `registerTheme`
// (registerTheme.ts), whose registry half is `addTheme`; an uploaded file whose id
// is already registered swaps it in place through `replaceTheme`.
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
// The palettes themselves are theme files in ./themes/, built at module load by the
// same `buildFileTheme` a runtime theme goes through. This module owns the types, the
// assembled registry, and the painting; ./themes/recipe.ts owns the tokens a palette
// derives rather than decides.
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

import { fillFallbackRoles } from "@core/theme/role-scopes.ts";
import type { ThemeFile } from "@core/theme/schema.ts";
// theme-file.ts takes only types from here, so this runtime import is not a load-order
// cycle — never reach for a runtime value in that direction.
import { buildFileTheme, type FileTheme } from "$lib/theme-file.ts";
import caretDark from "$lib/themes/caret-dark.json";
import caretLight from "$lib/themes/caret-light.json";
import catppuccinFrappe from "$lib/themes/catppuccin-frappe.json";
import catppuccinLatte from "$lib/themes/catppuccin-latte.json";
import catppuccinMacchiato from "$lib/themes/catppuccin-macchiato.json";
import catppuccinMocha from "$lib/themes/catppuccin-mocha.json";
import dawnfox from "$lib/themes/dawnfox.json";
import dracula from "$lib/themes/dracula.json";
import duskfox from "$lib/themes/duskfox.json";
import githubDark from "$lib/themes/github-dark.json";
import githubLight from "$lib/themes/github-light.json";

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

/** Any theme a slot can hold: a built-in palette or one `addTheme` minted. */
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

interface ThemeFields {
  /** Human label shown in the Settings dropdown. */
  label: string;
  /** Native color scheme; drives `color-scheme` and the diff view's themeType,
   * and decides which appearance slot the theme is selectable in. */
  scheme: Scheme;
  /** CSS custom property → value, covering every color token app.css declares. */
  tokens: Record<ColorToken, string>;
}

/** A compiled-in palette. */
export interface BuiltinTheme extends ThemeFields {
  id: BuiltinThemeId;
  /** The shiki theme its code is highlighted with, built from its theme file's syntax roles. */
  shikiTheme: ThemeRegistrationRaw;
}

/** A theme built from a theme file, carrying its shiki theme inline. */
export interface RuntimeTheme extends ThemeFields {
  id: CustomThemeId;
  /** Bumped by each replace; `shikiThemeName` folds it into both highlighters' cache
   * key, so a rebuild must not reset it. */
  revision: number;
  shikiTheme: ThemeRegistrationRaw;
}

export type Theme = BuiltinTheme | RuntimeTheme;

// Insertion order is display order: caret's own pair first, then each vendor family
// kept together, so a slot's dropdown groups the way a reader expects to find it.
export const THEMES: Record<BuiltinThemeId, BuiltinTheme> = {
  "caret-dark": builtin("caret-dark", caretDark),
  "caret-light": builtin("caret-light", caretLight),
  "catppuccin-latte": builtin("catppuccin-latte", catppuccinLatte),
  "catppuccin-frappe": builtin("catppuccin-frappe", catppuccinFrappe),
  "catppuccin-macchiato": builtin("catppuccin-macchiato", catppuccinMacchiato),
  "catppuccin-mocha": builtin("catppuccin-mocha", catppuccinMocha),
  dracula: builtin("dracula", dracula),
  "github-light": builtin("github-light", githubLight),
  "github-dark": builtin("github-dark", githubDark),
  dawnfox: builtin("dawnfox", dawnfox),
  duskfox: builtin("duskfox", duskfox),
};

// A JSON import is the schema's unvalidated input — `scheme` widens to string and the
// optional roles may be absent — so the fallbacks are filled as the schema's transform
// fills them. theme-file.test.ts pins the result to the validated build.
function builtin(
  id: BuiltinThemeId,
  json: Omit<ThemeFile, "scheme" | "syntax"> & { scheme: string; syntax: object },
): BuiltinTheme {
  const syntax = fillFallbackRoles(json.syntax as Parameters<typeof fillFallbackRoles>[0]);
  return { ...buildFileTheme({ ...json, scheme: json.scheme as ThemeFile["scheme"], syntax }), id };
}

/** The built-in ids in display order — caret-dark first. Runtime themes are not
 * here; `themesForScheme` is the live list of what a slot can select. */
export const THEME_IDS = Object.keys(THEMES) as BuiltinThemeId[];

// A SvelteMap so a template reading `themesForScheme` re-runs when a theme registers.
// Module-level, like THEMES: one registry per document, and every consumer calls
// functions on it. Entries are never removed — a replace swaps one in place — so a
// registering test uses an id no other test in its file uses.
const runtimeThemes = new SvelteMap<CustomThemeId, RuntimeTheme>();

/** Whether an id names a compiled-in palette (an own key of THEMES). */
export function isBuiltinThemeId(id: string): id is BuiltinThemeId {
  return Object.hasOwn(THEMES, id);
}

/** Whether an id names a registered runtime theme. */
export function isCustomThemeId(id: string): id is CustomThemeId {
  return runtimeThemes.has(id as CustomThemeId);
}

/** Add a theme built from a theme file to the registry, returning its minted id.
 * The registry half only — a theme's arrival goes through `registerTheme`
 * (registerTheme.ts), which also teaches the diff highlighter and re-resolves the
 * slots.
 *
 * @throws When the id is a built-in or already registered: both highlighters key
 * themes by their shiki name, which is this id until a replace, so a collision would
 * shadow or half-replace a theme; a deliberate swap goes through `replaceTheme`. */
export function addTheme(file: FileTheme): CustomThemeId {
  const id = file.id as CustomThemeId; // the one place a CustomThemeId is minted
  if (isBuiltinThemeId(id) || runtimeThemes.has(id)) {
    throw new Error(`theme id "${id}" is already taken`);
  }
  runtimeThemes.set(id, { ...file, id, revision: 0 });
  return id;
}

/** Swap a registered runtime theme for a new file declaring its id, keeping its place
 * in the picker. Its revision bumps, so `shikiThemeName` names it afresh: both
 * highlighters and shiki cache a theme by name for the page's life.
 *
 * @throws When the id is not a registered runtime theme. */
// ponytail: every replace leaves the previous name's theme registered in both
// highlighters for the page's life (~1 KiB each); evict there if replaces get frequent.
export function replaceTheme(file: FileTheme): CustomThemeId {
  const id = file.id as CustomThemeId;
  const previous = runtimeThemes.get(id);
  if (previous === undefined) throw new Error(`theme id "${file.id}" is not registered`);
  runtimeThemes.set(id, { ...file, id, revision: previous.revision + 1 });
  return id;
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
 * runtime themes in registration order. A light slot offers only light palettes
 * (and vice versa), so the live theme can never contradict the resolved scheme.
 * Every scheme has at least one, which theme.test.ts pins — a slot with no options
 * would render an empty picker. Reads the runtime registry reactively, so a template
 * or `$derived` calling it re-runs when a theme registers. */
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
  paintPalette(theme, target);
  return theme;
}

/** Paint a palette that need not be registered — `paintTheme`'s painting half, for
 * the boot paint of a cached custom palette. */
export function paintPalette(
  palette: Pick<Theme, "tokens" | "scheme">,
  target: HTMLElement = document.documentElement,
): void {
  for (const [name, value] of Object.entries(palette.tokens)) {
    target.style.setProperty(name, value);
  }
  target.style.setProperty("color-scheme", palette.scheme);
  target.dataset.theme = palette.scheme;
}
