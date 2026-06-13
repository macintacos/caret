// Scroll-to-line for the source view. @pierre/diffs renders each line as a
// <div data-line="N"> inside the container's shadow root; jumping to a heading
// finds that row and scrolls the surrounding scroll container so the row rests
// near the top. Lives in the wrapper module so the library's DOM shape stays
// behind the import boundary.
//
// The target offset is computed explicitly against the resolved scroll container
// rather than delegating to row.scrollIntoView(): scrollIntoView picks the
// scrollable ancestor itself across the shadow boundary and will also scroll the
// page when the app overflows the viewport, landing the heading in the wrong
// place. Scrolling the resolved container to an explicit top is exact and lands
// the same regardless of the current scroll position or window size.

/** Breathing room (px) above a jumped-to row so the heading isn't flush against
 * the very top edge of the scroll container. */
const SCROLL_OFFSET_TOP = 12;

/** Nearest scrollable ancestor of `el` (the element that actually scrolls). */
function nearestScrollParent(el: HTMLElement): HTMLElement | undefined {
  let node = el.parentElement;
  while (node != null) {
    const overflowY = getComputedStyle(node).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return node;
    node = node.parentElement;
  }
  return undefined;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Scrolls the source view so the row for 1-based `line` rests near the top of the
 * scroll container, animating unless the user prefers reduced motion. Returns
 * whether a matching row was found (false when the line is outside the rendered
 * range or the view has not painted yet).
 */
export function scrollToLine(container: HTMLElement, line: number): boolean {
  const row = container.shadowRoot?.querySelector<HTMLElement>(`[data-line="${line}"]`);
  if (row == null) return false;
  const behavior: ScrollBehavior = prefersReducedMotion() ? "auto" : "smooth";

  const scroller = nearestScrollParent(container);
  // No identifiable scroll container (e.g. detached/odd layout): fall back to the
  // library row's own scrollIntoView so the jump still works.
  if (scroller == null) {
    row.scrollIntoView({ block: "start", behavior });
    return true;
  }

  // scrollTop that puts the row's top SCROLL_OFFSET_TOP below the container's top
  // edge. scrollTop + (row.top - container.top) is the row's absolute offset in
  // the scroll content, invariant of the current scroll position.
  const rowRect = row.getBoundingClientRect();
  const hostRect = scroller.getBoundingClientRect();
  const top = Math.max(0, scroller.scrollTop + (rowRect.top - hostRect.top) - SCROLL_OFFSET_TOP);
  scroller.scrollTo({ top, behavior });
  return true;
}
