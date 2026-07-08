// Fenced-code-block classification for the markdown plan view. The plan is
// rendered as line-numbered markdown source (SourceView.svelte), so a code block
// is just its fence lines plus the code between them. To decorate those rows as a
// distinct panel (EXC-692) the view needs to know which line numbers belong to a
// block; this module computes that, and tags the shadow-DOM rows the library
// paints. The DOM tagging lives here (not in the component) so it is unit-testable
// against a constructed fixture, mirroring lib/diffview/links.ts and bracket.ts.

// An opening/closing fence: 3+ backticks or tildes, ≤3 leading spaces per
// CommonMark. Deliberately the same stateless detection buildLinkLayer (links.ts)
// uses — every fence line toggles the in-code state — so the panel and the link
// layer agree on what counts as code, including on edge cases like nested fences.
const FENCE = /^\s*(`{3,}|~{3,})/;

/** A fenced code block's line span, 1-based and inclusive: `start` is the opening
 * fence line, `end` is the closing fence line (or the last line if unclosed). */
export interface CodeBlockRange {
  start: number;
  end: number;
}

/**
 * The fenced code blocks in `text`, as 1-based inclusive line ranges. Each fence
 * line toggles the in-code state; an opening fence with no matching close runs to
 * the end of the document. Line numbers index `text` split on "\n", matching the
 * view's per-line `data-line` attributes.
 */
export function codeBlockRanges(text: string): CodeBlockRange[] {
  const lines = text.split("\n");
  const ranges: CodeBlockRange[] = [];
  let start: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (!FENCE.test(lines[i] ?? "")) continue;
    const line = i + 1;
    if (start == null) {
      start = line; // opening fence
    } else {
      ranges.push({ start, end: line }); // closing fence
      start = null;
    }
  }
  if (start != null) ranges.push({ start, end: lines.length });
  return ranges;
}
