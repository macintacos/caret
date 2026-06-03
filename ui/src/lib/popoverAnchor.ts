// Pure geometry for anchoring the inline annotation popover to its <mark>.
// Kept DOM-free so it is unit-testable; the component feeds it real DOMRects.

/** Where the popover points: centered horizontally on the mark, at its bottom. */
export function anchorPoint(rect: { left: number; width: number; bottom: number }): {
  x: number;
  y: number;
} {
  return { x: rect.left + rect.width / 2, y: rect.bottom };
}

/** Whether the mark still overlaps the scroll viewport vertically. Once it has
    scrolled fully past either edge the popover can no longer follow it. */
export function isAnchorVisible(
  rect: { top: number; bottom: number },
  viewport: { top: number; bottom: number },
): boolean {
  return rect.bottom > viewport.top && rect.top < viewport.bottom;
}
