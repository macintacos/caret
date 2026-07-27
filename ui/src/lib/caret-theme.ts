import type { ThemeRegistrationRaw } from "shiki/core";

import { THEME_IDS, THEMES, type Theme, type ThemeId } from "$lib/theme.ts";
import { UPSTREAM_SHIKI_THEMES } from "$lib/upstream-shiki.ts";

// One shiki theme per registered palette (EXC-752), so the code a reviewer reads
// is colored by the theme they picked rather than by caret's own pair at the
// matching scheme. Registered into both highlighters: the source view's
// (diffview/theme.ts) and the excerpt popover's (diffview/highlight.ts).
//
// A palette resolves one of two ways (shikiThemeForPalette). A vendor palette
// names that vendor's OWN published shiki theme (EXC-896), so picking Dracula
// gets Dracula — its full rule set, including the pink keyword the seven-role
// derivation below has no way to name — with caret's structural marker rules
// appended last. The upstream object is otherwise carried whole, `colors`
// included: the code background is inert on every caret surface, so overwriting
// it with --paper-sunk would be a deviation that buys nothing.
//
// caret's own pair has no upstream theme to point at, so it is DERIVED: seven
// color tokens mapped onto 15 TextMate rules, and highlighted code reads like a
// typeset listing rather than a generic editor theme — mostly ink, the accent for
// keywords, the positive hue for strings, faint italic comments.
//
// Those seven colors come from the palette objects in theme.ts — the single
// source of truth for every color the UI paints (EXC-730; supersedes the
// hand-copied duplication of EXC-370). shiki resolves token colors at highlight
// time and can't read CSS custom properties, so the values are read out of
// THEMES here rather than re-typed; change a paper/ink token in theme.ts and the
// derivation follows automatically.
interface Palette {
  bg: string; // --paper-sunk: code-block background
  fg: string; // --ink: default text, identifiers
  comment: string; // --ink-faint
  punctuation: string; // --ink-soft
  keyword: string; // --accent (amber)
  entity: string; // --accent-bright: functions, types, numbers, keys
  string: string; // --ok (green)
}

// Map a theme's CSS custom properties onto the seven shiki roles. These tokens
// are plain 6-digit hex (no alpha), which is what shiki accepts.
function paletteFromTheme(t: Theme): Palette {
  const k = t.tokens;
  return {
    bg: k["--paper-sunk"],
    fg: k["--ink"],
    comment: k["--ink-faint"],
    punctuation: k["--ink-soft"],
    keyword: k["--accent"],
    entity: k["--accent-bright"],
    string: k["--ok"],
  };
}

/** The markdown structural markers caret styles itself, whatever theme colors the
 * code underneath. Both resolutions carry them: the derivation places them among its
 * own rules (each more specific than its bare `punctuation` / `markup.fenced_code`
 * entries, so they win only where they apply), and a vendor theme takes them appended
 * last, which is how they beat whatever upstream says.
 *
 * The first two are EXC-692 — subdue the ``` / ~~~ fence markers and make the language
 * info-string prominent, so a code block reads as its own element in the plan view.
 *
 * The third is load-bearing beyond its color. fileRefTag.ts tags the token that BEGINS
 * at a file reference (the column past the opening backtick), and shiki merges adjacent
 * tokens that style identically. Every upstream theme colors the backtick exactly like
 * the code between them, which collapses `` `path` `` into a single token and silently
 * drops the file icon, pointer cursor, and hover chip while leaving the click target
 * alive (EXC-687, EXC-840). Coloring the backtick separately keeps the boundary. It is
 * a no-op for the derivation, whose generic `punctuation` rule already resolves this
 * scope to the same value. */
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

