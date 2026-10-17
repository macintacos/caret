// The preview's comments: the slot each line's comments render in, the gap a slot holds
// open in the text under the row they end on, the slot's box, and the highlight over a
// comment's rendered text. Slots live outside the preview root, so it holds only the
// rendered HTML the source map and `planPlace` index, and the gaps, which hold no text.

import { highlightsSupported } from "$lib/diffview/searchHighlight.ts";
import { contentOrigin, defaultReader, type RectReader } from "$lib/geometry.ts";
import type { SourceSpan } from "$lib/planMarkdown.ts";
import type { PlanSourceMap, TextPoint } from "$lib/planSourceMap.ts";
import { lineAfter, type RangeRects, textEnds } from "$lib/previewLines.ts";

const HIGHLIGHT = "caret-comment-span";

/** The index of the block a comment ending on 1-based `line` renders after: the block
 * holding it, the one before a gap line or past the end, the first for a line above every
 * block; null with no blocks — where the source view's card for that line sits;
 * `blockIndexForLine` sends a gap line forward instead. */
export function commentSlotIndex(blocks: readonly SourceSpan[], line: number): number | null {
  return blocks.length === 0
    ? null
    : Math.max(
        0,
        blocks.findLastIndex((b) => b.start <= line),
      );
}

/** `items` grouped by line, ascending, keeping input order on a line: one slot per line,
 * as the source view has one annotation row per line. */
export function groupBySlot<T extends { line: number }>(
  items: readonly T[],
): { line: number; items: T[] }[] {
  const slots = new Map<number, T[]>();
  for (const item of [...items].sort((a, b) => a.line - b.line)) {
    const bucket = slots.get(item.line);
    if (bucket) bucket.push(item);
    else slots.set(item.line, [item]);
  }
  return [...slots].map(([line, slotItems]) => ({ line, items: slotItems }));
}

/** The rendered text of each line in `span` that produced any, in order. */
export function spanRanges(map: PlanSourceMap, span: SourceSpan): Range[] {
  const ranges: Range[] = [];
  for (let line = span.start; line <= span.end; line++) {
    const range = map.rangeOf(line);
    if (range !== null) ranges.push(range);
  }
  return ranges;
}

/** Paints `ranges` as the comment highlight (`caret-comment-span`), replacing the last; a
 * no-op without the Custom Highlight API. */
export function paintCommentHighlight(ranges: readonly Range[]): void {
  if (!highlightsSupported()) return;
  CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
}

/** Removes the comment highlight; a no-op without the Custom Highlight API. */
export function clearCommentHighlight(): void {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(HIGHLIGHT);
}

/** Where a slot's gap opens: before the first character of a visual line, `lineAfter`'s,
 * or after all of a block's content (its `root.children` position). */
export type SlotGap = { before: TextPoint } | { block: number };

/** A comment slot's box in a scroller's content coordinates, with the inline padding that
 * sets its content over its block's. */
export type SlotBox = {
  top: number;
  left: number;
  width: number;
  padStart: number;
  padEnd: number;
};

/** Where the slot for comments on `span` opens its gap: under the visual row its text ends
 * on, the row `linesBand` ends on, else — on its block's last row — after the block its
 * text ends in, or with no text after `commentSlotIndex`'s block for its end. */
export function slotGap(
  root: Element,
  map: PlanSourceMap,
  blocks: readonly SourceSpan[],
  span: SourceSpan,
  read?: RangeRects,
): SlotGap | null {
  const before = lineAfter(root, map, span, read);
  if (before !== null) return { before };
  const block = commentSlotIndex(blocks, textEnds(map, span)?.[1].line ?? span.end);
  return block === null ? null : { block };
}

const GAP = "data-preview-gap";

const isGap = (node: Node | null): node is HTMLElement =>
  node instanceof HTMLElement && node.hasAttribute(GAP);

/** A node that puts nothing on a row of its own: a gap, a source-line marker or other
 * element with no text (a task's box), or whitespace. */
const isBlank = (node: Node): boolean => (node.textContent ?? "").trim() === "";

/** The boundary a gap opens at: between two nodes, or inside a text node, to split. */
type GapPoint = { parent: Node; next: Node | null } | { text: Text; offset: number };

const isMarker = (node: Node | null): node is Element =>
  node instanceof Element && node.hasAttribute("data-source-line");

/** The boundary before `node`, moved out of each element it opens — so a list item's gap
 * opens between the items, not under the next one's bullet — but never out of its block,
 * and before the source-line markers that lead it: a code block's must stay directly
 * before its `pre`. */
function boundaryBefore(root: Element, node: Node): GapPoint | null {
  let next = node;
  for (;;) {
    const parent = next.parentNode;
    if (parent === null) return null;
    let leads = true;
    for (let n = next.previousSibling; n !== null && leads; n = n.previousSibling)
      leads = isBlank(n);
    if (parent.parentNode === root || !leads) {
      while (isMarker(next.previousSibling)) next = next.previousSibling;
      return { parent, next };
    }
    next = parent;
  }
}

