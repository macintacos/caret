import type { ThemeRegistrationRaw } from "shiki/core";

import { THEME_IDS, THEMES, type Theme, type ThemeId } from "$lib/theme.ts";

// Custom shiki themes that mirror caret's palettes so highlighted code reads like
// a typeset listing rather than a generic editor theme: mostly ink, the accent for
// keywords, the positive hue for strings, faint italic comments. Registered into
// the source view's highlighter (see diffview/theme.ts).
//
// One theme is derived per registered palette (EXC-752), so the code a reviewer
// reads is colored by the theme they picked rather than by caret's own pair at the
// matching scheme. A vendor palette therefore gets caret's typographic highlighting
// rendered in its colors — not that vendor's editor theme, which would be a second
// place colors live.
//
// The seven token colors are DERIVED from the palette objects in theme.ts — the
// single source of truth for every color the UI paints (EXC-730; supersedes the
// hand-copied duplication of EXC-370). shiki resolves token colors at highlight
// time and can't read CSS custom properties, so the values are read out of
// THEMES here rather than re-typed; change a paper/ink token in theme.ts and the
// highlighter follows automatically.
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

function build(name: string, type: "light" | "dark", p: Palette): ThemeRegistrationRaw {
  return {
    name,
    type,
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
      // EXC-692: inside a fenced block, subdue the ``` / ~~~ fence markers and make
      // the language info-string prominent, so a code block reads as its own element
      // in the plan view. Both selectors are more specific than the bare `punctuation`
      // and `markup.fenced_code` rules above, so they win only on the fence line and
      // leave the code body (and other markdown punctuation) untouched.
      {
        scope: ["markup.fenced_code.block.markdown punctuation.definition.markdown"],
        settings: { foreground: p.comment },
      },
      {
        scope: ["fenced_code.block.language"],
        settings: { foreground: p.keyword, fontStyle: "bold" },
      },
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

// Built once at module load, keyed by theme id: they are plain objects, and both
// highlighters (the library's and the excerpt popover's) want the whole set up front.
const SHIKI_THEMES = Object.fromEntries(
  THEME_IDS.map((id) => [id, build(id, THEMES[id].scheme, paletteFromTheme(THEMES[id]))]),
) as Record<ThemeId, ThemeRegistrationRaw>;

/** The shiki theme for one caret palette. It is named by the palette's id, so a
 * highlighter resolves it by the same handle appearance.ts paints with. */
export function shikiThemeFor(id: ThemeId): ThemeRegistrationRaw {
  return SHIKI_THEMES[id];
}

/** Every caret shiki theme, in THEME_IDS order — what a highlighter registers. */
export const CARET_SHIKI_THEMES: ThemeRegistrationRaw[] = THEME_IDS.map(shikiThemeFor);
