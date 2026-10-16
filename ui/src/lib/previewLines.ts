// Visual lines of the mounted preview: each line of text as wrapped on screen. Geometry
// comes from the client rects of text — element rects only to binary-search the
// reading-zone block, and the root's and scroller's to place the cursor band — read only in the
// blocks a lookup touches, so a cursor step never measures the whole document.
import { indexAtReadingZone } from "$lib/diffview/scroll.ts";
import { type Box, contentOrigin, defaultReader, type RectReader } from "$lib/geometry.ts";
import type { PlanSourceMap } from "$lib/planSourceMap.ts";

/** A cursor position on the preview: a source line, and a character offset into the
 * text that line renders (`PlanSourceMap.rangeOf(line)`). */
export interface TextPoint {
  line: number;
  column: number;
}

/** The client rects of a range's text, one per line fragment. */
export type RangeRects = (range: Range) => readonly Box[];

const clientRects: RangeRects = (range) => Array.from(range.getClientRects());

interface VisualLine extends Box {
  /** The earliest text node, in text order, with a rect on the line. */
  node: Text;
}

/** The first character, in text order, laid out on `line`. */
const lineStart = (line: VisualLine, read: RangeRects): [Text, number] => [
  line.node,
  firstOffsetFrom(line.node, line.top, read),
];

function rangeOver(node: Text, start: number, end: number): Range {
  const range = node.ownerDocument.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return range;
}

function textNodes(block: Element): Text[] {
  const nodes: Text[] = [];
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  return nodes;
}

function blockOf(root: Element, node: Node): Element | null {
  let child: Node | null = node;
  while (child !== null && child.parentNode !== root) child = child.parentNode;
  return child instanceof Element ? child : null;
}

const midOf = (box: Box): number => (box.top + box.bottom) / 2;

/** The first offset from `from` in `node` whose character has a rect, with that rect. */
function nextLaidOut(node: Text, from: number, read: RangeRects): [number, Box | undefined] {
  for (let k = from; k < node.data.length; k++) {
    const box = read(rangeOver(node, k, k + 1))[0];
    if (box !== undefined) return [k, box];
  }
  return [node.data.length, undefined];
}

/** The first offset in `node` with a rect laid out on the line at `top` or below. A
 * character with no rect (collapsed whitespace, a `pre` newline) is judged by the next
 * one that has a rect, which keeps the search monotonic. */
function firstOffsetFrom(node: Text, top: number, read: RangeRects): number {
  let lo = 0;
  let hi = node.data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const box = nextLaidOut(node, mid, read)[1];
    if (box === undefined || midOf(box) >= top) hi = mid;
    else lo = mid + 1;
  }
  return Math.min(nextLaidOut(node, lo, read)[0], node.data.length - 1);
}

interface TextRect {
  node: Text;
  /** The node's position in the block's text order. */
  index: number;
  rect: Box;
}

/** A block's text rects grouped by table cell; text outside a cell is one group. */
function cellGroups(block: Element, read: RangeRects): TextRect[][] {
  const groups = new Map<Element | null, TextRect[]>();
  textNodes(block).forEach((node, index) => {
    const cell = node.parentElement?.closest("td, th") ?? null;
    const key = cell !== null && block.contains(cell) ? cell : null;
    const group = groups.get(key) ?? [];
    groups.set(key, group);
    for (const rect of read(rangeOver(node, 0, node.data.length)))
      group.push({ node, index, rect });
  });
  return [...groups.values()].filter((group) => group.length > 0);
}

const extentOf = (group: readonly TextRect[]): number =>
  Math.max(...group.map((r) => r.rect.bottom)) - Math.min(...group.map((r) => r.rect.top));

/** The line whose midpoint is closest to `mid`. */
function nearest<L extends Box>(lines: readonly L[], mid: number): L | undefined {
  let best: L | undefined;
  for (const l of lines)
    if (best === undefined || Math.abs(midOf(l) - mid) < Math.abs(midOf(best) - mid)) best = l;
  return best;
}

