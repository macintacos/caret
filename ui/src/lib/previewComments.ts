// The preview's comments: where each comment renders, the room a slot holds open under its
// block, the slot's box, the highlight over a comment's rendered text, the keyboard's
// visual selection, and the click or drag selection a new comment starts from, kept
// inside the root. Slots live outside the preview root, so the root stays exactly the
// rendered HTML the source map and `planPlace` index.

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

/** `range` with any end outside `root` pulled back inside it. `range` must start or end
 * inside `root`, and `releaseBlock` must be a direct child of `root`: the block under the
 * release point, which a slot or the code chrome draws over. A start outside moves to the
 * root's start. An end outside moves to the end of `releaseBlock`, or of `root` when there
 * is none — unless that falls before the start (a drag up onto a block above the anchor),
 * when the range runs from there to the original start instead. */
export function clampToRoot(range: Range, root: Element, releaseBlock: Element | null): Range {
  const clamped = range.cloneRange();
  if (!root.contains(clamped.startContainer)) clamped.setStart(root, 0);
  if (!root.contains(clamped.endContainer)) {
    const end = releaseBlock ?? root;
    const start = [clamped.startContainer, clamped.startOffset] as const;
    clamped.setEnd(end, end.childNodes.length);
    if (clamped.collapsed && clamped.comparePoint(...start) > 0) clamped.setEnd(...start);
  }
  return clamped;
}

const INTERACTIVE = "a, button, input, label, select, summary, textarea";

/** The collapsed range a plain click on `target` in `root` leaves, copied; null when the
 * click hit a control or left a selection, or the selection lies outside `root`. */
export function clickedRange(
  root: Element,
  target: EventTarget | null,
  selection: Selection | null,
): Range | null {
  const interactive = target instanceof Element && target.closest(INTERACTIVE) !== null;
  if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return null;
  return shouldCommentOnLineClick({
    numberColumn: false,
    linkConsumed: interactive,
    selectionCollapsed: selection.isCollapsed,
  })
    ? selection.getRangeAt(0).cloneRange()
    : null;
}

/** Every element under a viewport point, topmost first. */
export type PointReader = (x: number, y: number) => readonly Element[];
const elementsAt: PointReader = (x, y) => document.elementsFromPoint(x, y);

/** The selection a drag released at `point` leaves, copied and clamped to `root`; null when
 * it is collapsed, anchored outside `root`, or still `before` (the press landed inside a
 * standing selection). `read` runs only when an end lies outside `root`: a slot draws over
 * its block's reserved padding and the chrome over its `pre`, so the block is under the
 * pointer too. */
export function releasedRange(
  root: Element,
  before: Range | null,
  selection: Selection | null,
  point: { x: number; y: number },
  read: PointReader = elementsAt,
): Range | null {
  if (!selection?.rangeCount || !root.contains(selection.anchorNode)) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || (before && sameRange(range, before))) return null;
  if (root.contains(range.startContainer) && root.contains(range.endContainer))
    return range.cloneRange();
  const releaseBlock = read(point.x, point.y).find((el) => el.parentElement === root) ?? null;
  return clampToRoot(range, root, releaseBlock);
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

/** Each slot's box in `scroller` content coordinates: top at its block's bottom less the
 * reserved height, left and width the block's. `heights` maps a block index
 * (`root.children` position) to its slot's height in CSS px. */
export function previewSlotBoxes(
  root: Element,
  scroller: HTMLElement,
  heights: ReadonlyMap<number, number>,
  read: RectReader = defaultReader,
): Map<number, { top: number; left: number; width: number }> {
  const origin = contentOrigin(scroller, read(scroller));
  const boxes = new Map<number, { top: number; left: number; width: number }>();
  for (const [block, height] of heights) {
    const el = root.children[block];
    if (!(el instanceof HTMLElement)) continue;
    const box = read(el);
    boxes.set(block, {
      top: box.bottom - height - origin.top,
      left: box.left - origin.left,
      width: box.right - box.left,
    });
  }
  return boxes;
}
