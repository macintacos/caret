// Hold-to-repeat for the plan's heading-navigation keys (EXC-1122). A held key
// should move one item, pause, then traverse steadily until it is let go — and
// the OS cannot give that. Its repeat delay and rate are per-user settings
// (roughly 500-650ms before the first repeat on macOS), so the same hold feels
// different on every machine and is not portably simulable in a test.
//
// So the app owns the whole `keydown → delay → run → keyup` lifecycle itself,
// which only works if the OS's own repeat is kept out: `preventDefault()` does
// not stop the browser emitting repeats, so a handler that does not bail on
// `e.repeat` lets the native repeat and this timer drive the list at once, and
// every hold double-steps. The bail belongs on the REAL keydown, before any
// translation — a synthetic KeyboardEvent never carries `repeat`, so a key
// re-dispatched as an arrow always arrives looking like a first press.
//
// The move itself is the caller's closure, which is what lets one helper serve
// surfaces that dispatch differently: PlanBreadcrumbs re-dispatches onto
// `document.activeElement`, a moving target as focus walks into a submenu, while
// PlanToc and the breadcrumb filter panel dispatch onto their fixed query field.
//
// The end of a hold is watched on `window` rather than on the surface, because
// the walk moves focus out from under any element-level listener — stepping the
// breadcrumbs bar to another crumb's menu replaces the whole content node — and a
// missed keyup is a run that never stops. A window `blur` ends it too: a window
// that loses focus mid-hold never delivers the keyup at all.

/** Quiet window between the first move and the run, in milliseconds. */
export const KEY_REPEAT_DELAY_MS = 250;

/** Cadence of the run once it starts, in milliseconds — about sixteen moves a
 * second, fast enough to cross a long heading list and slow enough to stop on
 * the row you meant. */
export const KEY_REPEAT_INTERVAL_MS = 60;

export interface KeyRepeatDeps {
  /**
   * setTimeout-shaped: run `fn` after `ms`, returning a cancel fn. Injectable so
   * tests drive the delay and the run deterministically. Defaults to setTimeout.
   */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Overrides {@link KEY_REPEAT_DELAY_MS}. */
  delayMs?: number;
  /** Overrides {@link KEY_REPEAT_INTERVAL_MS}. */
  intervalMs?: number;
}

export interface KeyRepeat {
  /**
   * Move once now, then run `step` on the app's own cadence until `key` is
   * released. `key` is the `KeyboardEvent.key` of the press being held: only its
   * own keyup ends the run, so letting go of shift mid `Shift+Tab` does not.
   *
   * One hold at a time — starting a second cancels the first rather than leaving
   * two timers driving one list.
   */
  start(key: string, step: () => void): void;
  /**
   * Cancel the hold in flight: no timer left armed, no listener left registered.
   * Idempotent, and what a surface calls when it closes — a run outliving its
   * menu keeps dispatching arrows at whatever holds focus next.
   */
  stop(): void;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};

export function createKeyRepeat(deps: KeyRepeatDeps = {}): KeyRepeat {
  const schedule = deps.schedule ?? defaultSchedule;
  const delayMs = deps.delayMs ?? KEY_REPEAT_DELAY_MS;
  const intervalMs = deps.intervalMs ?? KEY_REPEAT_INTERVAL_MS;

  // Teardown for the hold in flight, undefined when nothing is held. One handle
  // for the timer AND the two listeners, so there is a single thing to forget.
  let end: (() => void) | undefined;

  function stop(): void {
    const teardown = end;
    // Cleared before the teardown runs, not after: removing the blur listener
    // re-enters nothing today, but a stop that is still "in flight" while its own
    // teardown fires is the shape that turns into a double-cancel later.
    end = undefined;
    teardown?.();
  }

  function start(key: string, step: () => void): void {
    stop();
    step();

    // A re-arming timeout rather than an interval, so the delay and the cadence
    // are one mechanism with one cancel handle — and so `schedule` stays the
    // single injected effect a test has to drive.
    let cancelTimer: (() => void) | undefined;
    const tick = (): void => {
      step();
      cancelTimer = schedule(tick, intervalMs);
    };
    cancelTimer = schedule(tick, delayMs);

    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === key) stop();
    };
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", stop);
    end = () => {
      cancelTimer?.();
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", stop);
    };
  }

  return { start, stop };
}