interface LineDraft extends Box {
  node: Text;
  /** `node`'s position in the block's text order. */
  index: number;
  /** The cell group that seeded the line. */
  group: number;
}

/** The line `rect` joins: `previous` if it holds the rect's midpoint, else any line that
 * holds it, else the nearest line from another cell that it overlaps. A middle-aligned
 * cell's midpoint can fall in the gap between a taller neighbour's glyph rects; it still
 * belongs to a neighbour's line it overlaps. Within one cell, tightly set lines overlap
 * too, so overlap never merges a cell's own lines. */
function joinLine(
  lines: readonly LineDraft[],
  previous: LineDraft | undefined,
  rect: Box,
  group: number,
): LineDraft | undefined {
  const mid = midOf(rect);
  const holds = (l: Box) => mid >= l.top && mid < l.bottom;
  if (previous !== undefined && holds(previous)) return previous;
  return (
    lines.find(holds) ??
    nearest(
      lines.filter((l) => l.group !== group && rect.top < l.bottom && rect.bottom > l.top),
      mid,
    )
  );
}

// ponytail: every lookup re-reads its blocks' rects — the cursor's block up to five times
// a keypress (the step, the follow, the band, and in visual mode the selection's two
// bounds); cache per layout generation if a huge block makes held j stutter
/** The block's visual lines top to bottom, each with the first text node laid out on it. */
function visualLines(block: Element, read: RangeRects): VisualLine[] {
  const lines: LineDraft[] = [];
  // Tallest cells first: a middle-aligned shorter cell's rects then join its neighbour's
  // lines instead of seeding lines offset by half a line.
  const groups = cellGroups(block, read).sort((a, b) => extentOf(b) - extentOf(a));
  let previous: LineDraft | undefined;
  groups.forEach((cells, group) => {
    for (const { node, index, rect } of cells) {
      const line = joinLine(lines, previous, rect, group);
      if (line === undefined) {
        const { top, bottom, left, right } = rect;
        previous = { top, bottom, left, right, node, index, group };
        lines.push(previous);
      } else {
        previous = line;
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
        if (index < line.index) Object.assign(line, { node, index });
      }
    }
  });
  return lines
    .sort((a, b) => a.top - b.top)
    .map((l) => ({ top: l.top, bottom: l.bottom, left: l.left, right: l.right, node: l.node }));
}

/** The vertical midpoint of the first character at or after the point that has a rect. */
function charMid(block: Element, node: Text, offset: number, read: RangeRects): number | null {
  const nodes = textNodes(block);
  for (let i = nodes.indexOf(node), from = offset; i < nodes.length; i++, from = 0) {
    const box = nextLaidOut(nodes[i] as Text, from, read)[1];
    if (box !== undefined) return midOf(box);
  }
  return null;
}

/** The index of the line holding the point's character, else the nearest line; the last
 * when nothing at or after it is laid out. */
function lineIndexAt(
  block: Element,
  lines: readonly VisualLine[],
  [node, offset]: [Text, number],
  read: RangeRects,
): number {
  const mid = charMid(block, node, offset, read);
  if (mid === null) return lines.length - 1;
  const index = lines.findIndex((l) => mid >= l.top && mid < l.bottom);
  if (index !== -1) return index;
  const nearestLine = nearest(lines, mid);
  return nearestLine === undefined ? lines.length - 1 : lines.indexOf(nearestLine);
}

/** The nearest sibling block in `direction` that renders text, with its lines. */
function textBlockFrom(
  block: Element,
  direction: 1 | -1,
  read: RangeRects,
): { block: Element; lines: VisualLine[] } | null {
  for (
    let next = direction === 1 ? block.nextElementSibling : block.previousElementSibling;
    next !== null;
    next = direction === 1 ? next.nextElementSibling : next.previousElementSibling
  ) {
    const lines = visualLines(next, read);
    if (lines.length > 0) return { block: next, lines };
  }
  return null;
}

