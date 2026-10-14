// Heading rows for the markdown plan view. shiki colors a heading's tokens, but
// @pierre/diffs drops a token's font style (coreStyles.ts carries the finding), so a
// theme's heading weight and slant ride a row attribute instead: this module says which
// lines are headings, at which level, and tags those rows for CARET_OVERRIDES.
//
// marked's block lexer decides it, as it does for thematicBreaks.ts, so a setext heading
// is both its lines and a `#` that opens no heading is none. Nor is any line of YAML
// front matter, though marked reads a `# comment` in it, or its last key over the
// closing `---`, as one. A heading nested in a blockquote or a list item arrives as a
// nested token and is not found; its row keeps shiki's color and the surrounding weight.

import { Lexer } from "marked";

import type { CodeBlockRange } from "$lib/diffview/codeBlocks.ts";
import { frontMatterLines } from "$lib/diffview/thematicBreaks.ts";

/** Each 1-based display line of a heading in `text`, mapped to its level: an ATX
 * heading's one line, a setext heading's text and underline. A line of front matter, or
 * one the panel paints as code, is never one. */
export function headingLines(
  text: string,
  codeRanges: readonly CodeBlockRange[],
): Map<number, number> {
  const headings = new Map<number, number>();
  let line = 1;
  for (const token of Lexer.lex(text)) {
    const span = (token.raw.trimEnd().match(/\n/g) ?? []).length;
    if (token.type === "heading") {
      for (let n = line; n <= line + span; n++) headings.set(n, token.depth);
    }
    line += (token.raw.match(/\n/g) ?? []).length;
  }
  const [open = 1, close = 0] = frontMatterLines(text);
  for (let n = open; n <= close; n++) headings.delete(n);
  for (const range of codeRanges) {
    for (let n = range.start; n <= range.end; n++) headings.delete(n);
  }
  return headings;
}

/** Tags every `[data-content] [data-line]` row whose line is a heading with its level as
 * `data-md-heading`, clearing the rest. Re-run after every repaint (SourceView.svelte). */
export function tagHeadingRows(root: ParentNode, lines: ReadonlyMap<number, number>): void {
  for (const row of root.querySelectorAll<HTMLElement>("[data-content] [data-line]")) {
    const level = lines.get(Number(row.getAttribute("data-line")));
    if (level === undefined) row.removeAttribute("data-md-heading");
    else row.setAttribute("data-md-heading", String(level));
  }
}
