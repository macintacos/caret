import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { createKeyRepeat, KEY_REPEAT_DELAY_MS, KEY_REPEAT_INTERVAL_MS } from "$lib/keyRepeat.ts";

// A controllable scheduler so the delay and the run are deterministic — the same
// injected-timer discipline alerts.test.ts and safeMode.test.ts use, and the reason
// the helper takes `schedule` at all. `runNext` fires the oldest live timer,
// `armed` reports the delays still waiting so a test can say WHICH window is open
// rather than only how many.
function makeScheduler() {
  const timers: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  const schedule = (fn: () => void, ms: number) => {
    const timer = { fn, ms, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const runNext = () => {
    const timer = timers.find((t) => !t.cancelled);
    if (timer === undefined) return;
    timer.cancelled = true;
    timer.fn();
  };
  const armed = () => timers.filter((t) => !t.cancelled).map((t) => t.ms);
  return { schedule, runNext, armed };
}

/** Release a key the way a browser does — on `window`, where the helper listens,
 * rather than on whatever the walk has moved focus to. */
const release = (key: string) =>
  window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));

describe("createKeyRepeat", () => {
  test("a hold moves once and then waits out the delay", () => {
    const clock = makeScheduler();
    let steps = 0;
    const repeat = createKeyRepeat({ schedule: clock.schedule });

    repeat.start("j", () => steps++);

    expect(steps).toBe(1);
    expect(clock.armed()).toEqual([KEY_REPEAT_DELAY_MS]);
    repeat.stop();
  });

  test("the run starts after the delay and holds the interval", () => {
    const clock = makeScheduler();
    let steps = 0;
    const repeat = createKeyRepeat({ schedule: clock.schedule });

    repeat.start("j", () => steps++);
    clock.runNext();

    expect(steps).toBe(2);
    expect(clock.armed()).toEqual([KEY_REPEAT_INTERVAL_MS]);

    clock.runNext();
    clock.runNext();

    expect(steps).toBe(4);
    expect(clock.armed()).toEqual([KEY_REPEAT_INTERVAL_MS]);
    repeat.stop();
  });

  test("releasing the key stops the run with nothing left armed", () => {
    const clock = makeScheduler();
    let steps = 0;
    const repeat = createKeyRepeat({ schedule: clock.schedule });

    repeat.start("j", () => steps++);
    clock.runNext();
    release("j");

    expect(clock.armed()).toEqual([]);
    clock.runNext();
    expect(steps).toBe(2);
  });

  // Shift+Tab is held as two keys, and the reviewer can let go of the modifier
  // first. Ending the hold on ANY keyup would stop the walk mid-run there.
  test("releasing a different key leaves the hold running", () => {
    const clock = makeScheduler();
    let steps = 0;
    const repeat = createKeyRepeat({ schedule: clock.schedule });

    repeat.start("Tab", () => steps++);
    release("Shift");

    expect(clock.armed()).toEqual([KEY_REPEAT_DELAY_MS]);
    clock.runNext();
    expect(steps).toBe(2);
    repeat.stop();
  });

  // A window that loses focus never delivers the keyup, so without this the run
  // would still be going when the reviewer came back.
  test("the window losing focus stops the run", () => {
    const clock = makeScheduler();
    let steps = 0;
    const repeat = createKeyRepeat({ schedule: clock.schedule });

    repeat.start("j", () => steps++);
    window.dispatchEvent(new Event("blur"));

    expect(clock.armed()).toEqual([]);
    clock.runNext();
    expect(steps).toBe(1);
  });

  // stop() is what a closing menu calls, and it has to take the listeners with it:
  // one left behind would let a stale key end a hold it never started.
  test("stop leaves no listener behind for the key it ended", () => {
    const clock = makeScheduler();
    let steps = 0;
    const repeat = createKeyRepeat({ schedule: clock.schedule });

    repeat.start("j", () => steps++);
    repeat.stop();
    repeat.start("k", () => steps++);
    release("j");

    expect(clock.armed()).toEqual([KEY_REPEAT_DELAY_MS]);
    repeat.stop();
  });

  // The move itself can end the hold, and it does so SYNCHRONOUSLY: the breadcrumbs
  // bar's `h` shuts one crumb's menu to open the next, and bits-ui reports that close
  // on the spot — so the surface's own close handler calls stop() from inside step().
  // A run that re-armed behind that stop would hold a timer nothing has a handle to:
  // releasing the key could not cancel it, and neither could the next hold.
  test("a step that stops the hold arms no run behind it", () => {
    const clock = makeScheduler();
    let steps = 0;
    const repeat = createKeyRepeat({ schedule: clock.schedule });

    repeat.start("h", () => {
      steps++;
      if (steps === 2) repeat.stop();
    });
    clock.runNext();

    expect(steps).toBe(2);
    expect(clock.armed()).toEqual([]);
    clock.runNext();
    expect(steps).toBe(2);
  });

  test("a first step that stops the hold arms nothing at all", () => {
    const clock = makeScheduler();
    let steps = 0;
    const repeat = createKeyRepeat({ schedule: clock.schedule });

    repeat.start("h", () => {
      steps++;
      repeat.stop();
    });

    expect(steps).toBe(1);
    expect(clock.armed()).toEqual([]);
  });

  test("stop is idempotent", () => {
    const clock = makeScheduler();
    const repeat = createKeyRepeat({ schedule: clock.schedule });

    repeat.start("j", () => {});
    repeat.stop();
    repeat.stop();

    expect(clock.armed()).toEqual([]);
  });

  // One hold at a time: a second key arriving before the first is released takes
  // the run over rather than adding a second timer driving the same list.
  test("a second hold cancels the first", () => {
    const clock = makeScheduler();
    const stepped: string[] = [];
    const repeat = createKeyRepeat({ schedule: clock.schedule });

    repeat.start("j", () => stepped.push("j"));
    repeat.start("k", () => stepped.push("k"));

    expect(clock.armed()).toEqual([KEY_REPEAT_DELAY_MS]);
    clock.runNext();
    expect(stepped).toEqual(["j", "k", "k"]);
    repeat.stop();
  });

  test("the delay and the cadence are overridable", () => {
    const clock = makeScheduler();
    const repeat = createKeyRepeat({ schedule: clock.schedule, delayMs: 40, intervalMs: 7 });

    repeat.start("j", () => {});

    expect(clock.armed()).toEqual([40]);
    clock.runNext();
    expect(clock.armed()).toEqual([7]);
    repeat.stop();
  });
});
