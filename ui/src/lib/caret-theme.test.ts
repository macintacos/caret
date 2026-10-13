import { describe, expect, test } from "bun:test";

import { createHighlighterCore } from "shiki/core";

import { ROLE_SCOPES } from "@core/theme/role-scopes.ts";
import type { SyntaxRole } from "@core/theme/schema.ts";
import { customThemeFile, themeFileColors } from "@ui/support/theme-file.ts";
import {
  BUILTIN_SHIKI_THEMES,
  shikiThemeFor,
  shikiThemeForPalette,
  shikiThemeName,
} from "$lib/caret-theme.ts";
import { CARET_TOKENIZE_OPTIONS, createCaretRegexEngine } from "$lib/diffview/shiki-bundle.ts";
import {
  addTheme,
  type BuiltinThemeId,
  type ColorToken,
  replaceTheme,
  THEME_IDS,
  THEMES,
  type ThemeId,
  themeFor,
} from "$lib/theme.ts";

// caret-theme.ts resolves one shiki theme per registered palette: every theme carries
// its own, built from its theme file's syntax roles. shiki resolves token colors at
// highlight time and can't read CSS custom properties, so the hex is read out of
// THEMES — the single source of truth for every color the UI paints (EXC-730) — at
// module load.
//
// These tests pin what the resolver adds on top of that: caret's appended markdown
// rules, added last for every registered theme. caret's own pair's themes are pinned
// alongside — they spend their file's colors and nothing else.

// The tokens these tests read: the two the fence line's own rules paint with, plus
// the one a fenced block's body takes under caret's own themes. (The third structural
// rule's token, --ink-soft, is asserted directly where it is read.)
const FIELD_TO_TOKEN: Record<string, ColorToken> = {
  comment: "--ink-faint",
  keyword: "--accent",
  fenceBody: "--accent-bright",
};

/** caret's two palettes paired with the colors of the theme file each is built from. */
const CARET_RECORDS = [
  ["caret-dark", await themeFileColors("caret-dark.json")],
  ["caret-light", await themeFileColors("caret-light.json")],
] as const;

/** How many rules caret appends over the theme a palette names — the three structural
 * markers plus the four emphasis rules (caret-theme.ts's `caretMarkdownRules`). */
const APPENDED_RULES = 7;

const FENCE_MARKERS = "markup.fenced_code.block.markdown punctuation.definition.markdown";
const FENCE_LANGUAGE = "fenced_code.block.language";
const INLINE_RAW = "punctuation.definition.raw.markdown";
const BOLD = "markup.bold.markdown";
const ITALIC = "markup.italic.markdown";
const NESTED_EMPHASIS = "markup.bold.markdown markup.italic.markdown";
const BOLD_MARKERS = "punctuation.definition.bold.markdown";
const ITALIC_MARKERS = "punctuation.definition.italic.markdown";

/** The scopes the three structural rules own, in the order the resolver appends them. */
const STRUCTURAL_SCOPES = [FENCE_MARKERS, FENCE_LANGUAGE, INLINE_RAW];

const SYNTAX_ROLES = Object.keys(ROLE_SCOPES) as SyntaxRole[];

/** The expected color for each Palette field, sourced from a theme's tokens. The
 * ColorToken-keyed tokens map guarantees each lookup resolves. */
function expectedPalette(id: BuiltinThemeId): Record<string, string> {
  const tokens = THEMES[id].tokens;
  const palette: Record<string, string> = {};
  for (const [field, token] of Object.entries(FIELD_TO_TOKEN)) {
    palette[field] = tokens[token];
  }
  return palette;
}

interface ThemeLike {
  colors?: Record<string, string | undefined>;
  settings?: Array<{ settings?: { foreground?: string } }>;
}

/** Every distinct foreground color the theme actually emits. */
function themeColors(theme: ThemeLike): Set<string> {
  const colors = new Set<string>();
  for (const v of Object.values(theme.colors ?? {})) if (v) colors.add(v);
  for (const rule of theme.settings ?? []) {
    const fg = rule.settings?.foreground;
    if (fg) colors.add(fg);
  }
  return colors;
}

