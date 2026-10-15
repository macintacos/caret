// Keeps the reader's place across a flip between the plan's source view and its
// preview. Both surfaces share the source view's reading zone and parking offset,
// so a block parked by one flip is the block the next flip reads back. Places are
// block-granular, located through the preview's block spans by binary search, so
// a long plan is never measured block by block.
import { indexAtReadingZone, parkAt } from "$lib/diffview/scroll.ts";
import type { SourceSpan } from "$lib/planMarkdown.ts";

/** The index of the block holding 1-based `line`: a line in a gap takes the next
 * block, a line past the end the last, and no blocks gives -1. */
export function blockIndexForLine(blocks: readonly SourceSpan[], line: number): number {
  let lo = 0;
  let hi = blocks.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((blocks[mid] as SourceSpan).end >= line) hi = mid;
    else lo = mid + 1;
  }
  return Math.min(lo, blocks.length - 1);
}

/** The first source line of the preview block at the reading zone, the last
 * block's when every block sits above it, or null with no blocks. `preview`'s
 * children are the blocks, `blocks[i]` the i-th child's span. */
export function previewTopLine(
  scroller: Element,
  preview: Element,
  blocks: readonly SourceSpan[],
): number | null {
  if (blocks.length === 0) return null;
  const count = Math.min(blocks.length, preview.children.length);
  const i = indexAtReadingZone(
    count,
    (k) => (preview.children[k] as Element).getBoundingClientRect().bottom,
    scroller.getBoundingClientRect().top,
  );
  return (blocks[i ?? blocks.length - 1] as SourceSpan).start;
}

export interface PlaceHold {
  /** The plan's scroll container. */
  scroller: HTMLElement;
  /** What the new surface renders into; each of its resizes re-parks. */
  content: Element;
  /** The element to keep at the reading zone, re-resolved on every park (source rows repaint). */
  target: () => Element | null;
}

/** Watches `el`'s size, calling `onResize` on each change; returns the disconnect. */
export type ObserveResize = (el: Element, onResize: () => void) => () => void;

const observeResize: ObserveResize = (el, onResize) => {
  const observer = new ResizeObserver(onResize);
  observer.observe(el);
  return () => observer.disconnect();
};

// `scroll` is deliberately absent: native scroll anchoring moves scrollTop too.
const READER_INPUTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/** Park `target` now and again on every `content` resize, until the reader takes
 * over or the surface goes away. Returns the release; calling it twice is harmless. */
export function holdPlace(hold: PlaceHold, observe: ObserveResize = observeResize): () => void {
  const doc = hold.scroller.ownerDocument;
  let released = false;
  const release = (): void => {
    if (released) return;
    released = true;
    disconnect();
    for (const type of READER_INPUTS) doc.removeEventListener(type, release, true);
  };
  const park = (): void => {
    if (released) return;
    const el = hold.content.isConnected ? hold.target() : null;
    if (el == null) release();
    else parkAt(hold.scroller, el);
  };
  for (const type of READER_INPUTS) doc.addEventListener(type, release, true);
  const disconnect = observe(hold.content, park);
  park();
  return release;
}
