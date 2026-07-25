import "@ui/test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { type LogCapture, logCapture } from "@ui/test-helpers.ts";
import { flush } from "$lib/log.ts";
import { createSafeModeGuard, type SafeModeGuard } from "$lib/safeMode.ts";

// A controllable clock so the grace-window logic is deterministic. The
// auto-deactivate timer uses real setTimeout, so those tests await real time.
function makeClock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

let parent: HTMLElement;
let child: HTMLElement;
let guards: SafeModeGuard[];

beforeEach(() => {
  document.body.innerHTML = "";
  parent = document.createElement("div");
  child = document.createElement("button"); // a focusable downstream target
  parent.appendChild(child);
  document.body.appendChild(parent);
  guards = [];
});

afterEach(() => {
  for (const g of guards) g.destroy();
});

function makeGuard(opts: { now: () => number; graceMs?: number; durationMs?: number }) {
  const changes: boolean[] = [];
  const guard = createSafeModeGuard({
    target: parent,
    onChange: (active) => changes.push(active),
    now: opts.now,
    graceMs: opts.graceMs,
    durationMs: opts.durationMs,
  });
  guards.push(guard);
  return { guard, changes };
}

// Dispatch on the child so the parent's capture-phase listener sees it first.
function keydown(): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key: "a", cancelable: true, bubbles: true });
  child.dispatchEvent(ev);
  return ev;
}
function keyup(): KeyboardEvent {
  const ev = new KeyboardEvent("keyup", { key: "a", cancelable: true, bubbles: true });
  child.dispatchEvent(ev);
  return ev;
}