/** Where `at` opens: a table row's gap before that row, never between its cells, whichever
 * cell its first line starts in; a split inside the next row's text elsewhere. */
function gapPoint(root: Element, map: PlanSourceMap, at: SlotGap): GapPoint | null {
  if ("block" in at) {
    const block = root.children[at.block];
    return block === undefined ? null : { parent: block, next: null };
  }
  const point = map.clampedPoint(at.before);
  if (point === null) return null;
  const [text, offset] = point;
  const row = text.parentElement?.closest("tr");
  if (row != null && root.contains(row)) return boundaryBefore(root, row);
  return offset > 0 ? { text, offset } : boundaryBefore(root, text);
}

/** The first node after `gap` that is not a gap. */
function pastGaps(gap: Node): Node | null {
  let next = gap.nextSibling;
  while (isGap(next)) next = next.nextSibling;
  return next;
}

/** Puts `gap` at `point`, splitting the text there; gaps already at that boundary stack in
 * key order. */
function place(gap: HTMLElement, key: number, point: GapPoint): void {
  const next = "text" in point ? point.text.splitText(point.offset) : point.next;
  const parent = "text" in point ? next?.parentNode : point.parent;
  if (parent == null) return;
  let before = next;
  for (
    let prev = next === null ? parent.lastChild : next.previousSibling;
    isGap(prev) && prev !== gap && Number(prev.getAttribute(GAP)) > key;
    prev = prev.previousSibling
  )
    before = prev;
  parent.insertBefore(gap, before);
}

/** The gaps the preview's comment slots hold open in its text, one per slot, keyed by the
 * slot's line and as tall as the slot: under the row its comments end on, or after their
 * block. A gap holds no text, so the source map, search and the visual lines read past it.
 * Splitting a text node to open one keeps the root's text in order, as the source map
 * requires. `set` writes only what changed, so a re-sync over a settled layout leaves the
 * DOM, and the layout signal that observes it, alone. */
export function createSlotGaps(root: Element): {
  set(map: PlanSourceMap, gaps: ReadonlyMap<number, { at: SlotGap; height: number }>): void;
  boxes(scroller: HTMLElement, read?: RectReader): Map<number, SlotBox>;
  release(): void;
} {
  const open = new Map<number, HTMLElement>();
  const close = (key: number): void => {
    open.get(key)?.remove();
    open.delete(key);
  };

  const set = (
    map: PlanSourceMap,
    gaps: ReadonlyMap<number, { at: SlotGap; height: number }>,
  ): void => {
    for (const key of [...open.keys()]) if (!gaps.has(key)) close(key);
    for (const [key, { at, height }] of [...gaps].sort(([a], [b]) => a - b)) {
      const point = gapPoint(root, map, at);
      if (point === null) {
        close(key);
        continue;
      }
      let gap = open.get(key);
      if (gap === undefined || !root.contains(gap)) {
        gap = root.ownerDocument.createElement("span");
        gap.setAttribute(GAP, String(key));
        gap.setAttribute("aria-hidden", "true");
        open.set(key, gap);
      }
      const sits =
        "parent" in point && gap.parentNode === point.parent && pastGaps(gap) === point.next;
      if (!sits) place(gap, key, point);
      const px = `${height}px`;
      if (gap.style.height !== px) gap.style.height = px;
    }
  };

  /** Each open gap's slot box in `scroller` content coordinates: at the gap's top, across
   * `root` as the rows above and below it run, padded in to its block's sides. */
  const boxes = (scroller: HTMLElement, read: RectReader = defaultReader): Map<number, SlotBox> => {
    const origin = contentOrigin(scroller, read(scroller));
    const across = read(root);
    const out = new Map<number, SlotBox>();
    for (const [key, gap] of open) {
      let block: Element | null = gap;
      while (block !== null && block.parentElement !== root) block = block.parentElement;
      if (block === null) continue;
      const box = read(block);
      out.set(key, {
        top: read(gap).top - origin.top,
        left: across.left - origin.left,
        width: across.right - across.left,
        padStart: box.left - across.left,
        padEnd: across.right - box.right,
      });
    }
    return out;
  };

  const release = (): void => {
    for (const key of [...open.keys()]) close(key);
  };

  return { set, boxes, release };
}

const SLOT_SIDES = ["top", "left", "width", "padStart", "padEnd"] as const;

/** Whether `a` and `b` place the same blocks at exactly the same boxes. */
export function sameSlotBoxes(
  a: ReadonlyMap<number, SlotBox>,
  b: ReadonlyMap<number, SlotBox>,
): boolean {
  if (a.size !== b.size) return false;
  for (const [block, box] of b) {
    const old = a.get(block);
    if (old === undefined || SLOT_SIDES.some((side) => old[side] !== box[side])) return false;
  }
  return true;
}
