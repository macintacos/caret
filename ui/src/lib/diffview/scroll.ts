// Scroll-to-line, active-line resolution, the keyboard cursor's follow scroll,
// and the composer reveal — the source view's scrolling. @pierre/diffs
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
import { quadOut } from "svelte/easing";

import type { DiffSide } from "$lib/diffview/types.ts";

/** Breathing room (px) above a jumped-to row so the heading isn't flush against
 * the very top edge of the scroll container. */
export const SCROLL_OFFSET_TOP = 12;

/** Duration (ms) of a jump to a place — the JS mirror of --dur-travel. */
export const SCROLL_ANIM_MS = 240;

/** Duration (ms) of the cursor follow — the JS mirror of --dur-micro. Shorter than
 * a jump because it is a different move: the follow nudges by roughly one row, and
 * a held j/k retargets it every few frames, so a jump-length glide would leave the
 * view trailing the cursor instead of carrying it. */
export const FOLLOW_ANIM_MS = 120;

/**
 * The scrollTop a scroll should be at `elapsed` ms into its flight. Pure (no DOM)
 * so it is directly unit-testable, like followScrollDelta and revealScrollDelta.
 *
 * quadOut decelerates into the target, and the CHOICE OF EXPONENT is the whole
 * design here: --ease-out's quintic-feeling curve and cubicOut both spend their
 * last frames moving less than a pixel, so the deceleration is real in the maths
 * and invisible on screen. quadOut keeps the final frames moving in perceptible
 * steps, so the view is seen coming to rest. Clamped at both ends, so an early or
 * overrun frame cannot overshoot.
 */
export function scrollTweenTop(g: {
  from: number;
  to: number;
  elapsed: number;
  duration: number;
}): number {
  const t = Math.min(1, Math.max(0, g.elapsed / g.duration));
  return g.from + (g.to - g.from) * quadOut(t);
}

/** Sub-pixel margin (px) below the reading-zone line. A jumped heading parks with
 * its top on that line, and the row above ends its bottom exactly there; the
 * browser rounds scrollTop to device pixels, so without this margin the prior
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
// neutralizes animations and transitions, but scroll position is a JS property no
// stylesheet can drive from here, so every scroll in this file reads this directly
// to fall back to an instant move under the preference.
function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** How far (px) the scroller may drift from what the tween last wrote before the
 * tween treats it as someone else's scroll. The read-back below already absorbs
 * the browser's own rounding and clamping, so what is left for the slop is drift
 * a set/get round-trip cannot report exactly — a fractional device-pixel ratio,
 * page zoom, or a reflow re-clamping scrollTop as rows paint in. */
const SCROLL_TAKEOVER_SLOP = 1;

// The plan has one scroll container, so at most one flight is ever in the air: a
// second scroll cancels the first rather than leaving two loops writing scrollTop
// on the same frame. That is also how a held j/k works — each keystroke retargets
// the flight from wherever it currently is, so the view chases the cursor rather
// than restarting. No disposer is handed back — a flight lasts at most
// SCROLL_ANIM_MS and a detached scroller absorbs the writes — so the handle is
// cleared on every exit path instead, and undefined means nothing is in flight.
let jumpFrame: number | undefined;

/** Tweens `scroller` to `top` over `duration`, or moves outright under reduced
 * motion. Both of the plan's scrolls run through here — the jump to a place and
 * the cursor follow — so they share one curve and one in-flight handle, and only
 * differ in how long they take.
 *
 * The tween owns the scroll only until something else moves it in ONE step — a
 * wheel, a trackpad fling — at which point it lets go, the way the browser's own
 * smooth scroll yields to a reader who scrolls. What it cannot detect is a gradual
 * mover: revealCard's smooth scrollBy advances by less than SCROLL_TAKEOVER_SLOP
 * per frame, so a composer reveal landing inside a flight is overwritten rather
 * than yielded to. Narrow (a line click within one flight of a scroll) and left
 * alone deliberately — routing revealCard through this driver is the real fix. */