/** `p` as a DOM point, its column clamped to the line's text. */
function domPoint(root: Element, map: PlanSourceMap, p: TextPoint): [Text, number] | null {
  const range = map.rangeOf(p.line);
  if (range === null || !(range.startContainer instanceof Text)) return null;
  let remaining = Math.min(p.column, Math.max(range.toString().length - 1, 0));
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  walker.currentNode = range.startContainer;
  let node: Text = range.startContainer;
  let offset = range.startOffset;
  for (;;) {
    if (remaining < node.data.length - offset) return [node, offset + remaining];
    remaining -= node.data.length - offset;
    const next = walker.nextNode();
    if (next === null) return [node, node.data.length];
    node = next as Text;
    offset = 0;
  }
}

/** `domPoint`'s inverse. */
function textPoint(map: PlanSourceMap, node: Text, offset: number): TextPoint | null {
  const line = map.lineAt(node, offset);
  if (line === null) return null;
  const range = map.rangeOf(line);
  if (range === null) return { line, column: 0 };
  range.setEnd(node, offset);
  return { line, column: range.toString().length };
}

/** The start of the visual line `count` lines from `from`'s (negative steps up), clamped
 * to the first and last. Blocks with no text are skipped; `from` comes back unchanged
 * when it cannot be placed in the DOM. */
export function stepVisualLine(
  root: Element,
  map: PlanSourceMap,
  from: TextPoint,
  count: number,
  read: RangeRects = clientRects,
): TextPoint {
  const at = locate(root, map, from, read);
  if (at === null) return from;
  let { block, lines } = at;
  let targetIndex = at.index + count;
  while (targetIndex >= lines.length) {
    const next = textBlockFrom(block, 1, read);
    if (next === null) {
      targetIndex = lines.length - 1;
      break;
    }
    targetIndex -= lines.length;
    ({ block, lines } = next);
  }
  while (targetIndex < 0) {
    const prev = textBlockFrom(block, -1, read);
    if (prev === null) {
      targetIndex = 0;
      break;
    }
    ({ block, lines } = prev);
    targetIndex += lines.length;
  }
  return textPoint(map, ...lineStart(lines[targetIndex] as VisualLine, read)) ?? from;
}

/** Column 0 of the first line from `line` on that renders text, else of the last one
 * before it; null when no line of the `lineCount` renders text. */
export function pointForLine(
  map: PlanSourceMap,
  line: number,
  lineCount: number,
): TextPoint | null {
  for (let l = line; l <= lineCount; l++)
    if (map.rangeOf(l) !== null) return { line: l, column: 0 };
  for (let l = line - 1; l >= 1; l--) if (map.rangeOf(l) !== null) return { line: l, column: 0 };
  return null;
}

/** The start of the document's last visual line, read from the last block with text. */
export function lastVisualLine(
  root: Element,
  map: PlanSourceMap,
  read: RangeRects = clientRects,
): TextPoint | null {
  for (let block = root.lastElementChild; block !== null; block = block.previousElementSibling) {
    const last = visualLines(block, read).at(-1);
    if (last !== undefined) return textPoint(map, ...lineStart(last, read));
  }
  return null;
}

/** The start of the first visual line whose bottom clears the reading zone of a scroller
 * whose top edge is at `scrollerTop`: from the reading-zone block on, the first visual line
 * below the zone, else the document's last. */
