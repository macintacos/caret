import type { ThemeRegistrationRaw } from "shiki/core";

// Custom shiki themes that mirror caret's neutral palette so highlighted code
// reads like a typeset listing rather than a generic editor theme: mostly ink,
// the amber accent for keywords, one green for strings, faint italic comments.
// Registered into the source view's highlighter (see diffview/theme.ts) as
// dual-theme CSS variables so light/dark switches happen via CSS only.
//
// The values below are duplicated from ui/src/app.css — see EXC-370. shiki
// resolves token colors at highlight time and can't read CSS custom properties,
// so this palette is copied from app.css's tokens; keep the two in sync by hand
// if the paper/ink tokens ever change (a unit test guards the match).
interface Palette {
  bg: string; // --paper-sunk: code-block background
  fg: string; // --ink: default text, identifiers
  comment: string; // --ink-faint
  punctuation: string; // --ink-soft
  keyword: string; // --accent (amber)
  entity: string; // --accent-bright: functions, types, numbers, keys
  string: string; // --ok (green)
}

const light: Palette = {
  bg: "#f4f4f4",
  fg: "#171717",
  comment: "#868686",
  punctuation: "#555555",
  keyword: "#c2410c",
  entity: "#ea580c",
  string: "#15803d",
};

const dark: Palette = {
  bg: "#131313",
  fg: "#fafafa",
  comment: "#737373",
  punctuation: "#a1a1a1",
  keyword: "#fb923c",
  entity: "#fdba74",
  string: "#4ade80",
};

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

export const caretLight = build("caret-light", "light", light);
export const caretDark = build("caret-dark", "dark", dark);
