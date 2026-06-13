// Inline annotation slotting for the source view. @pierre/diffs reserves a
// full-width annotation row — and a named <slot> inside it — for every line it is
// given in `lineAnnotations`, and it does this even in container-managed mode
// (only its own renderAnnotation light-DOM fill is skipped there). caret fills
// those slots itself: a comment is projected into the row as a light-DOM child
// carrying the matching slot name, so it renders as an inline block that pushes
// the code below it down rather than as an overlay floating over the lines.
//
// This module is the single owner of that slot-name contract; the components just
// supply the card/composer DOM and the line it anchors to.
import type { SourceLineAnnotation } from "./types.ts";

/** Slot name the library assigns the annotation row for a 1-based source line.
 * Mirrors the library's getLineAnnotationName for the single-document view. */
export function annotationSlotName(line: number): string {
  return `annotation-${line}`;
}

/** Library line annotations (one per line) that reserve the slot rows. Deduped
 * and ordered: several comments on one line share a single row and stack within
 * it, so passing the line more than once would emit duplicate, unfillable slots. */
export function toLineAnnotations(lines: Iterable<number>): SourceLineAnnotation[] {
  return [...new Set(lines)].sort((a, b) => a - b).map((lineNumber) => ({ lineNumber }));
}

/**
 * Whether a plain click on a source line should open a comment composer.
 * Number-column clicks are already owned by the gutter `+`/selection, and link
 * clicks and active text selections belong to the reader — so commenting stands
 * down for all three.
 */
export function shouldCommentOnLineClick(opts: {
  numberColumn: boolean;
  linkConsumed: boolean;
  selectionCollapsed: boolean;
}): boolean {
  return !opts.numberColumn && !opts.linkConsumed && opts.selectionCollapsed;
}

export interface SlotIntoParams {
  /** The SourceView host (.diffview) whose shadow slots project light children.
   * Undefined until the view has mounted; the action no-ops until it appears. */
  host: HTMLElement | undefined;
  /** 1-based source line whose annotation row this node fills. */
  line: number;
}

/**
 * Svelte action that projects `node` into the host's annotation row for `line`.
 * The node is created by the caller's markup; the action relocates it into the
 * host's light DOM with the library's slot name (and removes it on destroy), so
 * Svelte keeps owning the node's contents while the browser renders it inside the
 * library's reserved row. Re-slots when the line or host changes.
 */
export function slotInto(node: HTMLElement, params: SlotIntoParams) {
  node.dataset.annotationSlot = "";
  // Annotation content is prose, not code — opt out of the code column's
  // white-space: pre so it wraps normally.
  node.style.whiteSpace = "normal";
  let placedIn: HTMLElement | undefined;

  const place = (p: SlotIntoParams) => {
    node.slot = annotationSlotName(p.line);
    if (p.host != null && p.host !== placedIn) {
      p.host.appendChild(node);
      placedIn = p.host;
    }
  };

  place(params);
  return {
    update: place,
    destroy() {
      node.remove();
    },
  };
}