describe("createSafeModeGuard", () => {
  test("a keydown within the grace window activates Safe Mode and is swallowed", () => {
    const clock = makeClock();
    const { guard, changes } = makeGuard({ now: clock.now });
    clock.advance(100); // within the 300ms grace window
    const ev = keydown();
    expect(guard.isActive()).toBe(true);
    expect(changes).toEqual([true]);
    expect(ev.defaultPrevented).toBe(true);
  });

  test("a keydown at the exact grace boundary still activates", () => {
    const clock = makeClock();
    const { guard } = makeGuard({ now: clock.now, graceMs: 300 });
    clock.advance(300);
    keydown();
    expect(guard.isActive()).toBe(true);
  });

  test("a keydown after the grace window passes through untouched", () => {
    const clock = makeClock();
    let childFired = 0;
    child.addEventListener("keydown", () => childFired++);
    const { guard, changes } = makeGuard({ now: clock.now });
    clock.advance(500); // past the grace window
    const ev = keydown();
    expect(guard.isActive()).toBe(false);
    expect(changes).toEqual([]);
    expect(ev.defaultPrevented).toBe(false);
    expect(childFired).toBe(1); // reached the downstream handler
  });

  test("while active, later keydown and keyup are both swallowed past the grace window", () => {
    const clock = makeClock();
    const { guard } = makeGuard({ now: clock.now, durationMs: 2000 });
    clock.advance(100);
    keydown(); // activates
    expect(guard.isActive()).toBe(true);
    clock.advance(1000); // well past the grace window, still active
    const down = keydown();
    const up = keyup();
    expect(down.defaultPrevented).toBe(true);
    expect(up.defaultPrevented).toBe(true);
  });

  test("swallowing stops propagation to downstream handlers", () => {
    const clock = makeClock();
    let childFired = 0;
    child.addEventListener("keydown", () => childFired++);
    const { guard } = makeGuard({ now: clock.now });
    clock.advance(50);
    keydown(); // activating keydown is eaten before reaching the child
    expect(guard.isActive()).toBe(true);
    expect(childFired).toBe(0);
  });

  test("auto-deactivates after the duration elapses", async () => {
    const clock = makeClock();
    const { guard, changes } = makeGuard({ now: clock.now, durationMs: 30 });
    clock.advance(100);
    keydown(); // activate
    expect(guard.isActive()).toBe(true);
    await new Promise((r) => setTimeout(r, 60));
    expect(guard.isActive()).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  test("arm() re-opens the grace window (simulates refocus)", () => {
    const clock = makeClock();
    const { guard, changes } = makeGuard({ now: clock.now });
    clock.advance(500); // initial grace window has passed
    keydown();
    expect(guard.isActive()).toBe(false);

    guard.arm(); // refocus re-arms at now = 500
    const ev = keydown(); // within grace of the re-arm
    expect(guard.isActive()).toBe(true);
    expect(ev.defaultPrevented).toBe(true);
    expect(changes).toEqual([true]);
  });

  test("destroy() removes listeners so later keys are inert", () => {
    const clock = makeClock();
    const { guard, changes } = makeGuard({ now: clock.now });
    guard.destroy();
    clock.advance(50); // within grace, but the guard is gone
    const ev = keydown();
    expect(guard.isActive()).toBe(false);
    expect(changes).toEqual([]);
    expect(ev.defaultPrevented).toBe(false);
  });

  test("a standalone keyup never triggers Safe Mode and passes through", () => {
    const clock = makeClock();
    const { guard, changes } = makeGuard({ now: clock.now });
    clock.advance(50); // within the grace window, but only a keyup arrives
    const ev = keyup();
    expect(guard.isActive()).toBe(false);
    expect(changes).toEqual([]);
    expect(ev.defaultPrevented).toBe(false);
  });
});

// uiLog instrumentation: activation/release records ride the same buffer the
// log bridge POSTs to /api/logs, so we observe them by stubbing fetch and
// draining the module-global buffer with flush() (cf. log.test.ts). Scoped to
// its own describe so the fetch stub never leaks into the behavior tests above.
describe("createSafeModeGuard instrumentation", () => {
  // Shared fetch double (test-helpers.ts): captures /api/logs POSTs and drains
  // the module-global buffer at install and restore so cases don't bleed.
  let cap: LogCapture;

  // A distinctive key so the negative test can assert it never reaches the wire.
  const SECRET_KEY = "ZxQvSecretKeystroke";
  function key(type: "keydown" | "keyup"): KeyboardEvent {
    const ev = new KeyboardEvent(type, { key: SECRET_KEY, cancelable: true, bubbles: true });
    child.dispatchEvent(ev);
    return ev;
  }

  beforeEach(() => {
    cap = logCapture();
  });

  afterEach(() => {
    cap.restore();
  });

  test("activation emits exactly one info record", () => {
    const clock = makeClock();
    makeGuard({ now: clock.now });
    clock.advance(100);
    key("keydown"); // activates within the grace window
    flush();

    const events = cap.events();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ level: "info", step: "ui", msg: "safe mode triggered" });
  });

  test("release emits one debug record with the swallowed count", async () => {
    const clock = makeClock();
    makeGuard({ now: clock.now, durationMs: 30 });
    clock.advance(100);
    key("keydown"); // activates (swallowed: 1)
    key("keyup"); // eaten while active (swallowed: 2)
    key("keydown"); // eaten while active (swallowed: 3)
    await new Promise((r) => setTimeout(r, 60)); // let the duration timer fire
    flush();

    const release = cap.events().filter((e) => e.msg === "safe mode released");
    expect(release).toHaveLength(1);
    expect(release[0]).toMatchObject({
      level: "debug",
      step: "ui",
      msg: "safe mode released",
      extra: { swallowed: 3 },
    });
  });

  test("no record carries key identity", async () => {
    const clock = makeClock();
    makeGuard({ now: clock.now, durationMs: 30 });
    clock.advance(100);
    key("keydown"); // activate, swallow some keys carrying the secret key value
    key("keyup");
    await new Promise((r) => setTimeout(r, 60));
    flush();

    expect(cap.text()).not.toContain(SECRET_KEY);
  });
});
