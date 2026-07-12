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
 * and ordered: every comment on a line shares that line's single row, where caret
 * stacks them as one ordered thread (see groupAnnotationsByLine), so passing the
 * line more than once would emit duplicate, unfillable slots. */
export function toLineAnnotations(lines: Iterable<number>): SourceLineAnnotation[] {
  return [...new Set(lines)].sort((a, b) => a - b).map((lineNumber) => ({ lineNumber }));
}

/** One anchor line's annotations, in the order they should thread. */
export interface LineAnnotationGroup<A> {
  /** The 1-based source line this group's single annotation row anchors to. */
  line: number;
  /** The annotations stacked in this line's row, in display order. */
  annotations: A[];
}

/**
 * Groups annotations by the line their row anchors to, so each anchor line maps
 * to exactly one projected node — the single library slot per line. The library
 * reserves one annotation row per line, so several comments on a line belong in
 * one caret-owned thread within that row, not as separate nodes fighting for the
 * same slot name. Groups are ordered by line ascending; within a group,
 * annotations keep their input order.
 */
export function groupAnnotationsByLine<A>(
  annotations: Iterable<A>,
  lineOf: (a: A) => number,
): LineAnnotationGroup<A>[] {
  const byLine = new Map<number, A[]>();
  for (const a of annotations) {
    const line = lineOf(a);
    const bucket = byLine.get(line);
    if (bucket) bucket.push(a);
    else byLine.set(line, [a]);
  }
  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([line, group]) => ({ line, annotations: group }));
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
      // Relocating the node with appendChild blurs any focused descendant. The
      // composer autofocuses its editor before this move, so capture the focused
      // element and restore it after — otherwise clicking a line opens a composer
      // the reviewer must click again before typing. preventScroll matches the
      // composer's own autofocus, so restoring focus never jumps the view.
      const focused = node.contains(document.activeElement) ? document.activeElement : null;
      p.host.appendChild(node);
      placedIn = p.host;
      if (focused instanceof HTMLElement) focused.focus({ preventScroll: true });
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
