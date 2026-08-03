import "@ui/test-setup.ts";
import { afterEach, beforeEach, expect, test } from "bun:test";

import { createSeenWatcher, SEEN_DWELL_MS, type SeenWatcher } from "$lib/seen.ts";

// A manual timer so the dwell window is deterministic: the watcher arms and
// cancels through these exactly as it would the real ones, and `fire()` runs
// whatever is currently scheduled.
function manualTimer() {
  let scheduled: (() => void) | null = null;
  let armedFor = 0;
  let handle = 0;
  return {
    armedFor: () => armedFor,
    pending: () => scheduled !== null,
    fire() {
      const fn = scheduled;
      scheduled = null;
      fn?.();
    },
    setTimer: (fn: () => void, ms: number) => {
      scheduled = fn;
      armedFor = ms;
      handle += 1;
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      scheduled = null;
    },
  };
}

let target: EventTarget;
let doc: EventTarget;
let watchers: SeenWatcher[];

beforeEach(() => {
  target = new EventTarget();
  doc = new EventTarget();
  watchers = [];
});
afterEach(() => {
  for (const w of watchers) w.destroy();
});

function makeWatcher(opts: { away?: () => boolean } = {}) {
  const seen: string[] = [];
  const timer = manualTimer();
  const watcher = createSeenWatcher({
    onSeen: (id) => seen.push(id),
    isAway: opts.away ?? (() => false),
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
    target,
    doc,
  });
  watchers.push(watcher);
  return { watcher, seen, timer };
}

test("a review dwelt on while present is reported once the threshold elapses", () => {
  const { watcher, seen, timer } = makeWatcher();
  watcher.track({ id: "r1", version: 1 });
  expect(timer.armedFor()).toBe(SEEN_DWELL_MS);
  timer.fire();
  expect(seen).toEqual(["r1"]);
});

test("no dwell is armed while the user is away", () => {
  const { watcher, timer } = makeWatcher({ away: () => true });
  watcher.track({ id: "r1", version: 1 });
  expect(timer.pending()).toBe(false);
});

test("a review going off screen cancels its pending dwell", () => {
  const { watcher, seen, timer } = makeWatcher();
  watcher.track({ id: "r1", version: 1 });
  watcher.track(null);
  expect(timer.pending()).toBe(false);
  expect(seen).toEqual([]);
});

test("switching to another review cancels the first one's pending dwell", () => {
  const { watcher, seen, timer } = makeWatcher();
  watcher.track({ id: "r1", version: 1 });
  watcher.track({ id: "r2", version: 1 });
  timer.fire();
  expect(seen).toEqual(["r2"]);
});

test("the poll re-delivering the same review does not restart the dwell", () => {
  const { watcher, seen, timer } = makeWatcher();
  watcher.track({ id: "r1", version: 1 });
  const armed = timer.pending();
  watcher.track({ id: "r1", version: 1 });
  expect(timer.pending()).toBe(armed);
  timer.fire();
  expect(seen).toEqual(["r1"]);
});

test("losing focus mid-dwell cancels it", () => {
  let away = false;
  const { watcher, seen, timer } = makeWatcher({ away: () => away });
  watcher.track({ id: "r1", version: 1 });
  away = true;
  target.dispatchEvent(new Event("blur"));
  expect(timer.pending()).toBe(false);
  expect(seen).toEqual([]);
});

test("refocusing restarts the dwell from zero rather than resuming it", () => {
  let away = false;
  const { watcher, seen, timer } = makeWatcher({ away: () => away });
  watcher.track({ id: "r1", version: 1 });
  away = true;
  target.dispatchEvent(new Event("blur"));
  away = false;
  target.dispatchEvent(new Event("focus"));
  expect(timer.armedFor()).toBe(SEEN_DWELL_MS);
  timer.fire();
  expect(seen).toEqual(["r1"]);
});

test("hiding the tab mid-dwell cancels it", () => {
  let away = false;
  const { watcher, seen, timer } = makeWatcher({ away: () => away });
  watcher.track({ id: "r1", version: 1 });
  away = true;
  doc.dispatchEvent(new Event("visibilitychange"));
  expect(timer.pending()).toBe(false);
  expect(seen).toEqual([]);
});

test("a review already reported is never reported again", () => {
  const { watcher, seen, timer } = makeWatcher();
  watcher.track({ id: "r1", version: 1 });
  timer.fire();
  watcher.track(null);
  watcher.track({ id: "r1", version: 1 });
  expect(timer.pending()).toBe(false);
  expect(seen).toEqual(["r1"]);
});

test("a new version of the same review is reported again", () => {
  const { watcher, seen, timer } = makeWatcher();
  watcher.track({ id: "r1", version: 1 });
  timer.fire();
  watcher.track({ id: "r1", version: 2 });
  timer.fire();
  expect(seen).toEqual(["r1", "r1"]);
});

test("destroy detaches the presence listeners", () => {
  const { watcher, timer } = makeWatcher();
  watcher.track({ id: "r1", version: 1 });
  watcher.destroy();
  expect(timer.pending()).toBe(false);
  // A stray event after teardown must not re-arm the dwell.
  target.dispatchEvent(new Event("focus"));
  expect(timer.pending()).toBe(false);
});
