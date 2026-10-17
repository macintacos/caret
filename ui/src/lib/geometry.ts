// Viewport rects, and the content frame of the scroller the plan's overlays are placed in.

/** A viewport rect's edges. */
export type Box = { top: number; bottom: number; left: number; right: number };

/** Reads an element's viewport rect as a plain object: callers spread it, and a DOMRect's
 * edges are prototype getters, so spreading one yields `{}`. Injectable, since
 * happy-dom's rects are all zero. */
export type RectReader = (el: Element) => Box;

/** The live reader: the bounding rect's edges. */
export const defaultReader: RectReader = (el) => {
  const r = el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
};

/** Where `scroller`'s content origin sits in the viewport, given the scroller's viewport
 * `rect`. Subtract it from a viewport point to get that point in the content coordinates
 * of an overlay absolutely positioned inside `scroller`. Assumes `scroller` has no
 * border: `rect` is its border box, an overlay's origin its padding box. */
export function contentOrigin(
  scroller: Pick<Element, "scrollTop" | "scrollLeft">,
  rect: Pick<Box, "top" | "left">,
): { top: number; left: number } {
  return { top: rect.top - scroller.scrollTop, left: rect.left - scroller.scrollLeft };
}
