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

/** Rows the follow keeps between the keyboard cursor and each viewport edge — a
 * vim-style `scrolloff`. Stepping the cursor into this margin scrolls the view
 * with it (one row per keystroke) instead of letting the cursor reach the edge. */
export const CURSOR_SCROLLOFF = 5;

/**
 * The vertical scroll delta (px) that keeps the cursor row at least `scrolloff`
 * row-heights from the top and bottom of the reading viewport: negative scrolls
 * up, positive down, `0` when the row already sits comfortably inside the band.
 * Pure geometry (no DOM) so it is directly unit-testable. Because a motion steps
 * the cursor one row, the delta is one row-height at the edge — the view follows
 * the cursor by a line rather than yanking it to the top on every keystroke.
 */
export function followScrollDelta(g: {
  rowTop: number;
  rowBottom: number;
  rowHeight: number;
  viewTop: number;
  viewBottom: number;
  scrolloff: number;
}): number {
  const margin = g.scrolloff * g.rowHeight;
  const topBound = g.viewTop + margin;
  const bottomBound = g.viewBottom - margin;
  if (g.rowTop < topBound) return g.rowTop - topBound; // above the band → scroll up
  if (g.rowBottom > bottomBound) return g.rowBottom - bottomBound; // below the band → scroll down
  return 0;
}

/**
 * Scrolls the source view just enough to keep the row for 1-based `line` inside a
 * `CURSOR_SCROLLOFF`-row band of the viewport edges — the keyboard cursor's
 * follow scroll. Unlike `scrollToLine` (which always parks the row near the top),
 * it scrolls by the exact overshoot and only once the cursor reaches the margin,
 * so a held `j`/`k` scrolls the view one row at a time and the cursor never
 * leaves the screen. Instant (never smooth) so the follow keeps pace with the
 * keystrokes. Returns whether a matching row was found.
 */
export function followCursorLine(container: HTMLElement, line: number): boolean {
  const row = container.shadowRoot?.querySelector<HTMLElement>(`[data-line="${line}"]`);
  if (row == null) return false;
  const scroller = nearestScrollParent(container);
  // No identifiable scroll container: defer to scrollToLine's own fallback.
  if (scroller == null) return scrollToLine(container, line);
  const rowRect = row.getBoundingClientRect();
  const hostRect = scroller.getBoundingClientRect();
  const delta = followScrollDelta({
    rowTop: rowRect.top,
    rowBottom: rowRect.bottom,
    rowHeight: rowRect.height,
    viewTop: hostRect.top,
    viewBottom: hostRect.bottom,
    scrolloff: CURSOR_SCROLLOFF,
  });
  if (delta !== 0) scroller.scrollBy({ top: delta, behavior: "auto" });
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
