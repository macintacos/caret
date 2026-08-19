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
// translation — the arrow a surface re-dispatches does not copy `repeat` off the
// press it came from, so by then a held key looks like a first press.
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
//
// `walkCommandList` at the bottom is the one claim that IS shared rather than
// per-surface: the bar's `/` filter panel and the ToC popup are the same bits-ui
// `Command` over the same query field, so the keys they walk with and how those
// reach the primitive are one piece of logic, not two copies of one.

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

  // The hold in flight, undefined when nothing is held. It is an OBJECT rather than
  // a boolean because its identity is what the run checks itself against: `step()`
  // can end the hold from the inside — a menu closing calls stop() synchronously —
  // and a run that armed its next tick without re-reading this would leave a timer
  // nothing has a handle to. Releasing the key could not cancel it, an unmount could
  // not, and neither could the next hold, so it would tick for the life of the page.
  let live: { cancel(): void } | undefined;

  function stop(): void {
    const hold = live;
    // Cleared before the teardown runs, so a cancel that re-enters stop() — or a
    // step() that is still on the stack — sees the hold already gone.
    live = undefined;
    hold?.cancel();
  }

  function start(key: string, step: () => void): void {
    stop();

    // A re-arming timeout rather than an interval, so the delay and the cadence
    // are one mechanism with one cancel handle — and so `schedule` stays the
    // single injected effect a test has to drive.
    let cancelTimer: (() => void) | undefined;
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.key === key) stop();
    };
    const hold = {
      cancel(): void {
        cancelTimer?.();
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", stop);
      },
    };

    // Registered BEFORE the first move, so a step() that ends the hold on the spot
    // finds something to end rather than being swallowed and leaving a run armed.
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", stop);
    live = hold;

    const tick = (): void => {
      step();
      if (live !== hold) return;
      cancelTimer = schedule(tick, KEY_REPEAT_INTERVAL_MS);
    };

    step();
    if (live !== hold) return;
    cancelTimer = schedule(tick, KEY_REPEAT_DELAY_MS);
  }

  return { start, stop };
}

/** The keys a bits-ui `Command` list walks with here, mapped onto the arrow each
 * one means. The arrows map to THEMSELVES, which buys nothing about where the walk
 * goes — the primitive would do the same — and everything about the cadence it goes
 * at: a key claimed here repeats on the app's timer, one left to the primitive
 * repeats on the OS's. Left and right are deliberately absent, since focus sits in a
 * text field where they move the caret. */
const COMMAND_ARROWS: Record<string, string> = {
  ArrowDown: "ArrowDown",
  ArrowUp: "ArrowUp",
};

/**
 * Claim a `Command` list's walk keys on its Root's `onkeydown`, and hand the walk to
 * `repeat` so a held key traverses on the app's cadence.
 *
 * Shared by the plan's two command-backed heading surfaces — the breadcrumbs bar's
 * `/` filter panel and the ToC popup — which had the same handler twice before
 * EXC-1122 gave them a second thing to agree about. `field` is the panel's query
 * input, and `null` while it is unmounted.
 *
 * Re-dispatching an arrow rather than writing the selection is the load-bearing
 * choice. bits-ui scrolls a selection into view from its OWN keydown path, so a
 * hand-rolled walk would step the reviewer onto rows below the fold without ever
 * bringing them into sight. It goes out from the FIELD because that is where the
 * keypress really landed, and the primitive listens for it on the root the event
 * bubbles to. With no matches the arrow lands on an empty item set and the key goes
 * quiet — still preferable to the default, which steps focus out of a panel that is
 * portalled to the body with nothing tabbable after it.
 *
 * Three things pass through unclaimed, each for its own reason: a modified key,
 * because bits-ui reads ⌘ and ⌥ off its own arrow handling (first/last row,
 * previous/next group) and swallowing them would delete two behaviours; an untrusted
 * arrow, because that is this function's own re-dispatch on its way to the
 * primitive, and answering it again would loop; and a key this list does not walk
 * with. A held key's OS repeats are claimed but not walked — `preventDefault` keeps
 * the browser's own Tab move suppressed for as long as the key is down.
 */
export function walkCommandList(
  e: KeyboardEvent,
  field: HTMLInputElement | null,
  repeat: KeyRepeat,
): void {
  if (e.ctrlKey || e.altKey || e.metaKey || field === null) return;
  // Tab sits beside the map rather than in it: the map is keyed on the arrow a key
  // means, and Tab's direction rides the shift modifier instead.
  const arrow = e.key === "Tab" ? (e.shiftKey ? "ArrowUp" : "ArrowDown") : COMMAND_ARROWS[e.key];
  if (arrow === undefined) return;
  if (arrow === e.key && !e.isTrusted) return;
  e.preventDefault();
  if (e.repeat) return;
  repeat.start(e.key, () =>
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: arrow, bubbles: true, cancelable: true }),
    ),
  );
}
