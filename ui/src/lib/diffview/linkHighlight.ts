// Paints the resting-state appearance of the source view's links. The
// link layer collapses `[label](url)` to its label, so shiki tokenizes what's
// left as ordinary prose and a link is indistinguishable from body copy until the
// hover handlers in linkInteractions.ts fire. This marks it standing: a named CSS
// Custom Highlight over each link span, styled in coreStyles.ts as a tint plus a
// dotted underline.
//
// A highlight, not a token tag: shiki emits a prose line as ONE token span, so
// the data-attribute technique fileRefTag.ts uses would decorate the whole line
// rather than the link's columns. The Custom Highlight API takes exact column
// ranges, so it reuses searchHighlight.ts's rangeForSpan and shares its repaint
// hook in SourceView. Feature-detected the same way: an engine without the API is
// a clean no-op, leaving the click/hover affordances untouched.

import type { LinkSpanMap } from "$lib/diffview/links.ts";
import { rangeForSpan } from "$lib/diffview/searchHighlight.ts";

const LINKS = "caret-link";

/** Registers the link highlight over every span in `spanMap` within `root` (the
 * source view's shadow root). Ranges are rebuilt on each call, so this is the
 * caller's re-paint hook after a library row repaint. Passing an empty map clears
 * the highlight. A no-op when the API is unavailable. */
export function paintLinkHighlights(root: ParentNode, spanMap: LinkSpanMap): void {
  if (typeof Highlight !== "function" || typeof CSS === "undefined" || CSS.highlights == null)
    return;
  const links = new Highlight();
  for (const [line, spans] of spanMap) {
    const rowEl = root.querySelector(`[data-content] > [data-line="${line}"]`);
    if (rowEl === null) continue;
    for (const span of spans) {
      const range = rangeForSpan(rowEl, span.startCol, span.endCol);
      if (range !== null) links.add(range);
    }
  }
  CSS.highlights.set(LINKS, links);
}

/** Removes the link highlight from the global registry — the unmount teardown, so
 * it doesn't linger over a torn-down shadow root. A no-op when unavailable. */
export function clearLinkHighlights(): void {
  if (typeof CSS === "undefined" || CSS.highlights == null) return;
  CSS.highlights.delete(LINKS);
}
