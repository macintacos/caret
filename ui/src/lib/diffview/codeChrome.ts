// Geometry for the per-code-block chrome — the copy button (EXC-692) and the soft-wrap
// toggle (EXC-1386). The chrome is a caret-owned overlay in the .diff-plan scroll
// container — the same host-overlay approach as bracket.ts, because neither surface paints
// such a control. On the source view a block is shadow-root rows; on the preview it is a
// light-DOM `pre`. The rect reader is injected so the math unit-tests without real layout
// (happy-dom returns all-zero rects); the preview's overflow read (`pre.scrollWidth`) is
// not.

import { CARD_ATTR } from "$lib/diffview/codeBlockScroll.ts";
import type { CodeBlockRange } from "$lib/diffview/codeBlocks.ts";
import { previewCodeBlocks } from "$lib/previewCode.ts";

/** Reads an element's viewport rect. Injectable for tests. */
export type RectReader = (el: HTMLElement) => {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

const defaultReader: RectReader = (el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
};

/** Where a block's chrome sits, in `scroller` content coordinates, and whether the block
 * is carded — the overflow predicate the wrap button gates on. */
export interface CodeChromeAnchor {
  /** The block's 1-based opening line, which keys the chrome to its block. */
  start: number;
  top: number;
  left: number;
  carded: boolean;
  /** The text the copy button writes, when the surface renders it itself — the preview's
   * `code`, which can differ from the source scan's block (a quoted shorter fence, a
   * list-nested fence's indent). Absent on the source view. */
  text?: string;
}

/** The chrome's geometry on one surface: what to observe for resizes, the hit-test by
 * block `start`, and the anchors. */
export interface ChromeGeometry {
  observed: HTMLElement;
  blockAt(x: number, y: number): number | undefined;
  anchors(scroller: HTMLElement): CodeChromeAnchor[];
}

type Box = { top: number; bottom: number; left: number; right: number };

function contains(box: Box, x: number, y: number): boolean {
  return y >= box.top && y <= box.bottom && x >= box.left && x <= box.right;
}

/** A box's top-right corner in `scroller` content coordinates. */
function contentCorner(
  box: Box,
  scroller: HTMLElement,
  scrollerRect: Box,
): { top: number; left: number } {
  return {
    top: box.top - (scrollerRect.top - scroller.scrollTop),
    left: box.right - (scrollerRect.left - scroller.scrollLeft),
  };
}

/**
 * A block's visible box: its scroll card when the block overflows, else the union of its
 * rendered rows (they share the content column, so left/right come from any row and
 * top/bottom from the first and last). Null when the block's rows aren't present.
 *
 * The card comes FIRST because a carded row's box is max-content wide: its right edge sits
 * off past the card's visible edge and moves as the card scrolls, so neither a hit-test nor
 * a top-right anchor can be taken from it. The rows are reached by DESCENDANT query, the
 * shape refHint.ts's rowAt already uses, since a carded block's rows are no longer direct
 * children of [data-content].
 */
function blockBox(
  root: ShadowRoot,
  range: CodeBlockRange,
  read: RectReader,
): { top: number; bottom: number; left: number; right: number; carded: boolean } | null {
  const card = root.querySelector<HTMLElement>(`[data-content] > [${CARD_ATTR}="${range.start}"]`);
  if (card != null) return { ...read(card), carded: true };
  const firstRow = root.querySelector<HTMLElement>(`[data-content] [data-line="${range.start}"]`);
  const lastRow = root.querySelector<HTMLElement>(`[data-content] [data-line="${range.end}"]`);
  if (firstRow == null || lastRow == null) return null;
  const firstRect = read(firstRow);
  const lastRect = read(lastRow);
  return {
    top: Math.min(firstRect.top, lastRect.top),
    bottom: Math.max(firstRect.bottom, lastRect.bottom),
    left: firstRect.left,
    right: firstRect.right,
    carded: false,
  };
}

/**
 * The code block under a viewport point, or null. Returns the first block whose visible box
 * contains the point. Null when the shadow root or the block's rows aren't present.
 */
export function codeBlockAtPoint(
  host: HTMLElement,
  ranges: CodeBlockRange[],
  clientX: number,
  clientY: number,
  read: RectReader = defaultReader,
): CodeBlockRange | null {
  const root = host.shadowRoot;
  if (root == null) return null;
  for (const range of ranges) {
    const box = blockBox(root, range, read);
    if (box == null) continue;
    if (contains(box, clientX, clientY)) return range;
  }
  return null;
}

/**
 * The top-right corner of every rendered block, in the scroll container's content
 * coordinates, with whether each is carded. Chrome placed absolutely at one of these points
 * inside `scroller` sits at the block's top-right and scrolls with the rows; the chrome's
 * own translate insets it from the corner. The conversion mirrors bracket.ts: a box's
 * content offset is its viewport edge minus the scroller's viewport edge, plus how far the
 * content is scrolled.
 */
export function codeChromeAnchors(
  host: HTMLElement,
  scroller: HTMLElement,
  ranges: CodeBlockRange[],
  read: RectReader = defaultReader,
): CodeChromeAnchor[] {
  const root = host.shadowRoot;
  if (root == null) return [];
  const scrollerRect = read(scroller);
  const anchors: CodeChromeAnchor[] = [];
  for (const range of ranges) {
    const box = blockBox(root, range, read);
    if (box == null) continue;
    anchors.push({
      start: range.start,
      ...contentCorner(box, scroller, scrollerRect),
      carded: box.carded,
    });
  }
  return anchors;
}

/** The preview block under a viewport point, by its `start`, or undefined. */
export function previewCodeBlockAtPoint(
  root: ParentNode,
  clientX: number,
  clientY: number,
  read: RectReader = defaultReader,
): number | undefined {
  return previewCodeBlocks(root).find((block) => contains(read(block.pre), clientX, clientY))
    ?.start;
}

/** codeChromeAnchors for the preview: each block's `pre` top-right corner in `scroller`
 * content coordinates, keyed by `start`, with the `code`'s own text. Carded when the `pre`
 * overflows or `reflowed` holds it — a wrapped block no longer overflows, and its wrap
 * button has to stay to unwrap it. */
export function previewCodeChromeAnchors(
  root: ParentNode,
  scroller: HTMLElement,
  reflowed: ReadonlySet<number>,
  read: RectReader = defaultReader,
): CodeChromeAnchor[] {
  const scrollerRect = read(scroller);
  return previewCodeBlocks(root).map(({ start, pre, code }) => ({
    start,
    ...contentCorner(read(pre), scroller, scrollerRect),
    carded: pre.scrollWidth > pre.clientWidth || reflowed.has(start),
    text: (code.textContent ?? "").replace(/\n$/, ""),
  }));
}
