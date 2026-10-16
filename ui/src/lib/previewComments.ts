// The preview's comment slots: where each comment renders, the room a slot holds open
// under its block, the slot's box, and the highlight over a comment's rendered text.
// Slots live outside the preview root, so the root stays exactly the rendered HTML the
// source map and `planPlace` index.

import { defaultReader, type RectReader } from "$lib/diffview/codeChrome.ts";
import { highlightsSupported } from "$lib/diffview/searchHighlight.ts";
import type { SourceSpan } from "$lib/planMarkdown.ts";
import type { PlanSourceMap } from "$lib/planSourceMap.ts";

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

/** `items` grouped by the block each renders after, blocks ascending; within a block by
 * line, keeping input order on a line. */
export function groupBySlot<T extends { line: number }>(
  blocks: readonly SourceSpan[],
  items: readonly T[],
): { block: number; items: T[] }[] {
  const slots = new Map<number, T[]>();
  for (const item of [...items].sort((a, b) => a.line - b.line)) {
    const block = commentSlotIndex(blocks, item.line);
    if (block === null) continue;
    const bucket = slots.get(block);
    if (bucket) bucket.push(item);
    else slots.set(block, [item]);
  }
  return [...slots]
    .sort(([a], [b]) => a - b)
    .map(([block, slotItems]) => ({ block, items: slotItems }));
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

/** `range` with any end outside `root` pulled back inside it: a start to the root's start,
 * an end to the end of `releaseBlock` (the root child the pointer was released beside), or
 * of the root without one — so a drag that ends over a slot anchors to that block's lines. */
export function clampToRoot(range: Range, root: Element, releaseBlock: Element | null): Range {
  const clamped = range.cloneRange();
  if (!root.contains(clamped.startContainer)) clamped.setStart(root, 0);
  if (!root.contains(clamped.endContainer)) {
    const end = releaseBlock ?? root;
    clamped.setEnd(end, end.childNodes.length);
  }
  return clamped;
}

/** Removes the comment highlight; a no-op without the Custom Highlight API. */
export function clearCommentHighlight(): void {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(HIGHLIGHT);
}

/** Holds each slot's height open under its block's text by padding the block's wrapper
 * (`root.children[block]`); `set` releases blocks no longer listed, `release` all.
 * `heights` maps a block index (`root.children` position) to its slot's height in CSS px. */
export function createSlotReserve(root: Element): {
  set(heights: ReadonlyMap<number, number>): void;
  release(): void;
} {
  let padded = new Set<number>();
  const pad = (block: number, value: string): void => {
    const el = root.children[block];
    // Writing only on change keeps a re-sync from dirtying layout.
    if (el instanceof HTMLElement && el.style.paddingBlockEnd !== value)
      el.style.paddingBlockEnd = value;
  };
  const set = (heights: ReadonlyMap<number, number>): void => {
    for (const block of padded) if (!heights.has(block)) pad(block, "");
    for (const [block, height] of heights) pad(block, `${height}px`);
    padded = new Set(heights.keys());
  };
  return { set, release: () => set(new Map()) };
}

/** Each slot's box in `scroller` content coordinates: top at its block's bottom less the
 * reserved height, left and width the block's. `heights` maps a block index
 * (`root.children` position) to its slot's height in CSS px. */
export function previewSlotBoxes(
  root: Element,
  scroller: HTMLElement,
  heights: ReadonlyMap<number, number>,
  read: RectReader = defaultReader,
): Map<number, { top: number; left: number; width: number }> {
  const scrollerRect = read(scroller);
  const boxes = new Map<number, { top: number; left: number; width: number }>();
  for (const [block, height] of heights) {
    const el = root.children[block];
    if (!(el instanceof HTMLElement)) continue;
    const box = read(el);
    boxes.set(block, {
      top: box.bottom - height - (scrollerRect.top - scroller.scrollTop),
      left: box.left - (scrollerRect.left - scroller.scrollLeft),
      width: box.right - box.left,
    });
  }
  return boxes;
}
