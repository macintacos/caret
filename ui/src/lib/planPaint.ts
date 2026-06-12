// The plan surface's imperative highlight painting, extracted from PlanView so
// the mark-wrapping/measuring logic is unit-testable against a real DOM
// (happy-dom) without mounting the component. PlanView owns the Svelte shell,
// the $effect scheduling, and the ResizeObserver; this module owns the DOM
// mutation: unwrap stale marks, re-resolve each annotation, wrap its range in
// <mark>s, and measure each card's top relative to the article.

import { type Annotation, isLegacyAnnotation } from "@core/types";
import { resolveAnnotation, wrapTextRange } from "./anchors.ts";

/** A re-resolved annotation: orphaned when its anchor was lost, else its card's
 * vertical offset (px) relative to the article top. */
export interface ResolvedAnnotation {
  annotation: Annotation;
  orphaned: boolean;
  top: number | null;
}

/** Looks up a plan block by its structural id within `root`. */
export function blockFinder(root: HTMLElement): (blockId: string) => HTMLElement | null {
  return (blockId) => (root.querySelector(`#${CSS.escape(blockId)}`) as HTMLElement) ?? null;
}

/**
 * Removes every annotation <mark> under `root`, splicing each mark's children
 * back into its parent and re-joining the adjacent text nodes. Idempotent: a
 * root with no marks is left untouched, so a subsequent paint starts clean.
 */
export function unwrapMarks(root: HTMLElement): void {
  root.querySelectorAll("mark[data-annotation]").forEach((m) => {
    const parent = m.parentNode;
    if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  });
}

/**
 * Repaints all annotation highlights over the rendered plan and returns the
 * gutter's resolution list. Unwraps prior marks first (idempotent), then for
 * each annotation:
 *  - re-resolves it against the current DOM (tier 1/2/3),
 *  - tier-3 or no range → orphaned (top: null),
 *  - else wraps the resolved range per text node in a fresh <mark> carrying the
 *    annotation id, the `anno` class, and `active` when it is the active id, and
 *    measures the first mark's top relative to `root`.
 * The per-text-node wrap keeps a selection that crosses shiki token <span>s
 * highlighting as one annotation. Measurement uses getBoundingClientRect, so a
 * happy-dom environment without layout reports top 0 — exercise the structural
 * outcome (orphaned flag, mark wiring) in units and leave pixel positioning to
 * e2e.
 */
export function paintAnnotations(
  root: HTMLElement,
  annotations: Annotation[],
  activeId: string | null,
): ResolvedAnnotation[] {
  unwrapMarks(root);

  const getBlock = blockFinder(root);
  const resolved: ResolvedAnnotation[] = [];
  const rootTop = root.getBoundingClientRect().top;

  for (const annotation of annotations) {
    // Line-anchored annotations have no selection anchor on this surface:
    // they land in the unanchored bucket rather than the resolve tiers.
    if (!isLegacyAnnotation(annotation)) {
      resolved.push({ annotation, orphaned: true, top: null });
      continue;
    }
    const res = resolveAnnotation(annotation, getBlock);
    if (res.tier === 3 || !res.range) {
      resolved.push({ annotation, orphaned: true, top: null });
      continue;
    }
    const block = getBlock(annotation.blockId);
    let top: number | null;
    if (block) {
      const marks = wrapTextRange(block, res.startOffset, res.endOffset, () => {
        const m = document.createElement("mark");
        m.dataset.annotation = annotation.id;
        m.className = "anno";
        if (annotation.id === activeId) m.classList.add("active");
        return m;
      });
      const anchor = marks[0] ?? res.range;
      top = anchor.getBoundingClientRect().top - rootTop;
    } else {
      top = res.range.getBoundingClientRect().top - rootTop;
    }
    resolved.push({ annotation, orphaned: false, top });
  }
  return resolved;
}
