// Turns the user's current text selection into an anchor descriptor. The block
// id is taken from the nearest ancestor element that carries a structural
// `id="b{n}"`; offsets are measured against that block's textContent.

import { rangeToOffsets } from "./anchors.ts";

export interface CapturedSelection {
  blockId: string;
  startOffset: number;
  endOffset: number;
  quote: string;
  /** Bounding rect of the selection, for positioning the comment popover. */
  rect: DOMRect;
}

/** Climbs from `node` to the nearest element whose id matches /^b\d+$/. */
function nearestBlock(node: Node | null, root: HTMLElement): HTMLElement | null {
  let el: Node | null = node;
  while (el && el !== root.parentNode) {
    if (el.nodeType === Node.ELEMENT_NODE) {
      const id = (el as HTMLElement).id;
      if (/^b\d+$/.test(id)) return el as HTMLElement;
    }
    el = el.parentNode;
  }
  return null;
}

/**
 * Captures the active selection if it is a non-collapsed range fully inside a
 * structural block within `root`. Returns null otherwise.
 */
export function captureSelection(root: HTMLElement): CapturedSelection | null {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;

  const range = sel.getRangeAt(0);
  const quote = range.toString();
  if (quote.trim().length === 0) return null;

  // Must be inside the plan root.
  if (!root.contains(range.commonAncestorContainer)) return null;

  const block = nearestBlock(range.commonAncestorContainer, root);
  if (!block) return null;

  const { start, end } = rangeToOffsets(block, range);
  if (start === end) return null;

  return {
    blockId: block.id,
    startOffset: start,
    endOffset: end,
    quote,
    rect: range.getBoundingClientRect(),
  };
}
