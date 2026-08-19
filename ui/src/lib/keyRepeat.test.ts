import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import {
  createKeyRepeat,
  KEY_REPEAT_DELAY_MS,
  KEY_REPEAT_INTERVAL_MS,
  walkCommandList,
} from "$lib/keyRepeat.ts";

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
});

describe("walkCommandList", () => {
  /** A stand-in for the panel's query field, recording what the walk dispatches at
   * it. A real element rather than a stub: the claim is that bits-ui receives a
   * bubbling keydown, and only a node can carry one. */
  function makeField() {
    const field = document.createElement("input");
    document.body.append(field);
    const keys: string[] = [];
    field.addEventListener("keydown", (e) => keys.push(e.key));
    return { field, keys };
  }

  const press = (init: KeyboardEventInit) =>
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });

  test("Tab and Shift+Tab walk down and up", () => {
    const clock = makeScheduler();
    const repeat = createKeyRepeat({ schedule: clock.schedule });
    const { field, keys } = makeField();

    walkCommandList(press({ key: "Tab" }), field, repeat);
    repeat.stop();
    walkCommandList(press({ key: "Tab", shiftKey: true }), field, repeat);
    repeat.stop();

    expect(keys).toEqual(["ArrowDown", "ArrowUp"]);
  });

  test("a claimed key suppresses the browser's own default", () => {
    const clock = makeScheduler();
    const repeat = createKeyRepeat({ schedule: clock.schedule });
    const { field } = makeField();

    const event = press({ key: "Tab" });
    walkCommandList(event, field, repeat);
    repeat.stop();

    expect(event.defaultPrevented).toBe(true);
  });

  // The OS keeps emitting keydowns while the key is held; only the timer may walk.
  test("an OS repeat stays claimed but walks nothing", () => {
    const clock = makeScheduler();
    const repeat = createKeyRepeat({ schedule: clock.schedule });
    const { field, keys } = makeField();

    walkCommandList(press({ key: "Tab" }), field, repeat);
    const held = press({ key: "Tab", repeat: true });
    walkCommandList(held, field, repeat);
    repeat.stop();

    expect(keys).toEqual(["ArrowDown"]);
    expect(held.defaultPrevented).toBe(true);
  });

  // This function's own re-dispatch comes back through it on the way to the
  // primitive. Claiming it again would loop.
  test("the walk's own untrusted arrow passes through unclaimed", () => {
    const clock = makeScheduler();
    const repeat = createKeyRepeat({ schedule: clock.schedule });
    const { field, keys } = makeField();

    const synthetic = press({ key: "ArrowDown" });
    walkCommandList(synthetic, field, repeat);

    expect(synthetic.defaultPrevented).toBe(false);
    expect(keys).toEqual([]);
    expect(clock.armed()).toEqual([]);
  });

  // ⌘ and ⌥ are the primitive's own first/last and group jumps.
  test("a modified arrow passes through unclaimed", () => {
    const clock = makeScheduler();
    const repeat = createKeyRepeat({ schedule: clock.schedule });
    const { field } = makeField();

    const event = press({ key: "ArrowDown", metaKey: true });
    walkCommandList(event, field, repeat);

    expect(event.defaultPrevented).toBe(false);
    expect(clock.armed()).toEqual([]);
  });

  test("nothing is claimed while the panel has no field", () => {
    const clock = makeScheduler();
    const repeat = createKeyRepeat({ schedule: clock.schedule });

    const event = press({ key: "Tab" });
    walkCommandList(event, null, repeat);

    expect(event.defaultPrevented).toBe(false);
    expect(clock.armed()).toEqual([]);
  });
});
