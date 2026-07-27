import type { ThemeRegistrationRaw } from "shiki/core";

import { CARET_SHIKI_THEMES } from "$lib/caret-shiki.ts";
import { type ShikiThemeId, THEME_IDS, THEMES, type Theme, type ThemeId } from "$lib/theme.ts";
import { UPSTREAM_SHIKI_THEMES } from "$lib/upstream-shiki.ts";

// One shiki theme per registered palette (EXC-752), so the code a reviewer reads
// is colored by the theme they picked rather than by caret's own pair at the
// matching scheme. Registered into both highlighters: the source view's
// (diffview/theme.ts) and the excerpt popover's (diffview/highlight.ts).
//
// Every palette names the theme it highlights with, and the two asset maps below
// hold them all, so shikiThemeForPalette is one total lookup rather than a fork.
// A vendor palette names that vendor's OWN published theme (EXC-896), so picking
// Dracula gets Dracula — its full rule set, including the pink keyword caret's own
// color set cannot name. caret's pair names the theme authored for it out of that
// set (EXC-903; caret-shiki.ts). Either object is carried whole, `colors`
// included: an upstream theme's code background is inert on every caret surface,
// so overwriting it with --paper-sunk would be a deviation that buys nothing.
//
// What the resolver adds is caret's three structural marker rules, appended last —
// last-match-wins is what makes them beat whatever the theme underneath says. They
// are painted from the palette's own tokens in theme.ts, the single source of truth
// for every color the UI paints (EXC-730; supersedes the hand-copied duplication of
// EXC-370). shiki resolves token colors at highlight time and can't read CSS custom
// properties, so the values are read out of THEMES here rather than re-typed.
interface Palette {
  comment: string; // --ink-faint: the fence markers
  punctuation: string; // --ink-soft: the inline-code backtick
  keyword: string; // --accent: the fence's language tag
}

// The three tokens structuralMarkerRules paints with. They are plain 6-digit hex
// (no alpha), which is what shiki accepts.
function paletteFromTheme(t: Theme): Palette {
  const k = t.tokens;
  return {
    comment: k["--ink-faint"],
    punctuation: k["--ink-soft"],
    keyword: k["--accent"],
  };
}

/** The markdown structural markers caret styles itself, whatever theme colors the
 * code underneath. Every theme takes them appended last, which is how they beat
 * whatever the theme underneath says about those scopes.
 *
 * The first two are EXC-692 — subdue the ``` / ~~~ fence markers and make the language
 * info-string prominent, so a code block reads as its own element in the plan view.
 *
 * The third is load-bearing beyond its color. fileRefTag.ts tags the token that BEGINS
 * at a file reference (the column past the opening backtick), and shiki merges adjacent
 * tokens that style identically. Every upstream theme colors the backtick exactly like
 * the code between them, which collapses `` `path` `` into a single token and silently
 * drops the file icon, pointer cursor, and hover chip while leaving the click target
 * alive (EXC-687, EXC-840). Coloring the backtick separately keeps the boundary. Under
 * caret's own themes it also lifts the backtick off the generic `punctuation` hue, so
 * the boundary holds by color rather than by rule order alone. */
function structuralMarkerRules(p: Palette): NonNullable<ThemeRegistrationRaw["settings"]> {
  return [
    {
      scope: ["markup.fenced_code.block.markdown punctuation.definition.markdown"],
      settings: { foreground: p.comment },
    },
    {
      scope: ["fenced_code.block.language"],
      settings: { foreground: p.keyword, fontStyle: "bold" },
    },
    {
      scope: ["punctuation.definition.raw.markdown"],
      settings: { foreground: p.punctuation },
    },
  ];
}

/** Re-key a source theme to caret's palette id and append the structural marker
 * rules. Upstream themes carry their rules as `tokenColors` and caret's own pair
 * as `settings`; shiki accepts either — normalizing to one keeps the appended rules
 * last, which is what makes them win (shiki is last-match-wins). This order matches
 * shiki's own `normalizeTheme`; `settings` is the branch TypeScript believes is always
 * taken, `tokenColors` the one every real upstream theme actually uses. The rename is
 * what lets a highlighter resolve the theme by the same handle appearance.ts paints
 * with. */
function withStructuralOverrides(theme: Theme, source: ThemeRegistrationRaw): ThemeRegistrationRaw {
  const { tokenColors, settings, ...rest } = source;
  return {
    ...rest,
    name: theme.id,
    settings: [
      ...(settings ?? tokenColors ?? []),
      ...structuralMarkerRules(paletteFromTheme(theme)),
    ],
  };
}

/** Every theme a palette can name, in one map — the vendors' published themes and
 * caret's own pair. Keying it by `ShikiThemeId` is what makes the lookup below
 * total: a palette's `shikiTheme` is that same union, so there is no unresolved case
 * to branch on. */
const SHIKI_THEME_SOURCES: Record<ShikiThemeId, ThemeRegistrationRaw> = {
  ...UPSTREAM_SHIKI_THEMES,
  ...CARET_SHIKI_THEMES,
};

/** The shiki theme one palette highlights code with, wearing caret's structural
 * marker rules. */
export function shikiThemeForPalette(theme: Theme): ThemeRegistrationRaw {
  return withStructuralOverrides(theme, SHIKI_THEME_SOURCES[theme.shikiTheme]);
}

// Built once at module load, keyed by theme id: they are plain objects, and both
// highlighters (the library's and the excerpt popover's) want the whole set up front.
const SHIKI_THEMES = Object.fromEntries(
  THEME_IDS.map((id) => [id, shikiThemeForPalette(THEMES[id])]),
) as Record<ThemeId, ThemeRegistrationRaw>;

/** The shiki theme for one caret palette. It is named by the palette's id, so a
 * highlighter resolves it by the same handle appearance.ts paints with. */
export function shikiThemeFor(id: ThemeId): ThemeRegistrationRaw {
  return SHIKI_THEMES[id];
}

/** One resolved theme per registered palette, in THEME_IDS order — what a highlighter
 * registers. Every palette's, not just caret's own pair: this is the output side of the
 * resolver, where `CARET_SHIKI_THEMES` and `UPSTREAM_SHIKI_THEMES` are its two inputs. */
export const REGISTERED_SHIKI_THEMES: ThemeRegistrationRaw[] = THEME_IDS.map(shikiThemeFor);
