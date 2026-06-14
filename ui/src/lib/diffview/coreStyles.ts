// @pierre/diffs lays out a File/FileDiff (gutter + content grid, sticky header,
// annotation slots) with a core stylesheet that only its web component adopts.
// caret renders the File/FileDiff classes directly in container-managed mode, so
// it owns the shadow root and adopts that stylesheet here — without it the
// content column collapses to zero width and only the line-number gutter shows.

import { DIFFS_CORE_STYLES } from "./diffsCoreStyles.ts";

// caret's adjustments layered over the vendored core stylesheet. The gutter and
// content sit in adjacent grid columns with no gap, which reads cramped — line
// numbers crowd the code, most visibly under a line's hover highlight. Inline-start
// padding on the content column opens that seam without shifting the gutter, and
// also gives the hover "+" comment button a lane to sit in. By default the library
// pins that button to the number column's right edge and pulls it left with a
// negative margin, so it overlaps the line number; widening that negative margin
// nudges it past the digits into the gutter→content seam instead. That margin
// value is empirical — tuned against the library's own `calc(1ch - 1lh)` offset,
// so it may need revisiting if @pierre/diffs changes its gutter layout.
//
// The gutter "+" carries caret's accent. The library fills [data-utility-button]
// with var(--diffs-modified-base) — library blue — which the amber-selection-only
// strategy keeps for the change-type icons and merge-conflict incoming. Recoloring
// the comment affordance has to stay scoped to this one element rather than
// retargeting --diffs-modified-base (that would bleed amber into those too), so the
// fill is set here, in the override sheet caret already adopts into the shadow root.
// caret's accent tokens are :root custom properties and inherit through the shadow
// boundary, so var(--accent) resolves correctly. The "+" reads accent at rest and
// brightens on hover/focus, matching the composer's solid action button; the
// focus-visible ring keeps the keyboard path to the composer visible.
const CARET_OVERRIDES = `
  [data-content] { padding-inline-start: 24px; }
  [data-utility-button] {
    margin-right: calc(1ch - 1lh - 0.85rem);
    background-color: var(--accent);
    color: var(--accent-ink);
  }
  [data-utility-button]:hover { background-color: var(--accent-bright); }
  [data-utility-button]:focus-visible {
    background-color: var(--accent-bright);
    outline: 2px solid var(--accent-bright);
    outline-offset: 2px;
  }
`;

// Constructable sheets shared across every view's shadow root, the override
// adopted after the core sheet so it wins. Adopted sheets are independent of a
// root's child nodes, so they survive the replaceChildren() the lifecycle runs
// when it swaps content.
let sheet: CSSStyleSheet | undefined;
let overrides: CSSStyleSheet | undefined;

/**
 * Ensures the @pierre/diffs core stylesheet is present in `root`. Idempotent:
 * adopting the shared sheet a second time is a no-op, and the <style> fallback
 * is keyed so it is only inserted once. Prefers adoptedStyleSheets, falling back
 * to a <style> node where constructable stylesheets are unavailable.
 */
export function ensureCoreStyles(root: ShadowRoot): void {
  if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in root) {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(DIFFS_CORE_STYLES);
    }
    if (!overrides) {
      overrides = new CSSStyleSheet();
      overrides.replaceSync(CARET_OVERRIDES);
    }
    const want = [sheet, overrides];
    if (!want.every((s) => root.adoptedStyleSheets.includes(s))) {
      root.adoptedStyleSheets = [
        sheet,
        ...root.adoptedStyleSheets.filter((s) => s !== sheet && s !== overrides),
        overrides,
      ];
    }
    return;
  }
  if (!root.querySelector("style[data-caret-core-css]")) {
    const el = document.createElement("style");
    el.dataset.caretCoreCss = "";
    el.textContent = `${DIFFS_CORE_STYLES}\n${CARET_OVERRIDES}`;
    root.prepend(el);
  }
}
