// Visual lines of the mounted preview: each line of text as wrapped on screen. Geometry
// comes from the client rects of text, never of block elements, and is read only in the
// blocks a lookup touches, so a cursor step never measures the whole document.
import { indexAtReadingZone } from "$lib/diffview/scroll.ts";
import { READING_ZONE_SLOP, SCROLL_OFFSET_TOP } from "$lib/layout.ts";
import type { PlanSourceMap } from "$lib/planSourceMap.ts";

/** A cursor position on the preview: a source line, and a character offset into the
 * text that line renders (`PlanSourceMap.rangeOf(line)`). */
export interface TextPoint {
  line: number;
  column: number;
}

export type Box = { top: number; bottom: number; left: number; right: number };

/** The client rects of a range's text, one per line fragment. */
export type RangeRects = (range: Range) => readonly Box[];

const clientRects: RangeRects = (range) => Array.from(range.getClientRects());

type BlockBottom = (block: Element) => number;

const boundingBottom: BlockBottom = (block) => block.getBoundingClientRect().bottom;

interface VisualLine extends Box {
  /** The first character, in text order, laid out on the line. */
  start: [Text, number];
}

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

// ponytail: per-keypress block measurement — cache per layout generation if a huge highlighted code block makes held j stutter
function visualLines(block: Element, read: RangeRects): VisualLine[] {
  const lines: (Box & { node: Text })[] = [];
  for (const node of textNodes(block)) {
    for (const rect of read(rangeOver(node, 0, node.data.length))) {
      const mid = midOf(rect);
      const line = lines.find((l) => mid >= l.top && mid < l.bottom);
      if (line === undefined) {
        lines.push({
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
          node,
        });
      } else {
        line.left = Math.min(line.left, rect.left);
        line.right = Math.max(line.right, rect.right);
      }
    }
  }
  return lines
    .sort((a, b) => a.top - b.top)
    .map(({ node, ...box }) => ({ ...box, start: [node, firstOffsetFrom(node, box.top, read)] }));
}

/** The vertical midpoint of the first character at or after the point that has a rect. */
function charMid(block: Element, node: Text, offset: number, read: RangeRects): number | null {
  const nodes = textNodes(block);
  for (let i = nodes.indexOf(node), from = offset; i < nodes.length; i++, from = 0) {
    const text = nodes[i] as Text;
    for (let k = from; k < text.data.length; k++) {
      const box = read(rangeOver(text, k, k + 1))[0];
      if (box !== undefined) return midOf(box);
    }
  }
  return null;
}

function lineIndexAt(
  block: Element,
  lines: readonly VisualLine[],
  [node, offset]: [Text, number],
  read: RangeRects,
): number {
  const mid = charMid(block, node, offset, read);
  const index = mid === null ? -1 : lines.findIndex((l) => mid >= l.top && mid < l.bottom);
  return index === -1 ? lines.length - 1 : index;
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
function domPoint(map: PlanSourceMap, p: TextPoint): [Text, number] | null {
  const range = map.rangeOf(p.line);
  if (range === null || !(range.startContainer instanceof Text)) return null;
  let remaining = Math.min(p.column, Math.max(range.toString().length - 1, 0));
  const doc = range.startContainer.ownerDocument;
  const walker = doc.createTreeWalker(doc, NodeFilter.SHOW_TEXT);
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

function textPoint(map: PlanSourceMap, node: Text, offset: number): TextPoint | null {
  const line = map.lineAt(node, offset);
  if (line === null) return null;
  const range = map.rangeOf(line);
  if (range === null) return { line, column: 0 };
  range.setEnd(node, offset);
  return { line, column: range.toString().length };
}

/** The start of the visual line `count` lines from `from`'s (negative steps up), clamped
 * to the first and last. Blocks with no text are skipped. */
export function stepVisualLine(
  root: Element,
  map: PlanSourceMap,
  from: TextPoint,
  count: number,
  read: RangeRects = clientRects,
): TextPoint {
  const point = domPoint(map, from);
  let block = point === null ? null : blockOf(root, point[0]);
  if (point === null || block === null) return from;
  let lines = visualLines(block, read);
  if (lines.length === 0) return from;
  let target = lineIndexAt(block, lines, point, read) + count;
  while (target >= lines.length) {
    const next = textBlockFrom(block, 1, read);
    if (next === null) {
      target = lines.length - 1;
      break;
    }
    target -= lines.length;
    ({ block, lines } = next);
  }
  while (target < 0) {
    const prev = textBlockFrom(block, -1, read);
    if (prev === null) {
      target = 0;
      break;
    }
    ({ block, lines } = prev);
    target += lines.length;
  }
  return textPoint(map, ...(lines[target] as VisualLine).start) ?? from;
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
    if (last !== undefined) return textPoint(map, ...last.start);
  }
  return null;
}

/** The start of the first visual line at or below the reading zone of a scroller whose
 * top edge is at `scrollerTop`, in the block there or the next with text. */
export function readingPoint(
  root: Element,
  map: PlanSourceMap,
  scrollerTop: number,
  read: RangeRects = clientRects,
  blockBottom: BlockBottom = boundingBottom,
): TextPoint | null {
  const blocks = root.children;
  const first =
    indexAtReadingZone(blocks.length, (k) => blockBottom(blocks[k] as Element), scrollerTop) ??
    blocks.length - 1;
  const zone = scrollerTop + SCROLL_OFFSET_TOP + READING_ZONE_SLOP;
  for (let k = Math.max(first, 0); k < blocks.length; k++) {
    const lines = visualLines(blocks[k] as Element, read);
    const line = lines.find((l) => l.top >= zone) ?? lines.at(-1);
    if (line !== undefined) return textPoint(map, ...line.start);
  }
  return null;
}

/** The box of the visual line holding `p`'s character. */
export function visualLineBox(
  root: Element,
  map: PlanSourceMap,
  p: TextPoint,
  read: RangeRects = clientRects,
): Box | null {
  const point = domPoint(map, p);
  const block = point === null ? null : blockOf(root, point[0]);
  if (point === null || block === null) return null;
  const lines = visualLines(block, read);
  const line = lines[lineIndexAt(block, lines, point, read)];
  return line === undefined
    ? null
    : { top: line.top, bottom: line.bottom, left: line.left, right: line.right };
}