// caret's own pair's themes, built from caret-{dark,light}.json's syntax roles — spent
// across a scope set wide enough to tell a type from a function. These pin the built
// theme's own contract; what the resolver adds is below.
describe("caret's own shiki themes", () => {
  for (const [id, record] of CARET_RECORDS) {
    describe(id, () => {
      const theme = THEMES[id].shikiTheme;

      test("is named by its palette id", () => {
        expect(theme.name).toBe(id);
      });

      test("paints the editor on the file's sunk surface, in its ink", () => {
        // The same two values --paper-sunk / --ink carry, read from the file
        // rather than through the tokens: the file is the source both halves share.
        expect(theme.colors?.["editor.background"]).toBe(record.sunk);
        expect(theme.colors?.["editor.foreground"]).toBe(record.ink);
      });

      test("carries the palette's scheme as the theme type", () => {
        expect(theme.type).toBe(THEMES[id].scheme);
      });

      test("emits no color the file does not name", () => {
        // Closure over the file: a hex typed into the theme by hand fails here
        // rather than shipping.
        const named = new Set<string>(Object.values(record));
        for (const color of themeColors(theme)) expect(named, color).toContain(color);
      });

      test("spends every syntax role's color", () => {
        // The reverse direction: a role color no rule actually names is a color
        // nothing paints.
        const emitted = themeColors(theme);
        for (const role of SYNTAX_ROLES) {
          expect(emitted, `${id}.${role} (${record[role]})`).toContain(record[role]);
        }
      });

      test("leaves the structural markers to the resolver", () => {
        // The resolver appends caretMarkdownRules to every theme, and
        // appended-last is what makes them win. A copy carried here would sit
        // among the rules it is supposed to beat.
        const scopes = (theme.settings ?? []).flatMap((rule) => rule.scope ?? []);
        for (const scope of STRUCTURAL_SCOPES) expect(scopes).not.toContain(scope);
      });
    });
  }
});

describe("caret-theme ↔ THEMES palette sync", () => {
  // Every palette gets a highlighter theme, not just caret's own pair (EXC-752):
  // a reviewer who picks Dracula reads Dracula-colored code, not amber code.
  test("resolves one shiki theme per registered palette, named by its id", () => {
    expect(BUILTIN_SHIKI_THEMES.map((theme) => theme.name)).toEqual(THEME_IDS);
  });

  test("highlights a vendor palette in its own colors, not caret's", () => {
    expect(shikiThemeFor("dracula").colors?.["editor.background"]).not.toBe(
      shikiThemeFor("caret-dark").colors?.["editor.background"],
    );
  });

  // The one resolution path preserves the scheme, so a light theme can never be
  // rendered on a dark palette (or the reverse) without failing here.
  for (const id of THEME_IDS) {
    test(`${id} carries its palette's scheme as the shiki theme type`, () => {
      expect(shikiThemeFor(id).type).toBe(THEMES[id].scheme);
    });
  }

  test("the two caret themes use distinct palettes (light vs dark do not collapse)", () => {
    expect(shikiThemeFor("caret-light").colors?.["editor.background"]).not.toBe(
      shikiThemeFor("caret-dark").colors?.["editor.background"],
    );
  });
});