function deriveShikiTheme(theme: Theme): ThemeRegistrationRaw {
  const p = paletteFromTheme(theme);
  return {
    name: theme.id,
    type: theme.scheme,
    colors: {
      "editor.background": p.bg,
      "editor.foreground": p.fg,
    },
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment", "string.comment"],
        settings: { foreground: p.comment, fontStyle: "italic" },
      },
      {
        scope: [
          "string",
          "string.quoted",
          "string.template",
          "constant.other.symbol",
          "meta.diff.header.to-file",
          "markup.inserted",
          "punctuation.definition.inserted",
        ],
        settings: { foreground: p.string },
      },
      {
        scope: [
          "constant.numeric",
          "constant.language",
          "constant.character.escape",
          "string.regexp",
          "support.constant",
        ],
        settings: { foreground: p.entity },
      },
      {
        scope: [
          "keyword",
          "keyword.control",
          "keyword.operator.new",
          "keyword.operator.expression",
          "storage",
          "storage.type",
          "storage.modifier",
          "variable.language",
          "entity.name.tag",
          "punctuation.definition.tag",
        ],
        settings: { foreground: p.keyword },
      },
      {
        scope: [
          "entity.name.function",
          "support.function",
          "meta.function-call",
          "entity.name.type",
          "entity.name.class",
          "support.type",
          "support.class",
          "entity.other.attribute-name",
          "support.type.property-name",
          "variable.other.constant",
        ],
        settings: { foreground: p.entity },
      },
      {
        scope: [
          "keyword.operator",
          "punctuation",
          "meta.brace",
          "punctuation.separator",
          "punctuation.terminator",
        ],
        settings: { foreground: p.punctuation },
      },
      {
        scope: ["variable", "variable.other", "meta.definition.variable", "support.variable"],
        settings: { foreground: p.fg },
      },
      // Markdown
      {
        scope: ["markup.heading", "markup.heading entity.name", "punctuation.definition.heading"],
        settings: { foreground: p.keyword, fontStyle: "bold" },
      },
      { scope: ["markup.bold"], settings: { fontStyle: "bold" } },
      { scope: ["markup.italic"], settings: { fontStyle: "italic" } },
      { scope: ["markup.inline.raw", "markup.fenced_code"], settings: { foreground: p.entity } },
      ...structuralMarkerRules(p),
      // Diff (deleted lines reuse the keyword color — the derivation maps no red)
      {
        scope: ["markup.deleted", "meta.diff.header.from-file", "punctuation.definition.deleted"],
        settings: { foreground: p.keyword },
      },
      {
        scope: ["meta.diff.range", "punctuation.definition.range.diff", "meta.diff.header"],
        settings: { foreground: p.comment, fontStyle: "italic" },
      },
    ],
  };
}

/** Re-key an upstream theme to caret's palette id and append the structural marker
 * rules. Upstream themes carry their rules as `tokenColors`; caret's derivation emits
 * `settings`, and shiki accepts either — normalizing to one keeps the appended rules
 * last, which is what makes them win (shiki is last-match-wins). This order matches
 * shiki's own `normalizeTheme`; `settings` is the branch TypeScript believes is always
 * taken, `tokenColors` the one every real upstream theme actually uses. The rename is
 * what lets a highlighter resolve the theme by the same handle appearance.ts paints
 * with. */
function withStructuralOverrides(
  theme: Theme,
  upstream: ThemeRegistrationRaw,
): ThemeRegistrationRaw {
  const { tokenColors, settings, ...rest } = upstream;
  return {
    ...rest,
    name: theme.id,
    settings: [
      ...(settings ?? tokenColors ?? []),
      ...structuralMarkerRules(paletteFromTheme(theme)),
    ],
  };
}

/** The shiki theme one palette highlights code with: the vendor's own published
 * theme when the palette names one, else caret's seven-role derivation. */
export function shikiThemeForPalette(theme: Theme): ThemeRegistrationRaw {
  const upstream = theme.shikiTheme ? UPSTREAM_SHIKI_THEMES[theme.shikiTheme] : undefined;
  return upstream ? withStructuralOverrides(theme, upstream) : deriveShikiTheme(theme);
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

/** Every caret shiki theme, in THEME_IDS order — what a highlighter registers. */
export const CARET_SHIKI_THEMES: ThemeRegistrationRaw[] = THEME_IDS.map(shikiThemeFor);
