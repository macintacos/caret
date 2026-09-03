import { describe, expect, test } from "bun:test";

import {
  type Box,
  placeBesideMenu,
  placeOnNextFrame,
  type Viewport,
} from "./themePreviewPlacement.ts";

const OPTS = { gap: 10, margin: 8 };
const VIEW: Viewport = { width: 1200, height: 800 };

// A menu opened low-left in a roomy viewport, and a typical preview card.
const MENU: Box = { top: 300, right: 220, left: 20, width: 200, height: 180 };
const CARD: Box = { top: 0, right: 0, left: 0, width: 258, height: 160 };

// bits-ui positions its popover asynchronously; until it resolves the menu sits at the
// viewport origin (transform: translate(0,0)). This is the rect a premature measurement
// reads — the one that strands the card at the top-left corner.
const ORIGIN: Box = { top: 0, right: 0, left: 0, width: 0, height: 0 };

describe("placeBesideMenu", () => {
  test("prefers the right side of the menu, aligned to the menu top", () => {
    expect(placeBesideMenu(MENU, CARD, VIEW, OPTS)).toEqual({ top: 300, left: 230 });
  });

  test("flips to the left when the right side would overflow the viewport", () => {
    const menu: Box = { top: 100, right: 1150, left: 950, width: 200, height: 180 };
    // left side = 950 - 10 - 258 = 682, which fits past the margin.
    expect(placeBesideMenu(menu, CARD, VIEW, OPTS)).toEqual({ top: 100, left: 682 });
  });

  test("clamps to the right margin when neither side fits (a too-wide card)", () => {
    const menu: Box = { top: 100, right: 700, left: 500, width: 200, height: 180 };
    const wide: Box = { ...CARD, width: 1190 };
    // Right overflows and the left side is off-screen, so clamp: 1200 - 1190 - 8 = 2,
    // floored to the margin (8).
    expect(placeBesideMenu(menu, wide, VIEW, OPTS)).toEqual({ top: 100, left: 8 });
  });

  test("clamps the top down so the card never runs off the bottom edge", () => {
    const menu: Box = { ...MENU, top: 750 };
    // 800 - 160 - 8 = 632.
    expect(placeBesideMenu(menu, CARD, VIEW, OPTS).top).toBe(632);
  });

  test("clamps the top up to the margin when the menu sits above the viewport", () => {
    const menu: Box = { ...MENU, top: -50 };
    expect(placeBesideMenu(menu, CARD, VIEW, OPTS).top).toBe(8);
  });

  test("a menu measured at the origin lands the card in the top-left corner", () => {
    // This is the glitch position — proof of what a premature measurement produces.
    expect(placeBesideMenu(ORIGIN, CARD, VIEW, OPTS)).toEqual({ top: 8, left: 10 });
  });
});

/** A hand-driven requestAnimationFrame: stores the pending callback so a test can fire the
 * scheduled frame on demand, exercising the deferral deterministically. */
function makeFrameQueue() {
  let next = 0;
  let pending: { id: number; cb: () => void } | null = null;
  return {
    raf: (cb: () => void) => {
      pending = { id: ++next, cb };
      return pending.id;
    },
    cancel: (id: number) => {
      if (pending?.id === id) pending = null;
    },
    /** Run the currently-scheduled frame. */
    tick: () => {
      const p = pending;
      pending = null;
      p?.cb();
    },
    pendingId: () => pending?.id ?? null,
  };
}

/** Schedule a placement over a hand-driven frame queue, recording each placed
 * spot. Defaults to a menu that is already settled at MENU. */
function scheduleOverQueue(
  q: ReturnType<typeof makeFrameQueue>,
  placed: { top: number; left: number }[],
  menu: () => Box = () => MENU,
) {
  return placeOnNextFrame(
    {
      menu,
      card: () => CARD,
      view: () => VIEW,
      place: (p) => placed.push(p),
      raf: q.raf,
      cancel: q.cancel,
    },
    OPTS,
  );
}

describe("placeOnNextFrame", () => {
  test("does not place synchronously — it waits for the frame", () => {
    const q = makeFrameQueue();
    const placed: { top: number; left: number }[] = [];
    scheduleOverQueue(q, placed);
    // Nothing placed yet: a synchronous measurement is exactly what read the premature
    // origin rect in the bug. The frame must run first.
    expect(placed).toEqual([]);
    q.tick();
    expect(placed).toEqual([{ top: 300, left: 230 }]);
  });

  test("measures at frame time, so a menu that settles before the frame is placed correctly (the fix)", () => {
    const q = makeFrameQueue();
    const placed: { top: number; left: number }[] = [];
    // Synchronously the menu is still at the origin (bits-ui not yet positioned);
    // by the time the deferred frame runs it has settled. The frame must measure
    // the settled rect, not the origin a synchronous read would have captured.
    let settled = false;
    scheduleOverQueue(q, placed, () => (settled ? MENU : ORIGIN));
    settled = true; // the positioning microtask runs before the frame
    q.tick();
    expect(placed).toEqual([{ top: 300, left: 230 }]);
  });

  test("teardown cancels the pending frame so it never places", () => {
    const q = makeFrameQueue();
    const placed: { top: number; left: number }[] = [];
    const stop = scheduleOverQueue(q, placed);
    expect(q.pendingId()).not.toBeNull();
    stop();
    expect(q.pendingId()).toBeNull();
    q.tick(); // no-op — the frame was cancelled
    expect(placed).toEqual([]);
  });
});
