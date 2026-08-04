// Standalone syntax highlighting for the filename-hover excerpt (EXC-687). The
// @pierre/diffs library keeps its own private highlighter, so this builds a small
// dedicated one bound to shiki's full grammar bundle and caret's themes, then
// highlights an excerpt to the caret theme in effect — so the preview reads like
// the plan view's own code. Two entry points share it: highlightExcerpt colours a
// whole window in one pass, highlightChunk colours a file a piece at a time and
// hands back the grammar state each piece ended on, so a construct that opens in
// one chunk still colours the next. Grammars load lazily and cache; anything that
// can't highlight falls back to plain text. Never throws.

import { type GrammarState, hastToHtml } from "shiki/core";

import { REGISTERED_SHIKI_THEMES } from "$lib/caret-theme.ts";
import { createHighlighter } from "$lib/diffview/shiki-bundle.ts";
import type { ThemeId } from "$lib/theme.ts";

type Highlighter = Awaited<ReturnType<typeof createHighlighter>>;
type HastRoot = ReturnType<Highlighter["codeToHast"]>;
type HastNode = HastRoot | HastRoot["children"][number];

let highlighterPromise: Promise<Highlighter> | undefined;
const loadedLanguages = new Set<string>();

function highlighter(): Promise<Highlighter> {
  if (highlighterPromise === undefined) {
    highlighterPromise = createHighlighter({
      langs: [],
      themes: REGISTERED_SHIKI_THEMES,
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

/** Highlights `code` to themed HTML (`<pre class="shiki">…`) in one pass, in a
 * caret palette. Not the preview's own path — FilePreview colours a chunk at a
 * time through highlightChunk — but the reference the chunk rows are measured
 * against, byte for byte, in highlight.test.ts. Returns "" on any failure so a
 * caller can fall back to rendering the code as plain text. */
export async function highlightExcerpt(
  code: string,
  language: string,
  themeId: ThemeId,
): Promise<string> {
  try {
    const hl = await highlighter();
    const lang = await resolveLanguage(hl, language);
    return hl.codeToHtml(code, { lang, theme: themeId });
  } catch {
    return "";
  }
}

/** Where a chunk's grammar left off — hand it back as the next chunk's `state`.
 * Opaque: only shiki reads it. It belongs to the language and theme that
 * produced it; handed to a different one, that chunk comes back with no rows. */
export type ChunkState = GrammarState;

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
 * back with no rows, for the caller to render as plain text. */
export async function highlightChunk(
  code: string,
  language: string,
  themeId: ThemeId,
  state?: ChunkState,
): Promise<HighlightedChunk> {
  try {
    const hl = await highlighter();
    const lang = await resolveLanguage(hl, language);
    // codeToHast tokenizes once and stashes the ending state against the tree it
    // returns, so getLastGrammarState reads it back rather than tokenizing again.
    const root = hl.codeToHast(code, { lang, theme: themeId, grammarState: state });
    return { rows: chunkRows(root), state: hl.getLastGrammarState(root) };
  } catch {
    return { rows: [] };
  }
}
