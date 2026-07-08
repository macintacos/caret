// Geometry for the code-block copy affordance (EXC-692). The copy button is a
// caret-owned overlay in the .diff-plan scroll container, shown at the top-right of
// the code block the pointer is over — the same host-overlay approach as bracket.ts
// (the library paints no such control, and the code rows live in a shadow root).
// This module is the pure geometry: which block a pointer is over, and where that
// block's top-right sits in the scroll container's content coordinates so an
// absolutely-positioned button scrolls with the rows. The rect reader is injected
// so the math unit-tests without real layout (happy-dom returns all-zero rects).

import type { CodeBlockRange } from "./codeBlocks.ts";

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

/**
 * The code block under a viewport point, or null. A block's box is the union of its
 * rendered rows: they share the content column, so left/right come from any row and
 * top/bottom from the first and last. Returns the first block that contains the
 * point. Null when the shadow root or the block's rows aren't present.
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
    const first = root.querySelector<HTMLElement>(`[data-content] > [data-line="${range.start}"]`);
    const last = root.querySelector<HTMLElement>(`[data-content] > [data-line="${range.end}"]`);
    if (first == null || last == null) continue;
    const a = read(first);
    const b = read(last);
    const top = Math.min(a.top, b.top);
    const bottom = Math.max(a.bottom, b.bottom);
    if (clientY >= top && clientY <= bottom && clientX >= a.left && clientX <= a.right) {
      return range;
    }
  }
  return null;
}

/**
 * The top-right corner of a block in the scroll container's content coordinates
 * (top/left px), or null if the block's opening row isn't rendered. A button placed
 * absolutely at this point inside `scroller` sits at the block's top-right and
 * scrolls with the rows; the button's own translate insets it from the corner. The
 * conversion mirrors bracket.ts: a row's content offset is its viewport edge minus
 * the scroller's viewport edge, plus how far the content is scrolled.
 */
export function copyAnchor(
  host: HTMLElement,
  scroller: HTMLElement,
  range: CodeBlockRange,
  read: RectReader = defaultReader,
): { top: number; left: number } | null {
  const root = host.shadowRoot;
  if (root == null) return null;
  const row = root.querySelector<HTMLElement>(`[data-content] > [data-line="${range.start}"]`);
  if (row == null) return null;
  const r = read(row);
  const s = read(scroller);
  return {
    top: r.top - (s.top - scroller.scrollTop),
    left: r.right - (s.left - scroller.scrollLeft),
  };
}
