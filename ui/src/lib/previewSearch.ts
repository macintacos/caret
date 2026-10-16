// Vim `/` search over the preview's rendered text, split into segments a match may lie
// within. A block bounds a match: a new segment starts wherever a text node's nearest block
// changes. Prose whitespace collapses as CSS does: each run becomes one space, a `<br>`
// counts as whitespace, and a segment's leading and trailing whitespace is dropped. Code is
// literal line by line: inside a `pre` every newline ends the segment and nothing collapses.
// Matches are plain `SearchMatch`es in source-line coordinates; painting adds no markup.
import { findMatches, type SearchMatch } from "$lib/diffview/planSearch.ts";
import { highlightsSupported } from "$lib/diffview/searchHighlight.ts";
import type { PlanSourceMap } from "$lib/planSourceMap.ts";

const BLOCK = "p, li, h1, h2, h3, h4, h5, h6, th, td, pre, blockquote, div";
const WHITESPACE = /[ \t\n\r\f]/;
const ALL = "caret-preview-search";
const CURRENT = "caret-preview-search-current";

/** A searchable string; character `i` stands for the root's raw text `[starts[i], ends[i])`. */
interface Segment {
  text: string;
  starts: number[];
  ends: number[];
}

function collectSegments(root: Element): Segment[] {
  const segments: Segment[] = [];
  let current: Segment = { text: "", starts: [], ends: [] };
  let pendingSpace: { start: number; end: number } | null = null;
  let block: Element | null = null;
  let offset = 0;

  const flush = (): void => {
    if (current.text !== "") segments.push(current);
    current = { text: "", starts: [], ends: [] };
    pendingSpace = null;
  };
  const push = (char: string, start: number, end: number): void => {
    current.text += char;
    current.starts.push(start);
    current.ends.push(end);
  };
  const addSpace = (start: number, end: number): void => {
    if (pendingSpace === null) pendingSpace = { start, end };
    else pendingSpace.end = end;
  };
  const addProse = (char: string, at: number): void => {
    if (WHITESPACE.test(char)) {
      addSpace(at, at + 1);
      return;
    }
    if (pendingSpace !== null && current.text !== "") {
      push(" ", pendingSpace.start, pendingSpace.end);
    }
    pendingSpace = null;
    push(char, at, at + 1);
  };

  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const element = node instanceof Element ? node : node.parentElement;
    if (element === null || (node instanceof Element && node.tagName !== "BR")) continue;
    const nearest = element.closest(BLOCK);
    if (nearest !== block) flush();
    block = nearest;
    if (!(node instanceof Text)) {
      addSpace(offset, offset);
      continue;
    }
    const code = nearest?.tagName === "PRE";
    for (const char of node.data) {
      if (!code) addProse(char, offset);
      else if (char === "\n") flush();
      else push(char, offset, offset + 1);
      offset++;
    }
  }
  flush();
  return segments;
}

/** Every smartcase match of `query` in the preview's rendered text, in document order.
 * `line` is the source line the match starts on; `startCol`/`endCol` count from that
 * line's text in the preview (`PlanSourceMap.rangeOf(line)`'s start, a TextPoint column),
 * so a match may run on past its line's own text, across a soft break. */
export function findPreviewMatches(
  root: Element,
  map: PlanSourceMap,
  query: string,
): SearchMatch[] {
  const segments = collectSegments(root);
  // ponytail: O(matches × source lines) via the map's linear run scans; binary-search the runs if a one-letter query lags on a long plan.
  return findMatches(
    segments.map((s) => s.text),
    query,
  ).flatMap((hit) => {
    const segment = segments[hit.line - 1];
    const start = segment?.starts[hit.startCol];
    const end = segment?.ends[hit.endCol - 1];
    if (start === undefined || end === undefined) return [];
    const line = map.lineAtOffset(start);
    const origin = line === null ? null : map.offsetOfLine(line);
    if (line === null || origin === null) return [];
    return [{ line, startCol: start - origin, endCol: end - origin }];
  });
}

/** Ranges over `matches`, aligned with them (null where one no longer resolves), resolved in
 * one walk of the root's text. */
export function previewMatchRanges(
  root: Element,
  map: PlanSourceMap,
  matches: readonly SearchMatch[],
): (Range | null)[] {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  let seen = 0;
  // Matches ascend and never overlap, so the walk only moves forward. At a boundary between
  // two text nodes a start resolves into the later one and an end into the earlier one.
  const pointAt = (offset: number, side: "before" | "after"): [Text, number] | null => {
    for (; node !== null; node = walker.nextNode() as Text | null) {
      const end = seen + node.data.length;
      if (side === "after" ? offset < end : offset <= end) return [node, offset - seen];
      seen = end;
    }
    return null;
  };
  return matches.map((m) => {
    const origin = map.offsetOfLine(m.line);
    if (origin === null) return null;
    const start = pointAt(origin + m.startCol, "after");
    const end = pointAt(origin + m.endCol, "before");
    if (start === null || end === null) return null;
    const range = root.ownerDocument.createRange();
    range.setStart(...start);
    range.setEnd(...end);
    return range;
  });
}

/** Paints `caret-preview-search` (every match but the current) and
 * `caret-preview-search-current`; a no-op without the Highlight API. */
export function paintPreviewSearch(ranges: readonly (Range | null)[], currentIndex: number): void {
  if (!highlightsSupported()) return;
  const all = new Highlight();
  const current = new Highlight();
  ranges.forEach((range, i) => {
    if (range !== null) (i === currentIndex ? current : all).add(range);
  });
  CSS.highlights.set(ALL, all);
  CSS.highlights.set(CURRENT, current);
}

/** Removes both preview search highlights; a no-op without the Highlight API. */
export function clearPreviewSearch(): void {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(ALL);
  CSS.highlights.delete(CURRENT);
}
