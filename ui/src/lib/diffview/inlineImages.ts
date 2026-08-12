// Draws the plan's markdown images onto their source rows (EXC-870). Every other
// pass over a rendered row only tags or splits what shiki already painted; this
// one ADDS an element, which makes it the closest sibling of syncCodeBlockCards
// rather than of tagFileRefTokens — and inherits that module's hard requirement:
// SourceView drives it from a MutationObserver watching childList over the whole
// subtree, so a pass that re-created a settled row's image would loop the
// observer forever. A row whose images already match the map is left completely
// untouched; only a real mismatch removes and rebuilds.
//
// The image is APPENDED, so it sits past the last text token. That placement is
// load-bearing: splitRow and tagRow (inlineDecorate.ts) and tagTokenAt
// (fileRefTag.ts) all locate a token by walking direct children and accumulating
// text length, and an <img> contributes no characters at a column no reference or
// run can start at. The row's own text — the literal `![alt](url)` links.ts
// refused to collapse — is untouched, which is what keeps copy, selection, the
// gutter number and the comment affordance exactly as they were.
//
// A FAILED LOAD hides the element rather than removing it. Removing it would have
// the next observer pass create it again, and remembering the failure would need
// module state; `hidden` is idempotent by construction and leaves the row reading
// as the link chip over the literal markdown — the issue's second rung — with no
// broken-image chrome. The one thing this costs is a CSS rule, since `hidden`'s
// UA `display: none` loses to the sheet's own `display: block` (coreStyles.ts).
//
// Only `http`/`https` URLs arrive here: links.ts emits an ImageSpan solely for a
// target its isSafeUrl gate accepted, so this module never re-decides safety. The
// URL reaches the DOM as an `src` property on an element constructed here, never
// through a parsed HTML string, so there is no markup-injection surface to
// sanitise. `referrerpolicy` mirrors the noreferrer stance openLinkInNewTab takes
// for the surface's other outbound-network affordance, and `loading` keeps a long
// plan from fetching every asset at once.

import type { ImageSpanMap } from "$lib/diffview/links.ts";

const IMAGE_ATTR = "data-md-image";

/** The row's images, in document order. */
function imagesIn(row: Element): HTMLImageElement[] {
  return [...row.children].filter((el): el is HTMLImageElement => el.hasAttribute(IMAGE_ATTR));
}

/**
 * Adds an `<img>` to each row the map names, one per image on that line, and
 * clears the images from rows it does not. `root` is the source view's shadow
 * root (or any container holding the `[data-content] [data-line]` rows).
 * Idempotent and safe to call on every repaint.
 */
export function syncInlineImages(root: ParentNode, images: ImageSpanMap): void {
  for (const row of root.querySelectorAll(`[data-content] [data-line]`)) {
    const line = Number(row.getAttribute("data-line"));
    const wanted = (Number.isFinite(line) ? images.get(line) : undefined) ?? [];
    const present = imagesIn(row);
    // The settled case, and the only one that must mutate nothing: same images,
    // same order. Comparing the attribute rather than the `src` property matters
    // — the property reflects as an absolute URL resolved against the document.
    if (
      present.length === wanted.length &&
      present.every((img, i) => img.getAttribute("src") === wanted[i]?.url)
    ) {
      continue;
    }
    for (const stale of present) stale.remove();
    for (const image of wanted) {
      const img = row.ownerDocument.createElement("img");
      img.setAttribute(IMAGE_ATTR, "");
      img.setAttribute("src", image.url);
      img.setAttribute("alt", image.alt);
      img.setAttribute("referrerpolicy", "no-referrer");
      img.setAttribute("loading", "lazy");
      img.addEventListener("error", () => {
        img.hidden = true;
      });
      row.appendChild(img);
    }
  }
}
