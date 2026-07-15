import "../../../test-setup.ts";
import { describe, expect, test } from "bun:test";
import {
  createHoverIntent,
  type HoverIntentDeps,
  pointInRect,
  project,
  type Rect,
  speed,
} from "./hoverIntent.ts";

// The hover-intent controller is a pure pointer state machine (mirroring
// lineDrag.ts): while the file preview is open it decides whether the pointer is
// heading into the card (keep) or has left it (dismiss). Both the target rects and
// the timers are injected, so the trajectory logic and its async stop-detection are
// exercised deterministically without a browser or a real clock.

// A token near the top; a preview card below it, with a bare gap (y 116..130)
// between them — the region the fixed 140ms timer used to dismiss mid-crossing.
const TOKEN: Rect = { left: 100, top: 100, right: 160, bottom: 116 };
const CARD: Rect = { left: 100, top: 130, right: 340, bottom: 280 };

/** A hand-rolled clock: setTimer/clearTimer feed the controller, advanceTo fires
 * due timers in chronological order (re-scheduled timers included), so a test can
 * step wall-clock time exactly and watch the grace/idle timers fire. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { fn: () => void; at: number }>();
  return {
    setTimer(fn: () => void, ms: number): number {
      const id = ++seq;
      timers.set(id, { fn, at: now + ms });
      return id;
    },
    clearTimer(id: number): void {
      timers.delete(id);
    },
    advanceTo(target: number): void {
      for (;;) {
        let next: { id: number; fn: () => void; at: number } | null = null;
        for (const [id, t] of timers) {
          if (t.at <= target && (next === null || t.at < next.at)) next = { id, ...t };
        }
        if (next === null) break;
        now = next.at;
        timers.delete(next.id);
        next.fn();
      }
      now = target;
    },
  };
}

/** Build a controller with the two standard rects and a dismiss counter. Pass a
 * partial deps to override (e.g. a null card rect). */
function build(over: Partial<HoverIntentDeps> = {}) {
  const clock = fakeClock();
  const box = { dismissed: 0 };
  const hi = createHoverIntent({
    anchorRect: () => TOKEN,
    cardRect: () => CARD,
    onDismiss: () => {
      box.dismissed++;
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...over,
  });
  return { hi, clock, box };
}

describe("geometry", () => {
  test("pointInRect is inclusive of edges and false for a null rect", () => {
    expect(pointInRect({ x: 130, y: 108 }, TOKEN)).toBe(true);
    expect(pointInRect({ x: 100, y: 100 }, TOKEN)).toBe(true); // top-left corner
    expect(pointInRect({ x: 130, y: 200 }, TOKEN)).toBe(false); // below
    expect(pointInRect({ x: 130, y: 108 }, null)).toBe(false);
  });

  test("project advances the point along the velocity by the horizon", () => {
    expect(project({ x: 10, y: 10 }, { x: 1, y: 2 }, 100)).toEqual({ x: 110, y: 210 });
  });

  test("speed is the velocity magnitude in px/ms", () => {
    expect(speed({ x: 3, y: 4 })).toBe(5);
    expect(speed({ x: 0, y: 0 })).toBe(0);
  });
});

describe("keeping the preview open", () => {
  test("aiming across the gap and resting on the card never dismisses", () => {
    const { hi, clock, box } = build();
    hi.seed({ x: 130, y: 108 }, 0); // parked on the token
    // Moderate-speed samples < idleMs apart, each projecting into the card.
    clock.advanceTo(50);
    hi.sample({ x: 140, y: 118 }, 50);
    clock.advanceTo(100);
    hi.sample({ x: 150, y: 126 }, 100);
    clock.advanceTo(150);
    hi.sample({ x: 180, y: 150 }, 150); // now physically on the card
    clock.advanceTo(1200); // rest on the card, well past idle
    expect(box.dismissed).toBe(0);
  });

  test("a pointer parked on the token (seeded, never moved) never dismisses", () => {
    const { hi, clock, box } = build();
    hi.seed({ x: 130, y: 108 }, 0);
    clock.advanceTo(10_000);
    expect(box.dismissed).toBe(0);
  });

  test("jumping straight onto the card and resting keeps it open", () => {
    const { hi, clock, box } = build();
    hi.seed({ x: 130, y: 108 }, 0);
    clock.advanceTo(100);
    hi.sample({ x: 200, y: 180 }, 100); // on the card
    clock.advanceTo(1000);
    expect(box.dismissed).toBe(0);
  });
});

describe("dismissing the preview", () => {
  test("stopping in the gap after aiming dismisses one idle-window later", () => {
    const { hi, clock, box } = build();
    hi.seed({ x: 130, y: 108 }, 0);
    clock.advanceTo(100);
    hi.sample({ x: 150, y: 124 }, 100); // in the gap, aiming into the card -> idle armed at 200
    clock.advanceTo(199);
    expect(box.dismissed).toBe(0); // still within the idle window
    clock.advanceTo(200);
    expect(box.dismissed).toBe(1); // stopped outside the card -> dismissed
  });

  test("a decisive move away dismisses a grace-window after leaving, even while still moving", () => {
    const { hi, clock, box } = build();
    hi.seed({ x: 130, y: 108 }, 0);
    clock.advanceTo(50);
    hi.sample({ x: 130, y: 60 }, 50); // moving up, away from the card -> grace armed at 190
    clock.advanceTo(100);
    hi.sample({ x: 130, y: 20 }, 100); // still moving away, grace not postponed
    clock.advanceTo(189);
    expect(box.dismissed).toBe(0);
    clock.advanceTo(190);
    expect(box.dismissed).toBe(1);
  });

  test("re-aiming before the grace fires rescues the preview", () => {
    const { hi, clock, box } = build();
    hi.seed({ x: 130, y: 108 }, 0);
    clock.advanceTo(50);
    hi.sample({ x: 130, y: 60 }, 50); // away -> grace armed at 190
    clock.advanceTo(180);
    hi.sample({ x: 150, y: 126 }, 180); // aiming back into the card -> grace cleared
    clock.advanceTo(191);
    expect(box.dismissed).toBe(0); // the 190 grace never fired
    clock.advanceTo(210);
    hi.sample({ x: 200, y: 180 }, 210); // onto the card
    clock.advanceTo(1000);
    expect(box.dismissed).toBe(0);
  });
});

describe("edge cases", () => {
  test("a not-yet-painted (null) card rect never aims and never crashes", () => {
    const { hi, clock, box } = build({ cardRect: () => null });
    hi.seed({ x: 130, y: 108 }, 0);
    clock.advanceTo(100);
    hi.sample({ x: 150, y: 126 }, 100); // no card to aim at, off the token -> grace at 240
    clock.advanceTo(239);
    expect(box.dismissed).toBe(0);
    clock.advanceTo(240);
    expect(box.dismissed).toBe(1);
  });

  test("destroy cancels a pending dismissal", () => {
    const { hi, clock, box } = build();
    hi.seed({ x: 130, y: 108 }, 0);
    clock.advanceTo(50);
    hi.sample({ x: 130, y: 60 }, 50); // grace armed at 190
    hi.destroy();
    clock.advanceTo(1000);
    expect(box.dismissed).toBe(0);
  });
});
