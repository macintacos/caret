// Standalone syntax highlighting for the filename-hover excerpt (EXC-687) and the
// plan preview's code blocks (EXC-2015). The @pierre/diffs library keeps its own
// private highlighter, so this builds a small dedicated one bound to shiki's full
// grammar bundle and caret's themes (built-ins up front, a runtime theme on first
// use and again under its fresh name after a replace), then highlights an excerpt
// to the caret theme in effect, so the file preview reads like the plan view's own
// code. Three entry points share it: highlightExcerpt colours a whole window in one
// pass, highlightChunk colours a file a piece at a time and hands back the grammar
// state each piece ended on, so a construct that opens in one chunk still colours
// the next, and highlightTokens hands back raw tokens for a caller that builds its
// own DOM. Grammars load lazily and cache; anything that can't highlight falls back
// to plain text.
// Never throws.

import { type GrammarState, hastToHtml, type ThemedToken } from "shiki/core";

import { BUILTIN_SHIKI_THEMES, shikiThemeFor, shikiThemeName } from "$lib/caret-theme.ts";
import { CARET_TOKENIZE_OPTIONS, createHighlighter } from "$lib/diffview/shiki-bundle.ts";
import { isBuiltinThemeId, type ThemeId, themeFor } from "$lib/theme.ts";

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;
type HastRoot = ReturnType<Highlighter["codeToHast"]>;
type HastNode = HastRoot | HastRoot["children"][number];

let highlighterPromise: Promise<Highlighter> | undefined;
const loadedLanguages = new Set<string>();
const loadedThemeNames = new Set<string>();

function highlighter(): Promise<Highlighter> {
  if (highlighterPromise === undefined) {
    highlighterPromise = createHighlighter({
      langs: [],
      themes: BUILTIN_SHIKI_THEMES,
    });
  }
  return highlighterPromise;
}

// Loads `language`'s grammar into the shared highlighter, returning the name to
// actually highlight with — the requested grammar when it loads, else "text".
async function resolveLanguage(hl: Highlighter, language: string): Promise<string> {
  if (language === "" || language === "text") return "text";
  if (loadedLanguages.has(language)) return language;
  try {
    await hl.loadLanguage(language as Parameters<Highlighter["loadLanguage"]>[0]);
    loadedLanguages.add(language);
    return language;
  } catch {
    return "text";
  }
}

// Returns the name to highlight `themeId` with, loading a runtime theme into the
// shared highlighter once per name; built-ins load with the highlighter itself.
async function resolveTheme(hl: Highlighter, themeId: ThemeId): Promise<string> {
  if (isBuiltinThemeId(themeId)) return themeId;
  const name = shikiThemeName(themeFor(themeId));
  if (loadedThemeNames.has(name)) return name;
  await hl.loadTheme(shikiThemeFor(themeId));
  loadedThemeNames.add(name);
  return name;
}

/** Highlights `code` to themed HTML (`<pre class="shiki">…`) in one pass, in a
 * caret palette. Not the preview's own path — FilePreview colours a chunk at a
 * time through highlightChunk — but the reference the chunk rows are measured
 * against, byte for byte, in highlight.test.ts. Returns "" on any failure so a
 * caller can fall back to rendering the code as plain text, and takes that same
 * path for an excerpt carrying a line past `MAX_HIGHLIGHT_LINE_CHARS`. */
export async function highlightExcerpt(
  code: string,
  language: string,
  themeId: ThemeId,
): Promise<string> {
  if (hasUnhighlightableLine(code)) return "";
  try {
    const hl = await highlighter();
    const theme = await resolveTheme(hl, themeId);
    const lang = await resolveLanguage(hl, language);
    return hl.codeToHtml(code, { lang, theme, ...CARET_TOKENIZE_OPTIONS });
  } catch {
    return "";
  }
}

/** Where a chunk's grammar left off — hand it back as the next chunk's `state`.
 * Opaque: only shiki reads it. It belongs to the language and theme that
 * produced it; handed to a different one, that chunk comes back with no rows. */
export type ChunkState = GrammarState;

/**
 * Longest line shiki is asked to tokenize, in UTF-16 code units.
 *
 * A TextMate grammar re-tries its alternations at every position in a line, so
 * the cost of one line is quadratic in its length. Measured against this
 * bundle, on a line of one unbroken run: ~0.4 s at 1 KiB, ~3.1 s at 4 KiB,
 * ~12 s at 8 KiB, ~40 s at 16 KiB — a main-thread freeze, on a file
 * `MAX_EXCERPT_BYTES` would happily admit, and one that no amount of row
 * virtualization can window away because it is a single row. (Minified source
 * is nowhere near as bad — its many short tokens let the tokenizer make
 * progress — but a base64 blob, a data URI or a long CSV row is exactly the
 * pathological shape.)
 *
 * 1 KiB is where a single line's worst case still lands in the same order as a
 * whole ~148-line chunk's (~127 ms) rather than multiples of it. Lines of
 * ordinary source sit far below it; what sits above is generated, minified or
 * not really text, and reads no worse uncoloured.
 *
 * It is the ONLY bound on that cost, and deliberately so: shiki's own
 * `tokenizeTimeLimit` is off (`CARET_TOKENIZE_OPTIONS`), because a wall-clock
 * budget truncates an ordinary line on a busy host and says nothing about it.
 * A bound on the input holds identically whatever else the machine is doing.
 */
