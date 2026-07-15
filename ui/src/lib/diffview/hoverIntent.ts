// Hover-intent for the file-preview card (EXC-799). While the preview is open,
// the reader's pointer is tracked; from its speed and direction the controller
// projects where it will be a short time ahead, and if that lands inside the card
// the preview stays open — so travelling from the token across the gap to the card
// no longer trips a fixed dismiss timer mid-flight. A stop is conclusive: a pointer
// at rest has no trajectory, so a rest outside the card (or token) dismisses.
//
// Kept a pure, DOM-free state machine (like lineDrag.ts): the target rects and the
// timers are injected, so both the trajectory decision and its async stop-detection
// unit-test deterministically. The consumer (DiffPlanView) supplies live viewport
// rects, rAF-throttled pointer samples, and real setTimeout/clearTimeout.

export interface Point {
  x: number;
  y: number;
}

/** A velocity in px/ms (dx, dy per millisecond). */
export interface Vector {
  x: number;
  y: number;
}

/** A viewport rectangle (getBoundingClientRect's left/top/right/bottom). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Whether `p` sits within `r` (edges inclusive). A null rect (e.g. a card that
 * has not painted yet) contains nothing. */
export function pointInRect(p: Point, r: Rect | null): boolean {
  return r !== null && p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
}

/** Where `p` is projected to be `ms` milliseconds ahead at velocity `vel`. */
export function project(p: Point, vel: Vector, ms: number): Point {
  return { x: p.x + vel.x * ms, y: p.y + vel.y * ms };
}

/** Velocity magnitude (px/ms). */
export function speed(vel: Vector): number {
  return Math.hypot(vel.x, vel.y);
}

export interface HoverIntentOptions {
  /** How far ahead the pointer is projected (ms). Default 250. */
  lookaheadMs?: number;
  /** How long a pointer moving away/outside is tolerated before dismissing (ms).
   * Default 140. */
  graceMs?: number;
  /** No movement for this long counts as a stop, triggering the conclusive
   * re-evaluation at rest (ms). Default 100. */
  idleMs?: number;
  /** Speed (px/ms) at or below which motion counts as stopped, so a near-still
   * pointer is never treated as "aiming". Default 0.05. */
  stopSpeed?: number;
}

export interface HoverIntentDeps {
  /** The hovered token's viewport box (the pointer resting on it keeps the
   * preview). */
  anchorRect: () => Rect | null;
  /** The preview card's viewport box, or null until it paints (the pointer
   * resting on it, or heading into it, keeps the preview). */
  cardRect: () => Rect | null;
  /** The pointer has conclusively left — dismiss the preview. */
  onDismiss: () => void;
  /** Schedule a callback; returns a handle for clearTimer. Production wires
   * window.setTimeout; tests inject a fake clock. */
  setTimer: (fn: () => void, ms: number) => number;
  clearTimer: (handle: number) => void;
  options?: HoverIntentOptions;
}

export interface HoverIntent {
  /** Record the opening position without deciding — a parked pointer just stays. */
  seed: (p: Point, t: number) => void;
  /** Feed one pointer sample (position + timestamp in ms). */
  sample: (p: Point, t: number) => void;
  /** Stop tracking and cancel any pending dismissal. */
  destroy: () => void;
}

export function createHoverIntent(deps: HoverIntentDeps): HoverIntent {
  const lookaheadMs = deps.options?.lookaheadMs ?? 250;
  const graceMs = deps.options?.graceMs ?? 140;
  const idleMs = deps.options?.idleMs ?? 100;
  const stopSpeed = deps.options?.stopSpeed ?? 0.05;

  let last: { p: Point; t: number } | null = null;
  let graceHandle: number | null = null;
  let idleHandle: number | null = null;

  function clearGrace(): void {
    if (graceHandle !== null) {
      deps.clearTimer(graceHandle);
      graceHandle = null;
    }
  }
  function clearIdle(): void {
    if (idleHandle !== null) {
      deps.clearTimer(idleHandle);
      idleHandle = null;
    }
  }

  function onTarget(p: Point): boolean {
    return pointInRect(p, deps.anchorRect()) || pointInRect(p, deps.cardRect());
  }
  function aiming(p: Point, vel: Vector): boolean {
    const card = deps.cardRect();
    return (
      card !== null && speed(vel) > stopSpeed && pointInRect(project(p, vel, lookaheadMs), card)
    );
  }

  return {
    seed(p, t) {
      last = { p, t };
    },
    sample(p, t) {
      const prev = last;
      last = { p, t };
      const dt = prev === null ? 0 : Math.max(t - prev.t, 1);
      const vel: Vector =
        prev === null ? { x: 0, y: 0 } : { x: (p.x - prev.p.x) / dt, y: (p.y - prev.p.y) / dt };

      if (onTarget(p) || aiming(p, vel)) {
        // On or heading into a target: stay open. Re-arm the idle check so a
        // later stop in the gap is still caught.
        clearGrace();
        clearIdle();
        idleHandle = deps.setTimer(() => {
          idleHandle = null;
          // At rest the pointer has no trajectory; dismiss if it stopped off-target.
          if (last !== null && !onTarget(last.p)) deps.onDismiss();
        }, idleMs);
      } else {
        // Outside every target and not heading in: dismiss after the grace. Once
        // armed it is not postponed by further off-target moves, so a decisive
        // move-away dismisses whether or not the pointer keeps moving.
        clearIdle();
        if (graceHandle === null) {
          graceHandle = deps.setTimer(() => {
            graceHandle = null;
            deps.onDismiss();
          }, graceMs);
        }
      }
    },
    destroy() {
      clearGrace();
      clearIdle();
    },
  };
}
