import type { ThemeRegistrationRaw } from "shiki/core";

import { THEMES, type Theme } from "$lib/theme.ts";

// Custom shiki themes that mirror caret's neutral palette so highlighted code
// reads like a typeset listing rather than a generic editor theme: mostly ink,
// the amber accent for keywords, one green for strings, faint italic comments.
// Registered into the source view's highlighter (see diffview/theme.ts) as
// dual-theme CSS variables so light/dark switches happen via CSS only.
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
      // Diff (deleted lines reuse the burnt-amber accent — the palette has no red)
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

export const caretLight = build("caret-light", "light", paletteFromTheme(THEMES["caret-light"]));
export const caretDark = build("caret-dark", "dark", paletteFromTheme(THEMES["caret-dark"]));