function animateScrollTop(scroller: HTMLElement, top: number, duration: number): void {
  if (jumpFrame !== undefined) cancelAnimationFrame(jumpFrame);
  jumpFrame = undefined;
  // Assignment, not scrollTo({ behavior: "instant" }): nothing sets scroll-behavior
  // on the plan surface, and base.css forces it to `auto !important` under reduced
  // motion — the path where a smooth behavior would actually defeat the guarantee.
  if (prefersReducedMotion()) {
    scroller.scrollTop = top;
    return;
  }

  const from = scroller.scrollTop;
  const start = performance.now();
  // What the previous frame left behind, read back so the browser's own rounding
  // and end-of-range clamping don't read as a third party taking over.
  let written = from;

  function step(): void {
    if (Math.abs(scroller.scrollTop - written) > SCROLL_TAKEOVER_SLOP) {
      jumpFrame = undefined;
      return;
    }
    const elapsed = performance.now() - start;
    if (elapsed >= duration) {
      scroller.scrollTop = top;
      jumpFrame = undefined;
      return;
    }
    scroller.scrollTop = scrollTweenTop({ from, to: top, elapsed, duration });
    written = scroller.scrollTop;
    jumpFrame = requestAnimationFrame(step);
  }

  jumpFrame = requestAnimationFrame(step);
}

/** Scrolls `container`'s nearest scroll parent so `row` rests near the top,
 * animating unless the user prefers reduced motion. The geometry the
 * single-document and diff reveals share, once each has resolved its own row. */
