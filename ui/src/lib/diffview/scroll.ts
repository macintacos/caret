// Scroll-to-line and active-line resolution for the source view. @pierre/diffs
// renders each line as a <div data-line="N"> inside the container's shadow root;
// jumping to a heading finds that row and scrolls the surrounding scroll container
// so the row rests near the top, and the reverse — which line currently occupies
// the top of the view — reads the same row geometry. Lives in the wrapper module
// so the library's DOM shape stays behind the import boundary.
//
// The target offset is computed explicitly against the resolved scroll container
// rather than delegating to row.scrollIntoView(): scrollIntoView picks the
// scrollable ancestor itself across the shadow boundary and will also scroll the
// page when the app overflows the viewport, landing the heading in the wrong
// place. Scrolling the resolved container to an explicit top is exact and lands
// the same regardless of the current scroll position or window size.

/** Breathing room (px) above a jumped-to row so the heading isn't flush against
 * the very top edge of the scroll container. */
export const SCROLL_OFFSET_TOP = 12;

/** Sub-pixel margin (px) below the reading-zone line. A jumped heading parks with
 * its top on that line, and the row above ends its bottom exactly there; smooth
 * scrollTo rounds scrollTop to device pixels, so without this margin the prior
 * row's bottom can round a fraction past the line and steal the active slot — the
 * off-by-one this guards against. Kept well under a source line's height. */
const READING_ZONE_SLOP = 1;

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

// The JS-side mirror of app.css's global reduced-motion rule. The CSS guard
// neutralizes animations and transitions, but scroll behavior is a JS option
// (ScrollBehavior) that no stylesheet can gate from here, so the smooth-scroll
// jump reads this directly to fall back to an instant jump under reduced motion.
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

/**
 * The 1-based line of the row occupying the reading zone — the first row (in
 * document order) whose bottom edge clears `containerTop + SCROLL_OFFSET_TOP` by
 * more than READING_ZONE_SLOP. Probing at that offset (rather than the container's
 * top edge) mirrors where scrollToLine parks a jumped heading, so the section the
 * reader lands on is the one reported as active. `rows` yield each rendered line's
 * viewport `bottom`, in document order, and are consumed lazily — iteration stops
 * at the first match, so the caller can defer per-row measurement. Returns null
 * when none qualify (empty range, or everything scrolled above the zone).
 */
export function lineAtReadingZone(
  rows: Iterable<{ line: number; bottom: number }>,
  containerTop: number,
): number | null {
  const readingZone = containerTop + SCROLL_OFFSET_TOP + READING_ZONE_SLOP;
  for (const row of rows) {
    if (row.bottom > readingZone) return row.line;
  }
  return null;
}
