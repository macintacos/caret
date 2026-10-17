// The preview's comments: where each comment renders, the room a slot holds open under its
// block, the slot's box, the highlight over a comment's rendered text, the keyboard's
// visual selection, and whether a click or drag starts a new comment. Slots live outside
// the preview root, so the root stays exactly the rendered HTML the source map and
// `planPlace` index.

import { shouldCommentOnLineClick } from "$lib/diffview/annotationSlot.ts";
import { highlightsSupported } from "$lib/diffview/searchHighlight.ts";
import { contentOrigin, defaultReader, type RectReader } from "$lib/geometry.ts";
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

const VISUAL_HIGHLIGHT = "caret-visual-selection";

/** Paints `range` as the keyboard's visual selection (`caret-visual-selection`),
 * replacing the last; a no-op without the Custom Highlight API. */
export function paintVisualSelection(range: Range): void {
  if (!highlightsSupported()) return;
  CSS.highlights.set(VISUAL_HIGHLIGHT, new Highlight(range));
}

/** Clears the visual selection; a no-op without the Custom Highlight API. */
export function clearVisualSelection(): void {
  if (!highlightsSupported()) return;
  CSS.highlights.delete(VISUAL_HIGHLIGHT);
}

const INTERACTIVE = "a, button, input, label, select, summary, textarea";

/** Whether a plain click on `target` in `root` starts a comment: it left the selection
 * collapsed inside `root`, and hit no control. */
export function isCommentClick(
  root: Element,
  target: EventTarget | null,
  selection: Selection | null,
): boolean {
  const interactive = target instanceof Element && target.closest(INTERACTIVE) !== null;
  if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return false;
  return shouldCommentOnLineClick({
    numberColumn: false,
    linkConsumed: interactive,
    selectionCollapsed: selection.isCollapsed,
  });
}

/** Whether a release ends a comment drag: it left a selection anchored inside `root`, not
 * collapsed and not still `before` (the press landed inside a standing selection). Its
 * end may lie outside `root`, over a slot or the code chrome. */
export function isCommentDrag(
  root: Element,
  before: Range | null,
  selection: Selection | null,
): boolean {
  if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return false;
  const range = selection.getRangeAt(0);
  return !range.collapsed && !(before && sameRange(range, before));
}

function sameRange(a: Range, b: Range): boolean {
  return (
    a.compareBoundaryPoints(Range.START_TO_START, b) === 0 &&
    a.compareBoundaryPoints(Range.END_TO_END, b) === 0
  );
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

/** A comment slot's box in a scroller's content coordinates, with the inline padding that
 * sets its content over its block's. */
export type SlotBox = {
  top: number;
  left: number;
  width: number;
  padStart: number;
  padEnd: number;
};

/** Each slot's box in `scroller` content coordinates: top at its block's bottom less the
 * reserved height, across `root` as the rows above and below it run, padded in to the
 * block's sides. `heights` maps a block index (`root.children` position) to its slot's
 * height in CSS px. */
export function previewSlotBoxes(
  root: Element,
  scroller: HTMLElement,
  heights: ReadonlyMap<number, number>,
  read: RectReader = defaultReader,
): Map<number, SlotBox> {
  const origin = contentOrigin(scroller, read(scroller));
  const across = read(root);
  const boxes = new Map<number, SlotBox>();
  for (const [block, height] of heights) {
    const el = root.children[block];
    if (!(el instanceof HTMLElement)) continue;
    const box = read(el);
    boxes.set(block, {
      top: box.bottom - height - origin.top,
      left: across.left - origin.left,
      width: across.right - across.left,
      padStart: box.left - across.left,
      padEnd: across.right - box.right,
    });
  }
  return boxes;
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
