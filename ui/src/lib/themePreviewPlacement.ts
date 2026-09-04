// Places the theme hover-preview card beside the open Theme menu (EXC-753). The menu is a
// bits-ui / Floating UI popover positioned ASYNCHRONOUSLY: its transform is applied a
// microtask after mount (see bits-ui's use-floating — `computePosition(...).then(...)` sets
// x/y and only then flips `isPositioned`), so until it resolves the menu sits at the
// viewport origin with `transform: translate(0, 0)`.
//
// Measuring the menu synchronously in the same reactive flush that renders the card can
// therefore read that origin rect during a fast reopen and strand the card in the top-left
// corner — the intermittent positioning glitch this fixes. Deferring the measurement to the
// next animation frame lands it AFTER the positioning microtask has run, so the card always
// anchors to the menu's settled rect. The geometry and the frame scheduling are split so
// both are unit-testable without a browser: SettingSelect injects live DOM measurements and
// requestAnimationFrame.

/** The subset of DOMRect the placement math reads (a DOMRect satisfies it structurally). */
export interface Box {
  top: number;
  right: number;
  left: number;
  width: number;
  height: number;
}

/** Viewport extent the card must stay clear of. */
export interface Viewport {
  width: number;
  height: number;
}

export interface PlacementOptions {
  /** Gap between the menu's edge and the card. */
  gap: number;
  /** Minimum distance the card keeps from every viewport edge. */
  margin: number;
}

/** Where the card sits beside the menu: prefer the right side, flip to the left when it
 * would overflow, then clamp vertically into the viewport. Pure — the caller supplies live
 * measurements — so it is directly unit-testable. */
export function placeBesideMenu(
  menu: Box,
  card: Box,
  view: Viewport,
  { gap, margin }: PlacementOptions,
): { top: number; left: number } {
  let left = menu.right + gap;
  if (left + card.width > view.width - margin) {
    const leftSide = menu.left - gap - card.width;
    left = leftSide >= margin ? leftSide : Math.max(margin, view.width - card.width - margin);
  }
  const top = Math.max(margin, Math.min(menu.top, view.height - card.height - margin));
  return { top, left };
}

export interface DeferredPlacementDeps {
  /** Menu rect, read at frame time — the async-positioned popover the card anchors to. */
  menu: () => Box;
  /** Card rect, for its own size in the collision math. */
  card: () => Box;
  /** Viewport size. */
  view: () => Viewport;
  /** Commit the computed coordinates to the card. */
  place: (pos: { top: number; left: number }) => void;
  /** Frame scheduler — injected so tests drive it deterministically. */
  raf: (cb: () => void) => number;
  /** Cancel a scheduled frame. */
  cancel: (handle: number) => void;
}

/** Measure and place the card on the NEXT animation frame, rather than synchronously —
 * the deferral the module header explains. Re-invoked whenever the highlighted option
 * changes, so each move re-measures on its own frame. Returns a teardown that cancels
 * the pending frame. */
export function placeOnNextFrame(
  deps: DeferredPlacementDeps,
  options: PlacementOptions,
): () => void {
  // `cancelled` makes a frame that still fires after teardown a no-op even if `cancel`
  // didn't reach it in time, so a late frame can't write to (and re-render) an unmounted
  // component. A real browser's cancelAnimationFrame reaches it; happy-dom's does not.
  let cancelled = false;
  const handle = deps.raf(() => {
    if (cancelled) return;
    deps.place(placeBesideMenu(deps.menu(), deps.card(), deps.view(), options));
  });
  return () => {
    cancelled = true;
    deps.cancel(handle);
  };
}
