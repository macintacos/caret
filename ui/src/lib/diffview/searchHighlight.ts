// Paints the vim `/` search matches (EXC-832) over the source view's shadow rows
// using the native CSS Custom Highlight API — no DOM mutation, so it never fights
// the library's row repaints (unlike wrapping matched text in <mark>, which would
// trip SourceView's MutationObserver). Two named highlights register on the
// document-global CSS.highlights registry: `caret-search` (every non-current match,
// a dim --mark wash) and `caret-search-current` (the active match, the stronger
// --mark-active wash);
// coreStyles.ts styles them via ::highlight() rules adopted into the same shadow
// root. Feature-detected: an engine without the API is a clean no-op, so the line
// cursor still moves on commit/n/N even when highlights can't paint. Line/column
// numbering matches @pierre/diffs `data-line` + the source line text — the same
// space planSearch.ts computes matches in.

import type { SearchMatch } from "$lib/diffview/planSearch.ts";

const ALL = "caret-search";
const CURRENT = "caret-search-current";

/** Whether the CSS Custom Highlight API is available (Chromium/WebKit; absent in
 * happy-dom and pre-2022 engines). */
function highlightsSupported(): boolean {
  return typeof Highlight === "function" && typeof CSS !== "undefined" && CSS.highlights != null;
}

/**
 * A DOM Range covering the half-open source columns `[startCol, endCol)` of `rowEl`,
 * mapping the column offsets onto the row's text nodes (shiki emits the line as one
 * or more token spans). Walks text nodes accumulating length — the same
 * running-length technique `tagFileRefTokens` uses — so it stays correct across
 * multiple tokens (e.g. an inline-code split). Returns null when the span can't be
 * resolved (columns past the row's text, or an empty row).
 */
export function rangeForSpan(rowEl: Element, startCol: number, endCol: number): Range | null {
  const doc = rowEl.ownerDocument;
  const walker = doc.createTreeWalker(rowEl, NodeFilter.SHOW_TEXT);
  let col = 0;
  let start: { node: Node; offset: number } | undefined;
  let end: { node: Node; offset: number } | undefined;
  for (let node = walker.nextNode(); node != null; node = walker.nextNode()) {
    const len = node.textContent?.length ?? 0;
    const nodeStart = col;
    const nodeEnd = col + len;
    if (start === undefined && startCol >= nodeStart && startCol <= nodeEnd) {
      start = { node, offset: startCol - nodeStart };
    }
    if (end === undefined && endCol >= nodeStart && endCol <= nodeEnd) {
      end = { node, offset: endCol - nodeStart };
    }
    col = nodeEnd;
  }
  if (start === undefined || end === undefined) return null;
  const range = doc.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/**
 * Registers the two search highlights over `matches` in `root` (the source view's
 * shadow root), painting `currentIndex` as the active match and every other match
 * as the underlay. Both are cleared first, so a shrinking match set or a moved
 * current index never leaves a stale highlight. Ranges are rebuilt on every call,
 * so this is the caller's re-paint hook after a library row repaint (SourceView's
 * tag()). A no-op when the API is unavailable.
 */
export function paintSearchHighlights(
  root: ParentNode,
  matches: SearchMatch[],
  currentIndex: number,
): void {
  if (!highlightsSupported()) return;
  const all = new Highlight();
  const current = new Highlight();
  matches.forEach((m, i) => {
    const rowEl = root.querySelector(`[data-line="${m.line}"]`);
    if (rowEl === null) return;
    const range = rangeForSpan(rowEl, m.startCol, m.endCol);
    if (range === null) return;
    if (i === currentIndex) current.add(range);
    else all.add(range);
  });
  CSS.highlights.set(ALL, all);
  CSS.highlights.set(CURRENT, current);
}

/** Removes both search highlights from the global registry. A no-op when the API
 * is unavailable. */
export function clearSearchHighlights(): void {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(ALL);
  CSS.highlights.delete(CURRENT);
}
