// Draws the plan's markdown images onto their source rows (EXC-870). Every other
// pass over a rendered row only tags or splits what shiki already painted; this
// one ADDS an element, which makes it the closest sibling of syncCodeBlockCards
// rather than of tagFileRefTokens — and inherits that module's hard requirement:
// SourceView drives it from a MutationObserver watching childList over the whole
// subtree, so a pass that re-created a settled row's image would loop the
// observer forever. A row whose images already match the map is left completely
// untouched; only a real mismatch removes and rebuilds.
//
// The work is proportional to the IMAGES, not to the plan: the map is iterated
// rather than the row set, and the stale sweep is one query for the elements this
// module owns — the shape tagFileRefTokens uses, and the right one for data this
// sparse (a plan holds none or a handful, while a long plan holds a thousand
// rows).
//
// The image is APPENDED, so it sits past the last text token. Both this pass and
// the token passes are safe in either order — an <img> holds no characters, and
// splitRow, tagRow (inlineDecorate.ts) and tagTokenAt (fileRefTag.ts) all locate a
// token by walking direct children and accumulating text length, so a zero-length
// child at the end of the line is invisible to each. What the placement buys is
// the row's own text: the literal `![alt](url)` links.ts refused to collapse is
// untouched, which is what keeps copy, selection, the gutter number and the
// comment affordance exactly as they were.
//
// A FAILED LOAD hides the element rather than removing it. Removing it would have
// the next observer pass create it again, and remembering the failure would need
// module state; `hidden` is idempotent by construction and leaves the row reading
// as the link chip over the literal markdown — the issue's second rung — with no
// broken-image chrome. The one thing this costs is a CSS rule, since `hidden`'s
// UA `display: none` is overridden by the sheet's own `display: block`
// (coreStyles.ts, adopted after the UA and library sheets).
//
// SECURITY. The scheme gate is upstream and absolute: links.ts emits an ImageSpan
// only for a target its isSafeUrl accepted, so nothing but `http`/`https` reaches
// here and this module never re-decides safety. What the gate does NOT do is make
// the fetch itself harmless, and that is the exposure this feature adds rather
// than one it inherits. A plan is written by the coding agent, and before EXC-870
// nothing in a plan caused a request without a reviewer's click; an image URL now
// makes the reviewer's browser GET an arbitrary host when the row scrolls into
// view, with whatever the agent put in the path. That is the exfiltration channel
// every surface rendering someone else's markdown has to answer for, and caret's
// answer today is that plan text is trusted enough to render — the mitigations
// below reduce what leaks, they do not close the channel. `referrerpolicy` keeps
// the request from naming the page it came from, mirroring the noreferrer stance
// openLinkInNewTab takes for the surface's other outbound affordance, and
// `loading` keeps a long plan from fetching every asset before the reviewer has
// scrolled to any of them. Closing it properly wants an `img-src` CSP on the
// daemon's own response, which would cover the comment renderer too; there is no
// CSP today.

import type { ImageSpan, ImageSpanMap } from "$lib/diffview/links.ts";

const IMAGE_ATTR = "data-md-image";

/** The images this module owns on a row, in document order. */
function imagesIn(row: Element): Element[] {
  return [...row.children].filter((el) => el.hasAttribute(IMAGE_ATTR));
}

/** Whether a row's images already match what the map wants, element for element.
 * The attribute is compared rather than the `src` property, which reflects as an
 * absolute URL resolved against the document and so never equals a relative one. */
function settled(present: readonly Element[], wanted: readonly ImageSpan[]): boolean {
  return (
    present.length === wanted.length &&
    present.every(
      (img, i) =>
        img.getAttribute("src") === wanted[i]?.url && img.getAttribute("alt") === wanted[i]?.alt,
    )
  );
}

/** Builds one image element. `src` is set LAST so the loading and referrer
 * attributes are already in place when the fetch is queued, rather than relying
 * on it being deferred to a microtask. */
function createImage(doc: Document, image: ImageSpan): HTMLImageElement {
  const img = doc.createElement("img");
  img.setAttribute(IMAGE_ATTR, "");
  img.setAttribute("alt", image.alt);
  img.setAttribute("referrerpolicy", "no-referrer");
  img.setAttribute("loading", "lazy");
  img.addEventListener("error", () => {
    img.hidden = true;
  });
  img.setAttribute("src", image.url);
  return img;
}

/**
 * Adds an `<img>` to each row the map names, one per image on that line, and
 * clears the images from rows it does not. `root` is the source view's shadow
 * root (or any container holding the `[data-content] [data-line]` rows).
 * Idempotent and safe to call on every repaint.
 */
export function syncInlineImages(root: ParentNode, images: ImageSpanMap): void {
  // Drop every image whose line the map no longer names, so a plan edit that
  // removed one removes its picture. A line the map still names is left to the
  // settle check below, which is what keeps an unchanged row untouched.
  for (const img of root.querySelectorAll(`[${IMAGE_ATTR}]`)) {
    const line = Number(img.parentElement?.getAttribute("data-line"));
    if (!Number.isFinite(line) || !images.has(line)) img.remove();
  }
  for (const [line, wanted] of images) {
    const row = root.querySelector(`[data-content] [data-line="${line}"]`);
    if (row === null) continue;
    const present = imagesIn(row);
    if (settled(present, wanted)) continue;
    for (const stale of present) stale.remove();
    for (const image of wanted) row.appendChild(createImage(row.ownerDocument, image));
  }
}
