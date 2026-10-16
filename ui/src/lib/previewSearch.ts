// Vim `/` search over the preview's rendered text, split into segments a match may lie
// within. A block bounds a match: a new segment starts wherever a text node's nearest block
// changes. Prose whitespace collapses as CSS does: each run becomes one space, a `<br>`
// counts as whitespace, and a segment's leading and trailing whitespace is dropped. Code is
// literal line by line: inside a `pre` every newline ends the segment and nothing collapses.
// Matches are plain `SearchMatch`es in source-line coordinates; painting adds no markup.
import { findMatches, type SearchMatch } from "$lib/diffview/planSearch.ts";
import { highlightsSupported } from "$lib/diffview/searchHighlight.ts";
import type { PlanSourceMap } from "$lib/planSourceMap.ts";

// div covers each block's wrapper and the root itself, so closest() never leaves the root.
const BLOCK =
  "p, li, h1, h2, h3, h4, h5, h6, th, td, pre, blockquote, div, dl, dt, dd, details, summary, " +
  "section, article, aside, header, footer, figure, figcaption, caption, address";
// CSS's collapsible whitespace; \s would also collapse NBSP.
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
    const nearestBlock = element.closest(BLOCK);
    if (nearestBlock !== block) flush();
    block = nearestBlock;
    if (!(node instanceof Text)) {
      addSpace(offset, offset);
      continue;
    }
    const inCode = nearestBlock?.tagName === "PRE";
    for (const char of node.data) {
      if (!inCode) addProse(char, offset);
      else if (char === "\n") flush();
      else push(char, offset, offset + 1);
      offset++;
    }
  }
  flush();
  return segments;
}

function toMatches(segments: Segment[], map: PlanSourceMap, query: string): SearchMatch[] {
  return findMatches(
    segments.map((s) => s.text),
    query,
  ).flatMap((hit) => {
    const segmentIndex = hit.line - 1;
    const segment = segments[segmentIndex];
    const start = segment?.starts[hit.startCol];
    const end = segment?.ends[hit.endCol - 1];
    if (start === undefined || end === undefined) return [];
    const line = map.lineAtOffset(start);
    const origin = line === null ? null : map.offsetOfLine(line);
    if (line === null || origin === null) return [];
    return [{ line, startCol: start - origin, endCol: end - origin }];
  });
}

export interface PreviewSearch {
  /** Every smartcase match of `query` in the preview's rendered text, in document order.
   * `line` is the source line the match starts on; `startCol`/`endCol` count from that
   * line's text in the preview (`PlanSourceMap.offsetOfLine`, a TextPoint column), so a
   * match may run on past its line's own text, across a soft break. */
  find(query: string): SearchMatch[];
}

/** Search over `root`'s text, which `map` was built from. Build once per map: the text is
 * fixed per version, so the segments are collected on the first `find` and kept. */
export function createPreviewSearch(root: Element, map: PlanSourceMap): PreviewSearch {
  let segments: Segment[] | undefined;
  return {
    find: (query) => {
      segments ??= collectSegments(root);
      return toMatches(segments, map, query);
    },
  };
}

/** Opens every closed `<details>` hiding `match`'s start, as find-in-page does; a
 * `<details>` whose own `<summary>` holds the start stays closed, since a summary shows. */
export function openMatchDetails(root: Element, map: PlanSourceMap, match: SearchMatch): void {
  const startElement = previewMatchRanges(root, map, [match])[0]?.startContainer.parentElement;
  for (let details = startElement?.closest("details"); details && root.contains(details); ) {
    const summary = details.querySelector(":scope > summary");
    if (!details.open && !summary?.contains(startElement ?? null)) details.open = true;
    details = details.parentElement?.closest("details");
  }
}

/** Ranges over `matches`, aligned with them (null where one no longer resolves). */
export function previewMatchRanges(
  root: Element,
  map: PlanSourceMap,
  matches: readonly SearchMatch[],
): (Range | null)[] {
  return matches.map((match) => {
    const start = map.domPoint({ line: match.line, column: match.startCol }, "after");
    const end = map.domPoint({ line: match.line, column: match.endCol }, "before");
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
