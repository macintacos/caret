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

/**
 * Tags the source view's content-column rows so the code-block panel CSS
 * (CARET_OVERRIDES in coreStyles.ts) can style them: `data-code-line` on every
 * `[data-content] > [data-line]` cell inside a block, plus `data-code-start` /
 * `data-code-end` on each block's first / last line. The library owns these rows
 * and repaints them, so this is re-run after every repaint (see SourceView.svelte);
 * it is idempotent and clears rows no longer in a block. Only content rows are
 * touched — the gutter number cells keep their default styling.
 */
export function tagCodeBlockRows(root: ParentNode, ranges: CodeBlockRange[]): void {
  const startLines = new Set(ranges.map((r) => r.start));
  const endLines = new Set(ranges.map((r) => r.end));
  const inCode = (n: number) => ranges.some((r) => n >= r.start && n <= r.end);
  for (const row of root.querySelectorAll<HTMLElement>("[data-content] > [data-line]")) {
    const n = Number(row.getAttribute("data-line"));
    const code = Number.isFinite(n) && inCode(n);
    row.toggleAttribute("data-code-line", code);
    row.toggleAttribute("data-code-start", code && startLines.has(n));
    row.toggleAttribute("data-code-end", code && endLines.has(n));
  }
}
