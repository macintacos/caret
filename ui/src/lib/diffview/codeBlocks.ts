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
      start = line;
    } else {
      ranges.push({ start, end: line });
      start = null;
    }
  }
  if (start != null) ranges.push({ start, end: lines.length });
  return ranges;
}

/**
 * The code inside a fenced block, with the fence lines stripped — what a "copy"
 * affordance should place on the clipboard. Interior blank lines and indentation
 * are preserved. The opening fence (line `start`) is always dropped; the closing
 * fence is dropped only when present (an unclosed block keeps its last line).
 */
export function codeBlockText(text: string, range: CodeBlockRange): string {
  const lines = text.split("\n").slice(range.start - 1, range.end);
  if (lines.length > 0 && FENCE.test(lines[0] ?? "")) lines.shift();
  if (lines.length > 0 && FENCE.test(lines[lines.length - 1] ?? "")) lines.pop();
  return lines.join("\n");
}

// A token that is only fence markers and whitespace — never the language tag.
const FENCE_ONLY = /^[`~\s]*$/;

/**
 * Tags the language token on a fence line's row so the panel CSS can nudge it to
 * the row's vertical center. A highlighted fence line renders as separate shiki
 * spans once the theme splits the marker and language colors, but shiki attaches
 * no classes; the language is the first token whose text is neither blank nor all
 * fence markers. No-op when the row carries no such token (a bare fence).
 */
function tagLanguageToken(row: Element): void {
  for (const span of row.children) {
    const text = span.textContent ?? "";
    if (text.trim() !== "" && !FENCE_ONLY.test(text)) {
      span.setAttribute("data-code-lang", "");
      return;
    }
  }
}

/** Tags the fence-marker token on a fence line's row (the first span that is
 * markers alone) so the panel CSS can draw the marker chip on it, and nudge the
 * closing glyphs down to center.
 *
 * Two conditions, each ruling out a different mis-tag. The row's own text must be a
 * fence line: an unclosed block ends at the last line of the document rather than at
 * a fence (codeBlockRanges), so its `data-code-end` row is ordinary prose, and
 * scanning that for a marker glyph would dress an inline backtick as a delimiter.
 * The span must then be markers and whitespace ALONE — the same FENCE_ONLY test
 * tagLanguageToken inverts — so that if shiki ever merges ``` and its language into
 * one token, the chip is skipped rather than painted under the language tag. */
function tagFenceToken(row: Element): void {
  if (!FENCE.test(row.textContent ?? "")) return;
  for (const span of row.children) {
    const text = span.textContent ?? "";
    if (/[`~]/.test(text) && FENCE_ONLY.test(text)) {
      span.setAttribute("data-code-fence", "");
      return;
    }
  }
}

/**
 * Tags the source view's content-column rows so the code-block panel CSS
 * (CARET_OVERRIDES in coreStyles.ts) can style them: `data-code-line` on every
 * `[data-content] > [data-line]` cell inside a block, plus `data-code-start` /
 * `data-code-end` on each block's first / last line. Also tags the two fence-line
 * token kinds the panel CSS styles: `data-code-lang` on the opening line's language
 * tag, and `data-code-fence` on each fence line's markers. The panel CSS shifts
 * the language tag and the closing markers to their row's vertical center
 * (EXC-692). The library owns these rows and repaints them, so this is re-run after
 * every repaint (see SourceView.svelte); it is idempotent and clears rows and
 * tokens no longer in a block. Content rows carry the panel tags (`data-code-line`
 * + start/end); the gutter number cells get only `data-code-line`, so the cursor
 * and hover band can brighten the gutter half to match the content on a code row.
 */
export function tagCodeBlockRows(root: ParentNode, ranges: CodeBlockRange[]): void {
  const startLines = new Set(ranges.map((r) => r.start));
  const endLines = new Set(ranges.map((r) => r.end));
  const inCode = (n: number) => ranges.some((r) => n >= r.start && n <= r.end);
  // Clear stale token tags before re-tagging: a repaint rebuilds the spans, and a
  // content change can move which line is a fence, so any prior tag may be wrong.
  for (const tagged of root.querySelectorAll(
    "[data-content] [data-code-lang], [data-content] [data-code-fence]",
  )) {
    tagged.removeAttribute("data-code-lang");
    tagged.removeAttribute("data-code-fence");
  }
  // Descendant, not child: an overflowing block's rows get moved into a scroll card
  // (codeBlockScroll.ts), so on the repaint pass after wrapping they are no longer direct
  // children of [data-content]. A descendant query re-tags them wherever they sit.
  for (const row of root.querySelectorAll<HTMLElement>("[data-content] [data-line]")) {
    const n = Number(row.getAttribute("data-line"));
    const code = Number.isFinite(n) && inCode(n);
    row.toggleAttribute("data-code-line", code);
    row.toggleAttribute("data-code-start", code && startLines.has(n));
    row.toggleAttribute("data-code-end", code && endLines.has(n));
    if (code && startLines.has(n)) tagLanguageToken(row);
    if (code && (startLines.has(n) || endLines.has(n))) tagFenceToken(row);
  }
  // Also tag each code line's gutter number cell (line numbers only, no
  // start/end): the panel stays content-only, but the tag lets the focused-line
  // cursor and hover band brighten the gutter half to match the content on a code
  // row (coreStyles.ts) — CSS can't relate a gutter cell to its content sibling
  // across the two grid columns, so the tag is the only bridge.
  for (const cell of root.querySelectorAll<HTMLElement>("[data-gutter] [data-column-number]")) {
    const n = Number(cell.getAttribute("data-column-number"));
    cell.toggleAttribute("data-code-line", Number.isFinite(n) && inCode(n));
  }
}