// The appended rules, unrendered. One resolution path, so every registered theme
// takes the same seven — and shiki is last-match-wins, so appending them is what
// makes them beat whatever the theme underneath says about those scopes.
describe("caret's appended markdown rules", () => {
  for (const id of THEME_IDS) {
    // Resolved fresh rather than read off the cached object: shiki's normalizeTheme
    // unshifts a scope-less default fg/bg rule into the array it is handed, in place,
    // so a registered theme's rule count no longer matches the resolver's.
    test(`${id} carries them last, in order`, () => {
      const tokens = THEMES[id].tokens;
      const rules = shikiThemeForPalette(THEMES[id]).settings ?? [];
      const [markers, language, raw, bold, italic, nested, emphasis] = rules.slice(-APPENDED_RULES);
      expect(markers?.scope).toEqual([FENCE_MARKERS]);
      expect(markers?.settings.foreground).toBe(tokens["--ink-faint"]);
      expect(language?.scope).toEqual([FENCE_LANGUAGE]);
      expect(language?.settings.foreground).toBe(tokens["--accent"]);
      expect(language?.settings.fontStyle).toBe("bold");
      expect(raw?.scope).toEqual([INLINE_RAW]);
      expect(raw?.settings.foreground).toBe(tokens["--ink-soft"]);
      // Each emphasis rule carries fontStyle and NOTHING else, so each palette's own
      // ink survives; only the markers take a color of their own.
      expect(bold?.scope).toEqual([BOLD]);
      expect(bold?.settings).toEqual({ fontStyle: "bold" });
      expect(italic?.scope).toEqual([ITALIC]);
      expect(italic?.settings).toEqual({ fontStyle: "italic" });
      // The nested rule sits after both, and carries BOTH styles: textmate reads
      // fontStyle off the single most-specific match rather than OR-ing the ancestors,
      // so without it `***x***` resolves against markup.italic.markdown alone.
      expect(nested?.scope).toEqual([NESTED_EMPHASIS]);
      expect(nested?.settings).toEqual({ fontStyle: "bold italic" });
      expect(emphasis?.scope).toEqual([BOLD_MARKERS, ITALIC_MARKERS]);
      expect(emphasis?.settings.foreground).toBe(tokens["--ink-faint"]);
    });
  }
});

// EXC-692: the plan view renders the plan as a markdown document, so a fenced
// code block's opening line (```lang) is markdown-tokenized — the ``` / ~~~ fence
// markers carry punctuation.definition.markdown and the language info-string
// carries fenced_code.block.language. The theme subdues the markers to --ink-faint
// and makes the language prominent (--accent, bold) while leaving the code body's
// color untouched. Every registered theme takes that treatment — the rendered half of
// the rule-order assertions above. The markers and language only become separate
// spans once their colors differ.
describe("fenced-code fence line", () => {
  // The THEMES palette values are lowercase hex; shiki emits some token colors
  // uppercased, so normalize the received color (only) before comparing.
  let shared: Awaited<ReturnType<typeof createHighlighterCore>> | undefined;
  async function tokenizeFence(id: ThemeId) {
    shared ??= await createHighlighterCore({
      themes: THEME_IDS.map(shikiThemeFor),
      langs: [import("shiki/langs/markdown.mjs")],
      engine: createCaretRegexEngine(),
    });
    const md = ["```ts", "code", "```"].join("\n");
    return shared.codeToTokensBase(md, { lang: "markdown", theme: id, ...CARET_TOKENIZE_OPTIONS });
  }

  for (const id of THEME_IDS) {
    test(`${id} subdues the fence backticks to --ink-faint`, async () => {
      const [line1] = await tokenizeFence(id);
      const backticks = line1?.find((t) => t.content === "```");
      expect(backticks?.color?.toLowerCase()).toBe(expectedPalette(id).comment);
    });

    test(`${id} renders the language tag in bold --accent`, async () => {
      const [line1] = await tokenizeFence(id);
      const lang = line1?.find((t) => t.content === "ts");
      expect(lang?.color?.toLowerCase()).toBe(expectedPalette(id).keyword);
      // shiki FontStyle bitmask: bit value 2 is bold.
      expect((lang?.fontStyle ?? 0) & 2).toBe(2);
    });
  }

  // The body is the half caret does NOT override, so it is the theme's own: under
  // caret's pair the fence body takes --accent-bright (theme files carry no
  // inline-code role — that is EXC-858's), and the Dracula block below is the same
  // assertion from the vendor side.
  test("leaves the code body to caret's own theme (--accent-bright)", async () => {
    const code = (await tokenizeFence("caret-light"))[1]?.find((t) => t.content === "code");
    expect(code?.color?.toLowerCase()).toBe(expectedPalette("caret-light").fenceBody);
  });
});