export function readingPoint(
  root: Element,
  map: PlanSourceMap,
  scrollerTop: number,
  read: RangeRects = clientRects,
  rect: RectReader = defaultReader,
): TextPoint | null {
  const blocks = root.children;
  const firstBlock =
    indexAtReadingZone(blocks.length, (k) => rect(blocks[k] as Element).bottom, scrollerTop) ??
    blocks.length - 1;
  let last: VisualLine | undefined;
  for (let k = Math.max(firstBlock, 0); k < blocks.length; k++) {
    const lines = visualLines(blocks[k] as Element, read);
    const belowZone = indexAtReadingZone(
      lines.length,
      (j) => (lines[j] as VisualLine).bottom,
      scrollerTop,
    );
    if (belowZone !== null)
      return textPoint(map, ...lineStart(lines[belowZone] as VisualLine, read));
    last = lines.at(-1) ?? last;
  }
  return last === undefined ? null : textPoint(map, ...lineStart(last, read));
}

/** The box of the visual line holding `p`'s character. */
export function visualLineBox(
  root: Element,
  map: PlanSourceMap,
  p: TextPoint,
  read: RangeRects = clientRects,
): Box | null {
  const at = locate(root, map, p, read);
  return (
    at && { top: at.line.top, bottom: at.line.bottom, left: at.line.left, right: at.line.right }
  );
}

/** `p`'s block, that block's visual lines, and the one holding `p`; null when `p` cannot
 * be placed or its block lays out no text. */
function locate(
  root: Element,
  map: PlanSourceMap,
  p: TextPoint,
  read: RangeRects,
): { block: Element; lines: VisualLine[]; index: number; line: VisualLine } | null {
  const point = domPoint(root, map, p);
  const block = point === null ? null : blockOf(root, point[0]);
  if (point === null || block === null) return null;
  const lines = visualLines(block, read);
  const index = lineIndexAt(block, lines, point, read);
  const line = lines[index];
  return line === undefined ? null : { block, lines, index, line };
}

/** The table row holding `line`, inside `block`. A row is one source line, and its
 * middle-aligned cells put DOM order out of step with visual order. */
function rowOf(block: Element, line: VisualLine): Element | null {
  const row = line.node.parentElement?.closest("tr");
  return row != null && block.contains(row) ? row : null;
}

/** The text of the visual lines from `from`'s through `to`'s, `from` not after `to`: from
 * the first character of `from`'s line to the first of the line after `to`'s, or to the
 * end of `to`'s block. Null when either point cannot be placed. */
export function visualLineRange(
  root: Element,
  map: PlanSourceMap,
  from: TextPoint,
  to: TextPoint,
  read: RangeRects = clientRects,
): Range | null {
  const first = locate(root, map, from, read);
  const last = locate(root, map, to, read);
  if (first === null || last === null) return null;
  const range = root.ownerDocument.createRange();
  const startRow = rowOf(first.block, first.line);
  if (startRow !== null) range.setStart(startRow, 0);
  else range.setStart(...lineStart(first.line, read));
  const endRow = rowOf(last.block, last.line);
  const next = last.lines[last.index + 1];
  if (endRow !== null) range.setEnd(endRow, endRow.childNodes.length);
  else if (next === undefined) range.setEnd(last.block, last.block.childNodes.length);
  else range.setEnd(...lineStart(next, read));
  return range;
}

/** A cursor band's box in a scroller's content coordinates. */
export interface BandBox {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** The band over `p`'s visual line: across `root`'s width, in `scroller`'s content
 * coordinates, padded to `lineHeight` (the root's) so lines set at it abut — lines set at
 * another line-height, such as headings and code, do not exactly. */
export function cursorBand(
  root: Element,
  scroller: Element,
  map: PlanSourceMap,
  p: TextPoint,
  lineHeight: number,
  read: RangeRects = clientRects,
  rect: RectReader = defaultReader,
): BandBox | null {
  const box = visualLineBox(root, map, p, read);
  if (box === null) return null;
  const pad = lineHeight > 0 ? Math.max(0, lineHeight - (box.bottom - box.top)) / 2 : 0;
  const origin = contentOrigin(scroller, rect(scroller));
  const rootRect = rect(root);
  return {
    top: box.top - pad - origin.top,
    left: rootRect.left - origin.left,
    width: rootRect.right - rootRect.left,
    height: box.bottom - box.top + 2 * pad,
  };
}