export const MAX_HIGHLIGHT_LINE_CHARS = 1024;

/** Whether `code` holds a line past `MAX_HIGHLIGHT_LINE_CHARS`, which every entry
 * point refuses wholesale rather than tokenize — see the `ponytail:` note in
 * highlightChunk for why the offending line's neighbours go down with it. */
function hasUnhighlightableLine(code: string): boolean {
  return code.split("\n").some((line) => line.length > MAX_HIGHLIGHT_LINE_CHARS);
}

/** One highlighted chunk of a file. */
export interface HighlightedChunk {
  /** The chunk's lines, one entry each: that line's token HTML, ready to drop
   * into a row's `<code>`. Empty when highlighting failed, so the caller renders
   * the raw text instead. */
  rows: string[];
  /** The grammar state after the chunk's last line. Undefined both when the
   * grammar carries none (plain text) and when the chunk failed — either way the
   * next chunk starts clean, so the lines below may miscolour. */
  state?: ChunkState;
}

// Stringify each `.line` element's children. shiki's codeToHtml is
// hastToHtml(codeToHast(…)), so a row is byte-for-byte the line's markup inside
// the `<pre>` blob highlightExcerpt returns — the excerpt and a chunk of it
// render identically. Walked rather than indexed through `pre > code` so the
// rows survive a wrapper shiki decides to add; the class match assumes shiki's
// untransformed `line`, which holds because nothing here registers a transformer.
function chunkRows(node: HastNode, rows: string[] = []): string[] {
  if (node.type === "element" && node.properties.class === "line")
    rows.push(hastToHtml({ type: "root", children: node.children }));
  else if ("children" in node) for (const child of node.children) chunkRows(child, rows);
  return rows;
}

/** Highlights one chunk of a file, continuing from where the previous chunk's
 * grammar left off, so a block comment or template literal that opens above the
 * chunk still colours the lines below it. Passing no `state` starts fresh, which
 * is what the file's first chunk wants. State flows forward only — a chunk above
 * the current window still needs a pass from the file's start.
 *
 * `code` must hold whole lines and no trailing newline — shiki would read one as
 * a further, empty line. Never throws: a chunk that can't be highlighted comes
 * back with no rows, for the caller to render as plain text. A chunk carrying a
 * line past `MAX_HIGHLIGHT_LINE_CHARS` takes that same path rather than
 * tokenizing it — see that constant for the freeze it is avoiding. */
export async function highlightChunk(
  code: string,
  language: string,
  themeId: ThemeId,
  state?: ChunkState,
): Promise<HighlightedChunk> {
  // ponytail: the whole chunk falls back, not just the offending line, because
  // rowless-means-plain is the failure contract the caller already implements.
  // Splitting the chunk around the long line would keep its ~147 neighbours
  // coloured, if a file that has such lines ever proves worth the seam.
  if (hasUnhighlightableLine(code)) return { rows: [] };
  try {
    const hl = await highlighter();
    const theme = await resolveTheme(hl, themeId);
    const lang = await resolveLanguage(hl, language);
    // codeToHast tokenizes once and stashes the ending state against the tree it
    // returns, so getLastGrammarState reads it back rather than tokenizing again.
    const root = hl.codeToHast(code, {
      lang,
      theme,
      // A state from before a replace names the old theme, which shiki rejects.
      grammarState: state?.themes.includes(theme) ? state : undefined,
      ...CARET_TOKENIZE_OPTIONS,
    });
    return { rows: chunkRows(root), state: hl.getLastGrammarState(root) };
  } catch {
    return { rows: [] };
  }
}

/** Tokenizes `code` (whole lines, no trailing newline) in `language`, a bundled grammar id,
 * and the theme in effect: one token array per line. Null when it can't — a grammar that
 * won't load, a line past MAX_HIGHLIGHT_LINE_CHARS, any failure — so the caller leaves
 * the block plain. Never throws. */
export async function highlightTokens(
  code: string,
  language: string,
  themeId: ThemeId,
): Promise<ThemedToken[][] | null> {
  if (hasUnhighlightableLine(code)) return null;
  try {
    const hl = await highlighter();
    const theme = await resolveTheme(hl, themeId);
    const lang = await resolveLanguage(hl, language);
    if (lang === "text") return null;
    return hl.codeToTokensBase(code, {
      // codeToTokensBase types `lang` as the bundle's literal union, unlike codeToHast;
      // resolveLanguage returns only a grammar that loaded, and "text" is excluded above.
      lang: lang as NonNullable<Parameters<Highlighter["codeToTokensBase"]>[1]["lang"]>,
      theme,
      ...CARET_TOKENIZE_OPTIONS,
    });
  } catch {
    return null;
  }
}