// fileRefTag.ts tags the token that BEGINS at a file reference's start column — the
// column past the opening backtick — so the backtick has to be a token of its own.
// Whether it is depends on the THEME, not the grammar: shiki merges adjacent tokens
// that style identically, and every upstream theme colors
// `punctuation.definition.raw.markdown` the same as `markup.inline.raw`. Without
// caret's override the whole `` `path` `` collapses into one token starting at the
// backtick, no token begins at the path, and the file icon, pointer cursor, and hover
// chip all silently vanish while the click target survives (EXC-687, EXC-840). No
// color assertion can see that, so pin the boundary itself.
describe("inline-code file references stay tokenized for fileRefTag", () => {
  const LINE = "See `ui/src/lib/theme.ts` for details.";
  const PATH_COL = LINE.indexOf("`") + 1;

  let shared: Awaited<ReturnType<typeof createHighlighterCore>> | undefined;
  async function tokenize(id: ThemeId) {
    shared ??= await createHighlighterCore({
      themes: THEME_IDS.map(shikiThemeFor),
      langs: [import("shiki/langs/markdown.mjs")],
      engine: createCaretRegexEngine(),
    });
    return (
      shared.codeToTokensBase(LINE, {
        lang: "markdown",
        theme: id,
        ...CARET_TOKENIZE_OPTIONS,
      })[0] ?? []
    );
  }

  for (const id of THEME_IDS) {
    test(`${id} emits a token beginning at the path`, async () => {
      // The same running-length walk tagTokenAt performs over the rendered spans.
      const starts = new Set<number>();
      let col = 0;
      for (const token of await tokenize(id)) {
        starts.add(col);
        col += token.content.length;
      }
      expect(starts).toContain(PATH_COL);
    });
  }
});

// EXC-867: bold reads bold and italic reads italic in the plan view, whatever theme
// a reviewer picked — caret's own pair styles `markup.bold` / `markup.italic` itself,
// but no vendor theme is obliged to, so the rendered claim has to be checked against
// every registered palette rather than against caret's two.
//
// The marker assertion is the load-bearing one, for the same reason the inline-code
// backtick above is: shiki merges adjacent tokens that style identically, so while the
// `**` markers and the content between them share a style, `**bold**` arrives as ONE
// token. Giving the markers their own ink is what splits it into `**` / `bold` / `**`,
// which is the boundary the decoration pass tags from.
describe("markdown emphasis", () => {
  const SAMPLE = ["**bold**", "*italic*", "***both***"].join("\n");

  let shared: Awaited<ReturnType<typeof createHighlighterCore>> | undefined;
  async function tokenizeEmphasis(id: ThemeId) {
    shared ??= await createHighlighterCore({
      themes: THEME_IDS.map(shikiThemeFor),
      langs: [import("shiki/langs/markdown.mjs")],
      engine: createCaretRegexEngine(),
    });
    return shared.codeToTokensBase(SAMPLE, {
      lang: "markdown",
      theme: id,
      ...CARET_TOKENIZE_OPTIONS,
    });
  }

  for (const id of THEME_IDS) {
    test(`${id} renders emphasis in its font style and subdues the markers`, async () => {
      const [boldLine = [], italicLine = [], bothLine = []] = await tokenizeEmphasis(id);
      const faint = expectedPalette(id).comment;
      // shiki's fontStyle is a bitmask (1 italic, 2 bold, 4 underline) and a marker
      // sitting inside emphasis carries several bits at once, so read it with AND.
      expect((boldLine.find((t) => t.content === "bold")?.fontStyle ?? 0) & 2).toBe(2);
      expect((italicLine.find((t) => t.content === "italic")?.fontStyle ?? 0) & 1).toBe(1);
      expect(boldLine.find((t) => t.content === "**")?.color?.toLowerCase()).toBe(faint);
      expect(italicLine.find((t) => t.content === "*")?.color?.toLowerCase()).toBe(faint);
      // Bold INSIDE italic reads as both (bitmask 3), the case textmate gets wrong on
      // its own: it resolves fontStyle from one most-specific rule instead of OR-ing
      // the ancestors, so without the nested rule `***both***` renders italic-only.
      expect((bothLine.find((t) => t.content === "both")?.fontStyle ?? 0) & 3).toBe(3);
      // The split itself, which no color assertion can see: without the marker rule
      // the whole `**bold**` is a single token and there is nothing to decorate.
      expect(boldLine.length).toBeGreaterThan(1);
    });
  }
});

