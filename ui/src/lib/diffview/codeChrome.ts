// Geometry for the per-code-block chrome — the copy button (EXC-692) and the soft-wrap
// toggle (EXC-1386). The chrome is a caret-owned overlay in the .diff-plan scroll
// container — the same host-overlay approach as bracket.ts, because the library paints
// no such control and the code rows live in a shadow root. The rect reader is injected
// so the math unit-tests without real layout (happy-dom returns all-zero rects).

import { CARD_ATTR } from "$lib/diffview/codeBlockScroll.ts";
import type { CodeBlockRange } from "$lib/diffview/codeBlocks.ts";

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
    if (
      clientY >= box.top &&
      clientY <= box.bottom &&
      clientX >= box.left &&
      clientX <= box.right
    ) {
      return range;
    }
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
      top: box.top - (scrollerRect.top - scroller.scrollTop),
      left: box.right - (scrollerRect.left - scroller.scrollLeft),
      carded: box.carded,
    });
  }
  return anchors;
}
