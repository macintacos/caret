// Finds the reader's place on one plan surface and holds it on the other across a
// source/preview flip. Places are block-granular, found by binary search over the
// preview's block spans, so a long plan is never measured block by block.
import { indexAtReadingZone, parkAt } from "$lib/diffview/scroll.ts";
import type { SourceSpan } from "$lib/planMarkdown.ts";

/** The index of the block holding 1-based `line`: a line in a gap takes the next
 * block, a line past the end the last, and no blocks gives null. */
export function blockIndexForLine(blocks: readonly SourceSpan[], line: number): number | null {
  if (blocks.length === 0) return null;
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
  scrollerTop: number,
  preview: Element,
  blocks: readonly SourceSpan[],
): number | null {
  if (blocks.length === 0) return null;
  const i = indexAtReadingZone(
    blocks.length,
    (k) => (preview.children[k] as Element).getBoundingClientRect().bottom,
    scrollerTop,
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
const LISTEN = { capture: true, passive: true } as const;

/** Park `target` now and again on every `content` resize, until the reader takes
 * over or the surface goes away. While held it listens for reader input on the
 * scroller's document, in the capture phase. Returns the release; calling it
 * twice is harmless. */
export function holdPlace(hold: PlaceHold, observe: ObserveResize = observeResize): () => void {
  const doc = hold.scroller.ownerDocument;
  let released = false;
  let disconnect = (): void => {};
  const release = (): void => {
    if (released) return;
    released = true;
    disconnect();
    for (const type of READER_INPUTS) doc.removeEventListener(type, release, LISTEN);
  };
  const park = (): void => {
    if (released) return;
    const target = hold.content.isConnected ? hold.target() : null;
    if (target == null) release();
    else parkAt(hold.scroller, target);
  };
  const stopObserving = observe(hold.content, park);
  if (released) {
    stopObserving();
    return release;
  }
  disconnect = stopObserving;
  for (const type of READER_INPUTS) doc.addEventListener(type, release, LISTEN);
  park();
  return release;
}