// The vendor half of the body assertion above: caret overrides the fence line for
// every theme, but never the block's body. Here the body is tokenized by the
// embedded TypeScript grammar and colored by the vendor's real theme — `const`
// renders the vendor's keyword color, one caret's own set names nowhere.
describe("vendor fenced-code block", () => {
  test.each([
    ["dracula", "#ff79c6"],
    ["dawnfox", "#907aa9"],
    ["duskfox", "#c4a7e7"],
  ] as const)("%s colors the code body in its own theme", async (palette, keywordColor) => {
    const hl = await createHighlighterCore({
      themes: [shikiThemeFor(palette)],
      langs: [import("shiki/langs/markdown.mjs"), import("shiki/langs/typescript.mjs")],
      engine: createCaretRegexEngine(),
    });
    const md = ["```ts", "const x = 1", "```"].join("\n");
    const constKeyword = hl
      .codeToTokensBase(md, { lang: "markdown", theme: palette, ...CARET_TOKENIZE_OPTIONS })[1]
      ?.find((t) => t.content === "const");
    expect(constKeyword?.color?.toLowerCase()).toBe(keywordColor);
    // caret's fence-language rule is bold and the vendor keyword rule is not, which
    // separates the two where the colors coincide (Duskfox).
    expect((constKeyword?.fontStyle ?? 0) & 2).toBe(0);
  });
});

// The three pairs caret's scope set is wide enough to separate — a type from a
// function, a number from a string escape, an attribute from a property — checked
// against a real grammar rather than read back off the rule table, which would only
// restate caret-shiki.ts in a second spelling.
//
// A caveat for anyone editing the sample: which scope a token resolves to can
// depend on the lines around it, not just the token itself, so re-verify the WHOLE
// sample after changing any line of it. Tokenized through caret's own engine
// (diffview/shiki-bundle.ts) rather than a bare `createJavaScriptRegexEngine()` —
// the two are no longer interchangeable, and only the former is what caret paints.
describe("caret themes over a real TypeScript sample", () => {
  const SAMPLE = [
    "function build(rows: Row[]): string {",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: sample source, never evaluated
    '  return rows.map((r) => `${r.id}`).join("\\n");',
    "}",
    'const el = <div className="row" />;',
    "const LIMIT = 42;",
  ].join("\n");

  let shared: Awaited<ReturnType<typeof createHighlighterCore>> | undefined;
  async function tokenizeSample(id: ThemeId) {
    shared ??= await createHighlighterCore({
      themes: [shikiThemeFor("caret-dark"), shikiThemeFor("caret-light")],
      langs: [import("shiki/langs/tsx.mjs")],
      engine: createCaretRegexEngine(),
    });
    return shared.codeToTokensBase(SAMPLE, { lang: "tsx", theme: id, ...CARET_TOKENIZE_OPTIONS });
  }

  /** The color of one token, found on the line that holds it — the sample repeats
   * some contents across lines, and the line is the cheapest way to say which. */
  function colorAt(lines: Awaited<ReturnType<typeof tokenizeSample>>, row: number, text: string) {
    return lines[row]?.find((t) => t.content === text)?.color?.toLowerCase();
  }

  for (const [id, p] of CARET_RECORDS) {
    describe(id, () => {
      test("colors a type apart from a function", async () => {
        const lines = await tokenizeSample(id);
        expect(colorAt(lines, 0, "Row")).toBe(p.type);
        expect(colorAt(lines, 0, "build")).toBe(p.function);
      });

      test("colors a number apart from a string escape", async () => {
        const lines = await tokenizeSample(id);
        expect(colorAt(lines, 4, "42")).toBe(p.number);
        expect(colorAt(lines, 1, "\\n")).toBe(p.escape);
      });

      test("colors an attribute apart from a property", async () => {
        const lines = await tokenizeSample(id);
        expect(colorAt(lines, 3, "className")).toBe(p.attribute);
        expect(colorAt(lines, 1, "id")).toBe(p.property);
      });
    });
  }
});

