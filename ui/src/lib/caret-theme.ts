import type { ThemeRegistrationRaw } from "shiki/core";

import { CARET_SHIKI_THEMES } from "$lib/caret-shiki.ts";
import { type ShikiThemeId, THEME_IDS, THEMES, type Theme, type ThemeId } from "$lib/theme.ts";
import { UPSTREAM_SHIKI_THEMES } from "$lib/upstream-shiki.ts";

// One shiki theme per registered palette (EXC-752), so the code a reviewer reads
// is colored by the theme they picked rather than by caret's own pair at the
// matching scheme. Registered into both highlighters: the source view's
// (diffview/theme.ts) and the excerpt preview's (diffview/highlight.ts).
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
// What the resolver adds is caret's own markdown rules — three structural markers and
// four for emphasis — appended last, because last-match-wins is what makes them beat
// whatever the theme underneath says. shiki resolves token colors at highlight time and
// can't read CSS custom properties, so their values are read out of THEMES (EXC-730,
// the single source of truth for every color the UI paints) rather than re-typed.
interface Palette {
  comment: string; // --ink-faint: the fence markers and the ** / _ emphasis markers
  punctuation: string; // --ink-soft: the inline-code backtick
  keyword: string; // --accent: the fence's language tag
}

// Plain 6-digit hex, no alpha — the only form shiki accepts.
function paletteFromTheme(t: Theme): Palette {
  const k = t.tokens;
  return {
    comment: k["--ink-faint"],
    punctuation: k["--ink-soft"],
    keyword: k["--accent"],
  };
}

/** The markdown markers and emphasis caret styles itself, whatever theme colors the
 * code underneath. Every theme takes them appended last, which is how they beat
 * whatever the theme underneath says about those scopes.
 *
 * The fence pair is EXC-692 — subdue the ``` / ~~~ fence markers and make the language
 * info-string prominent, so a code block reads as its own element in the plan view.
 *
 * The backtick rule is load-bearing beyond its color. fileRefTag.ts tags the token that
 * BEGINS at a file reference (the column past the opening backtick), and shiki merges
 * adjacent tokens that style identically. Every upstream theme colors the backtick
 * exactly like the code between them, which collapses `` `path` `` into a single token
 * and silently drops the file icon, pointer cursor, and hover chip while leaving the
 * click target alive (EXC-687, EXC-840). Coloring the backtick separately keeps the
 * boundary.
 *
 * The MARKER rule (EXC-867) is the same boundary trick: the grammar scopes the `**` /
 * `_` markers apart from the content, but shiki merges the three back into ONE token
 * while they style identically, so giving the markers their own ink is what splits
 * `**bold**` into `**` / `bold` / `**` for the decoration pass to tag.
 *
 * The three `fontStyle` rules do NOT reach the plan view, which is worth knowing before
 * deleting them. @pierre/diffs carries a token's font style into the DOM as a custom
 * property and consumes it with `font-weight: light-dark(…)`, which is invalid —
 * light-dark() is defined over `<color>` — so the library renders every token at one
 * weight whatever the theme says, and the plan view's weight and slant are declared in
 * `diffview/coreStyles.ts` instead. They still reach the excerpt preview
 * (`diffview/highlight.ts`), which renders through shiki's own codeToHast and honours
 * `fontStyle`.
 *
 * The nested rule is not redundant with the two beside it. textmate resolves `fontStyle`
 * from the single most-specific matching rule rather than OR-ing what the ancestor scopes
 * say, so `***both***` — whose content carries `markup.bold.markdown` AND
 * `markup.italic.markdown` — otherwise resolves against `markup.italic.markdown` alone and
 * renders italic with no weight. The descendant scope is more specific than either. */
function caretMarkdownRules(p: Palette): NonNullable<ThemeRegistrationRaw["settings"]> {
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
    {
      scope: ["markup.bold.markdown"],
      settings: { fontStyle: "bold" },
    },
    {
      scope: ["markup.italic.markdown"],
      settings: { fontStyle: "italic" },
    },
    {
      scope: ["markup.bold.markdown markup.italic.markdown"],
      settings: { fontStyle: "bold italic" },
    },
    {
      scope: ["punctuation.definition.bold.markdown", "punctuation.definition.italic.markdown"],
      settings: { foreground: p.comment },
    },
  ];
}

/** Re-key a source theme to caret's palette id and append the structural marker
 * rules. Upstream themes carry their rules as `tokenColors` and caret's own pair
 * as `settings`; shiki accepts either — normalizing to one keeps the appended rules
 * last, which is what makes them win (shiki is last-match-wins). The `settings ??
 * tokenColors` order matches shiki's own `normalizeTheme`: `settings` is the branch
 * TypeScript believes is always taken, `tokenColors` the one every real upstream theme
 * actually uses. */
function withStructuralOverrides(theme: Theme, source: ThemeRegistrationRaw): ThemeRegistrationRaw {
  const { tokenColors, settings, ...rest } = source;
  return {
    ...rest,
    name: theme.id,
    settings: [...(settings ?? tokenColors ?? []), ...caretMarkdownRules(paletteFromTheme(theme))],
  };
}

/** Every theme a palette can name, in one map — the vendors' published themes and
 * caret's own pair. Keyed by `ShikiThemeId`, the same union a palette's `shikiTheme`
 * is, so the lookup below is total with no unresolved case to branch on. */
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
// highlighters (the library's and the excerpt preview's) want the whole set up front.
const SHIKI_THEMES = Object.fromEntries(
  THEME_IDS.map((id) => [id, shikiThemeForPalette(THEMES[id])]),
) as Record<ThemeId, ThemeRegistrationRaw>;

/** The shiki theme for one caret palette. It is named by the palette's id, so a
 * highlighter resolves it by the same handle appearance.ts paints with. */
export function shikiThemeFor(id: ThemeId): ThemeRegistrationRaw {
  return SHIKI_THEMES[id];
}

/** One resolved theme per registered palette, in THEME_IDS order — what a highlighter
 * registers. */
export const REGISTERED_SHIKI_THEMES: ThemeRegistrationRaw[] = THEME_IDS.map(shikiThemeFor);
