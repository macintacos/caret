// Thematic-break classification for the markdown plan view (EXC-862). A
// horizontal rule is just the row whose line IS the break: this module says
// which lines those are, and tags them so CARET_OVERRIDES (coreStyles.ts) can
// draw the rule over the characters.
//
// The hard half is the NEGATIVE cases, and marked's own block lexer answers all
// of them. `---` is spelled identically to a setext heading underline, a table
// delimiter row and a fenced line, and converting one of those is a wrong render
// rather than a look someone might prefer. Lexer.lex's tokens tile the source
// exactly, so accumulating each token's newlines maps every `hr` to a line
// number in one pass — and the tokenizer has already decided that
// `Setext head\n---` is a heading, that a delimiter row belongs to its table,
// and that a fenced `---` is code. Reusing the grammar this layer already
// depends on (inlineSpans.ts lexes the same document's inline tokens) is also
// what makes a `---` INTERRUPTING a list come out as a break, which a
// previous-line scan gets backwards.
//
// YAML front matter is the one case marked has no concept of, so it is the one
// case handled here: an opening `---` on line 1 lexes as an `hr`, and so does its
// closer. Both are suppressed, and only when the document really opens on a
// closed front-matter block — an unclosed leading `---` is a rule like any other.
//
// The fenced ranges are taken as a parameter for the same reason tableRanges
// takes them. Deferring to the panel where they disagree costs a break that
// marked would have drawn and keeps the two views of the row consistent.
//
// A break nested inside a blockquote or a list item is deliberately not found:
// those arrive as nested tokens whose `raw` has the container's markers stripped,
// so their offsets no longer index the source. The row keeps its raw characters,
// which is a plainer render rather than a wrong one.

import { Lexer } from "marked";

import type { CodeBlockRange } from "$lib/diffview/codeBlocks.ts";

/** The document's own opening delimiter, and the two spellings that close it.
 * Matched exactly rather than CommonMark-loose: front matter is a whole-line
 * convention with no indentation allowance, so a `  ---` on line 1 is a thematic
 * break and a `--- ` is one too. */
const FRONT_MATTER_OPEN = "---";
const FRONT_MATTER_CLOSE = ["---", "..."];

/** The 1-based lines of a closed YAML front-matter block's two delimiters, or an
 * empty array when the document does not open on one. Both are returned because
 * either can reach `hr`: the opener always does, and the closer does whenever a
 * blank line before it stops marked reading it as a setext underline.
 *
 * The scan stops at the first BLANK line rather than running to the end of the
 * document: without that bound, a document opening on a genuine thematic break
 * claims the next `---` in the file as its closer and suppresses both. The bound
 * inverts the error to the cheaper one — front matter carrying a blank line inside
 * is no longer recognised, so its two delimiters draw rules, which is local and
 * visible where the other silently deletes a rule elsewhere. */
function frontMatterLines(text: string): number[] {
  const lines = text.split("\n");
  if (lines[0] !== FRONT_MATTER_OPEN) return [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trim() === "") return [];
    if (FRONT_MATTER_CLOSE.includes(line)) return [1, i + 1];
  }
  return [];
}

/**
 * The thematic breaks in `text`, as 1-based display line numbers matching the
 * view's `data-line` attributes. Every CommonMark spelling counts — `---`,
 * `***`, `___`, with three or more markers, optional internal spaces and up to
 * three leading spaces — and every look-alike is excluded: a setext heading
 * underline, a GFM table's delimiter row, any line inside a fenced block, and
 * both delimiters of a YAML front-matter block. `codeRanges` names the blocks the
 * panel paints, which is a wider notion of "fenced" than marked's; a line either
 * of them calls code is left alone.
 */
export function thematicBreakLines(
  text: string,
  codeRanges: readonly CodeBlockRange[],
): Set<number> {
  const breaks = new Set<number>();
  let line = 1;
  for (const token of Lexer.lex(text)) {
    if (token.type === "hr") breaks.add(line);
    line += (token.raw.match(/\n/g) ?? []).length;
  }
  for (const n of frontMatterLines(text)) breaks.delete(n);
  for (const range of codeRanges) {
    for (let n = range.start; n <= range.end; n++) breaks.delete(n);
  }
  return breaks;
}

/**
 * Tags the source view's content rows so the rule CSS (CARET_OVERRIDES in
 * coreStyles.ts) can draw on them: `data-md-rule` on every
 * `[data-content] [data-line]` cell whose line is a thematic break. Re-run
 * after every repaint (see SourceView.svelte); clears rows that are no longer
 * breaks.
 *
 * Descendant, not child: a row a scroll card has re-parented is no longer a
 * direct child of `[data-content]` (codeBlockScroll.ts), and a child selector
 * silently stops matching it. A break never lands inside a card today; the
 * selector is the house form regardless.
 */
export function tagThematicBreakRows(root: ParentNode, lines: ReadonlySet<number>): void {
  for (const row of root.querySelectorAll<HTMLElement>("[data-content] [data-line]")) {
    const n = Number(row.getAttribute("data-line"));
    row.toggleAttribute("data-md-rule", Number.isFinite(n) && lines.has(n));
  }
}