// EXC-911: the block above reads COLORS, which can only ever be as right as the
// scopes underneath them. This one reads the scopes directly, so a mis-scoped
// token fails here by name instead of surfacing as a puzzling wrong hue there.
//
// The defect it exists for: JavaScriptCore treats an optional group containing `^`
// as anchoring the whole pattern (`/(^a)?b/.exec("xb")` → null on JSC, a match on
// V8), and the TypeScript grammar's line-comment rule is exactly that shape. So a
// `//` following code on the same line never matched the comment rule and fell
// through to the arithmetic-operator rule. caret's engine rewrites the pattern
// (diffview/jsc-regex.ts) to restore it.
//
// What this suite does NOT pin is that repair: bun's JSC no longer carries the defect
// as of bun 1.4, so these expectations hold with or without the rewrite (see
// diffview/jsc-regex.ts's header for the per-engine measurements). They remain worth
// having as the grammar's own truth, read off the Oniguruma reference. The repair's
// trigger lives in a browser this runner is not, and getting it observed is EXC-1223.
describe("the shipped engine tokenizes TypeScript to the grammar's real scopes", () => {
  // Every expectation below was read off the Oniguruma engine — the reference
  // implementation — rather than guessed, so the suite pins the grammar's truth.
  const SAMPLE = [
    "function build(rows: { id: number }[]): string {",
    "  return rows.length.toString(); // rows",
    "}",
    "const LIMIT = 42;",
  ].join("\n");

  /** Each line's tokens as `[text, scopeStack]`. shiki 4.1.0's `includeExplanation`
   * throws, so scopes come from the TextMate grammar directly — the same path the
   * highlighter itself tokenizes through. */
  let cached: Array<Array<[string, string[]]>> | undefined;
  async function scopeLines() {
    if (cached !== undefined) return cached;
    const highlighter = await createHighlighterCore({
      themes: [shikiThemeFor("caret-dark")],
      langs: [import("shiki/langs/tsx.mjs")],
      engine: createCaretRegexEngine(),
    });
    const grammar = highlighter.getInternalContext().getLanguage("tsx");
    // The grammar's own stack type, which starts null and is threaded line to line
    // — carrying it is what lets a multi-line construct scope correctly.
    let stack: Parameters<typeof grammar.tokenizeLine>[1] = null;
    cached = SAMPLE.split("\n").map((line) => {
      const { tokens, ruleStack } = grammar.tokenizeLine(line, stack, undefined);
      stack = ruleStack;
      return tokens.map(
        (t) => [line.slice(t.startIndex, t.endIndex), t.scopes] as [string, string[]],
      );
    });
    return cached;
  }

  /** The deepest scope on the token whose text is `text`, on line `row`. */
  async function scopeAt(row: number, text: string) {
    const lines = await scopeLines();
    return lines[row]?.find(([content]) => content === text)?.[1]?.at(-1);
  }

  // The assertion that goes red before the fix: under the unrepaired engine the
  // trailing `//` splits into two `keyword.operator.arithmetic` tokens and the
  // comment body scopes as a plain variable.
  test("scopes a trailing line comment as a comment", async () => {
    const lines = await scopeLines();
    // Defaulted rather than optional-chained: unrepaired, `//` is not a token at
    // all (it splits into two arithmetic-operator tokens), and an empty stack says
    // that far more legibly than a matcher complaining about `undefined`.
    const slashes = lines[1]?.find(([content]) => content === "//")?.[1] ?? [];
    expect(slashes).toContain("comment.line.double-slash.tsx");
    expect(await scopeAt(1, " rows")).toBe("comment.line.double-slash.tsx");
  });

  // Regression pins rather than the repair's target: these three hold either way, and
  // they are what makes this suite the standing answer to "did tokenization drift?".
  test("scopes `function` and `const` as storage types, not entity names", async () => {
    expect(await scopeAt(0, "function")).toBe("storage.type.function.tsx");
    expect(await scopeAt(3, "const")).toBe("storage.type.tsx");
  });

  test("splits a type literal's members rather than merging them", async () => {
    expect(await scopeAt(0, "id")).toBe("variable.object.property.tsx");
    expect(await scopeAt(0, "number")).toBe("support.type.primitive.tsx");
  });

  test("scopes a screaming-case binding as a constant", async () => {
    expect(await scopeAt(3, "LIMIT")).toBe("variable.other.constant.tsx");
  });
});