function scrollRowIntoView(container: HTMLElement, row: HTMLElement): void {
  const scroller = nearestScrollParent(container);
  // No identifiable scroll container (e.g. detached/odd layout): fall back to the
  // library row's own scrollIntoView so the jump still works. There is no element
  // to tween, so this half keeps the browser's own smooth scroll.
  if (scroller == null) {
    row.scrollIntoView({ block: "start", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    return;
  }

  // scrollTop that puts the row's top SCROLL_OFFSET_TOP below the container's top
  // edge. scrollTop + (row.top - container.top) is the row's absolute offset in
  // the scroll content, invariant of the current scroll position.
  const rowRect = row.getBoundingClientRect();
  const hostRect = scroller.getBoundingClientRect();
  const top = Math.max(0, scroller.scrollTop + (rowRect.top - hostRect.top) - SCROLL_OFFSET_TOP);
  animateScrollTop(scroller, top, SCROLL_ANIM_MS);
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
  scrollRowIntoView(container, row);
  return true;
}

/**
 * Scrolls the diff view so the row for 1-based `line` on `side` rests near the top
 * of the scroll container. The diff counterpart to scrollToLine: a line number
 * alone is ambiguous across two documents, so the side picks which row it names.
 * Returns whether a matching row was found.
 */
export function scrollToDiffLine(container: HTMLElement, line: number, side: DiffSide): boolean {
  // The library wraps each rendered column in a <code> marked data-unified (one
  // column) or data-deletions/data-additions (two), and stamps each row with
  // data-line (its own side's number), data-alt-line (the other side's, absent on
  // a change row) and data-line-type. Split gives each side its own column, so a
  // scoped query suffices. Unified has one column that carries the *addition*
  // content wherever both sides exist — so a context row holds the after number in
  // data-line and the before number in data-alt-line, while a change renders as two
  // rows. $="deletion" matches change-deletion without pinning the exact token.
  // The columns are mutually exclusive, so trying every selector is correct in
  // either layout and no diffStyle has to be threaded down here.
  const selectors =
    side === "after"
      ? [
          `[data-additions] [data-line="${line}"]`,
          `[data-unified] [data-line="${line}"]:not([data-line-type$="deletion"])`,
        ]
      : [
          `[data-deletions] [data-line="${line}"]`,
          `[data-unified] [data-line="${line}"][data-line-type$="deletion"]`,
          `[data-unified] [data-alt-line="${line}"]:not([data-line-type$="deletion"])`,
        ];
  const row = container.shadowRoot?.querySelector<HTMLElement>(selectors.join(","));
  // ponytail: a line inside a collapsed unchanged band has no row, so this is a
  // no-op — the same semantics scrollToLine has for an unpainted line. Auto-expand
  // the containing band (the library's expandedHunks) if the miss matters.
  if (row == null) return false;
  scrollRowIntoView(container, row);
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
 * leaves the screen. Animated over FOLLOW_ANIM_MS through the same driver and
 * curve as the jump; only where the two land differs. A held key retargets the
 * flight rather than restarting it, so the steps read as one continuous glide
 * instead of a stack of hops. Returns whether a matching row was found.
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
  if (delta !== 0) animateScrollTop(scroller, scroller.scrollTop + delta, FOLLOW_ANIM_MS);
  return true;
}

/** Breathing room (px) below a revealed composer card, so its action row isn't
 * flush against the scroll container's bottom edge. Mirrors SCROLL_OFFSET_TOP's
 * role at the other edge. */
export const REVEAL_MARGIN_BOTTOM = 12;

/** How many times revealCard re-checks a card's height before measuring anyway.
 * The editor inside a composer builds in its own effect, so the card is still
 * growing on the mount frame; the cap keeps a card that never settles (an
 * animation, a stuck load) from retrying forever. */
const REVEAL_SETTLE_RETRIES = 30;

/**
 * The downward scroll delta (px) that brings a card fully into the reading
 * viewport, moving the view as little as it can: `0` when the card already fits
 * above `margin`, otherwise the exact overshoot past that margin. Pure geometry
 * (no DOM) so it is directly unit-testable.
 *
 * The result is clamped to `cardTop - viewTop`, and never negative: a card taller
 * than the viewport cannot be revealed in full, and scrolling by the raw overshoot
 * would push its top — its label, and the anchor line it belongs to — off the top
 * edge. Clamping reveals such a card from its top down instead, and makes the
 * reveal strictly downward, so it can never fight a scroll that already parked the
 * anchor line.
 */
export function revealScrollDelta(g: {
  cardTop: number;
  cardBottom: number;
  viewTop: number;
  viewBottom: number;
  margin: number;
}): number {
  const overshoot = g.cardBottom + g.margin - g.viewBottom;
  if (overshoot <= 0) return 0; // already fits → the view does not move at all
  return Math.min(overshoot, Math.max(0, g.cardTop - g.viewTop));
}

/**
 * Scrolls the plan just far enough to reveal `card` in full, once its height has
 * settled, animating unless the user prefers reduced motion. A one-shot: it
 * measures once and does not follow the card as it grows. Returns a disposer that
 * cancels a pending measurement, so a composer dismissed inside the settle window
 * never scrolls the view after it is gone.
 */
export function revealCard(card: HTMLElement): () => void {
  // NaN so the first comparison never matches: the mount frame, where the editor
  // has not built yet, is never the frame the reveal measures on.
  let lastHeight = Number.NaN;
  let retries = 0;
  let pending = requestAnimationFrame(measure);

  function measure(): void {
    const cardRect = card.getBoundingClientRect();
    // Height still moving (and budget left) → look again next frame.
    if (cardRect.height !== lastHeight && retries < REVEAL_SETTLE_RETRIES) {
      lastHeight = cardRect.height;
      retries += 1;
      pending = requestAnimationFrame(measure);
      return;
    }
    const scroller = nearestScrollParent(card);
    if (scroller == null) return;
    const hostRect = scroller.getBoundingClientRect();
    const delta = revealScrollDelta({
      cardTop: cardRect.top,
      cardBottom: cardRect.bottom,
      viewTop: hostRect.top,
      viewBottom: hostRect.bottom,
      margin: REVEAL_MARGIN_BOTTOM,
    });
    if (delta !== 0) {
      scroller.scrollBy({ top: delta, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
  }

  return () => cancelAnimationFrame(pending);
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