// A rendered patch takes the semantic pair rather than two more syntax hues, so it
// agrees with the diff view's own addition and deletion tints. Pinned because these
// three are palette colors rather than syntax roles, which puts them outside the
// coverage check above — and because the deletion hue is the one color decision this
// theme pair makes that no other surface already asserts.
describe("caret themes over a diff fence", () => {
  const PATCH = ["```diff", "@@ -1,2 +1,2 @@", "-old(1)", "+new(2)", "```"].join("\n");

  let shared: Awaited<ReturnType<typeof createHighlighterCore>> | undefined;
  async function tokenizePatch(id: ThemeId) {
    shared ??= await createHighlighterCore({
      themes: [shikiThemeFor("caret-dark"), shikiThemeFor("caret-light")],
      langs: [import("shiki/langs/markdown.mjs"), import("shiki/langs/diff.mjs")],
      engine: createCaretRegexEngine(),
    });
    return shared.codeToTokensBase(PATCH, {
      lang: "markdown",
      theme: id,
      ...CARET_TOKENIZE_OPTIONS,
    });
  }

  for (const [id, p] of CARET_RECORDS) {
    test(`${id} paints an addition ok, a deletion danger, and the range faint`, async () => {
      const lines = await tokenizePatch(id);
      const colorOn = (row: number) => lines[row]?.[0]?.color?.toLowerCase();
      expect(colorOn(1), "@@ range").toBe(p.comment);
      expect(colorOn(2), "deleted line").toBe(p.danger);
      expect(colorOn(3), "added line").toBe(p.ok);
    });
  }
});

describe("shikiThemeFor a runtime theme", () => {
  test("names it by its id and appends caret's markdown rules after the file's own", async () => {
    const file = await customThemeFile("runtime-shiki", "dark");
    const original = structuredClone(file.shikiTheme);
    const id = addTheme(file);
    const theme = shikiThemeFor(id);
    expect(theme.name).toBe(id);
    const fileRules = file.shikiTheme.settings ?? [];
    expect(theme.settings?.slice(0, fileRules.length)).toEqual(fileRules);
    const appendedRules = theme.settings?.slice(fileRules.length) ?? [];
    const caretRules = shikiThemeFor("caret-dark").settings ?? [];
    expect(appendedRules.map((r) => r.scope)).toEqual(
      caretRules.slice(-appendedRules.length).map((r) => r.scope),
    );
    expect(
      appendedRules.find((r) => String(r.scope).includes(FENCE_LANGUAGE))?.settings.foreground,
    ).toBe(file.tokens["--accent"]);
    expect(file.shikiTheme).toEqual(original);
  });
});

describe("shikiThemeName", () => {
  test("is a built-in's id", () => {
    expect(shikiThemeName(THEMES.dracula)).toBe("dracula");
    expect(shikiThemeFor("dracula").name).toBe("dracula");
  });

  test("is a runtime theme's id until a replace names it afresh", async () => {
    const file = await customThemeFile("shiki-name", "dark");
    const id = addTheme(file);
    expect(shikiThemeName(themeFor(id))).toBe(id);
    expect(shikiThemeFor(id).name).toBe(id);

    replaceTheme(file);
    const renamed = shikiThemeName(themeFor(id));
    expect(renamed).not.toBe(id);
    expect(renamed.startsWith(`${id}~`)).toBe(true);
    expect(shikiThemeFor(id).name).toBe(renamed);
  });
});
