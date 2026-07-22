import { describe, expect, test } from "bun:test";

import { type AlertStore, createAlerts } from "@/state/alerts.ts";

// A controllable scheduler so the auto-dismiss + exit timing is deterministic —
// the same injected-timer discipline safeMode.test.ts uses. `schedule` records a
// pending callback and returns its cancel fn; `runNext` fires the oldest live
// timer (mirroring setTimeout firing order); `active` counts uncancelled timers.
function makeScheduler() {
  const timers: Array<{ fn: () => void; cancelled: boolean }> = [];
  const schedule = (fn: () => void) => {
    const t = { fn, cancelled: false };
    timers.push(t);
    return () => {
      t.cancelled = true;
    };
  };
  const runNext = () => {
    const t = timers.find((x) => !x.cancelled);
    if (t) {
      t.cancelled = true;
      t.fn();
    }
  };
  const active = () => timers.filter((x) => !x.cancelled).length;
  return { schedule, runNext, active };
}

const makeStore = (): AlertStore => ({ alerts: [] });

describe("createAlerts", () => {
  test("push appends a non-leaving alert and returns its id", () => {
    const store = makeStore();
    const alerts = createAlerts(store, { schedule: makeScheduler().schedule });
    const id = alerts.push({ variant: "success", message: "Copied path to clipboard" });
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0]).toMatchObject({
      id,
      variant: "success",
      message: "Copied path to clipboard",
      leaving: false,
    });
  });

  test("defaults the variant to 'default'", () => {
    const store = makeStore();
    const alerts = createAlerts(store, { schedule: makeScheduler().schedule });
    alerts.push({ message: "hi" });
    expect(store.alerts[0]?.variant).toBe("default");
  });

  test("assigns distinct monotonic ids", () => {
    const store = makeStore();
    const alerts = createAlerts(store, { schedule: makeScheduler().schedule });
    const a = alerts.push({ message: "one" });
    const b = alerts.push({ message: "two" });
    expect(b).toBeGreaterThan(a);
  });

  test("the dwell timer marks the alert leaving, then the exit timer removes it", () => {
    const store = makeStore();
    const sched = makeScheduler();
    const alerts = createAlerts(store, { schedule: sched.schedule });
    alerts.push({ message: "hi" });
    sched.runNext(); // dwell elapses → begins exit
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0]?.leaving).toBe(true);
    sched.runNext(); // exit animation window elapses → removed
    expect(store.alerts).toHaveLength(0);
  });

  test("a manual dismiss before the dwell cancels the dwell timer", () => {
    const store = makeStore();
    const sched = makeScheduler();
    const alerts = createAlerts(store, { schedule: sched.schedule });
    const id = alerts.push({ message: "hi" });
    alerts.dismiss(id);
    expect(store.alerts[0]?.leaving).toBe(true);
    // Only the exit timer remains live — the dwell timer was cancelled.
    expect(sched.active()).toBe(1);
    sched.runNext();
    expect(store.alerts).toHaveLength(0);
  });

  test("a second dismiss on the same alert schedules nothing new", () => {
    const store = makeStore();
    const sched = makeScheduler();
    const alerts = createAlerts(store, { schedule: sched.schedule });
    const id = alerts.push({ message: "hi" });
    alerts.dismiss(id);
    const before = sched.active();
    alerts.dismiss(id);
    expect(sched.active()).toBe(before);
  });

  test("a persistent push arms no dwell timer, staying until it's manually dismissed", () => {
    const store = makeStore();
    const sched = makeScheduler();
    const alerts = createAlerts(store, { schedule: sched.schedule });
    const id = alerts.push({ variant: "destructive", message: "Couldn't save", persistent: true });
    // No auto-dismiss: a persistent alert (a failure the user must read + act on)
    // never schedules its own removal.
    expect(sched.active()).toBe(0);
    expect(store.alerts).toHaveLength(1);
    // A manual dismiss still runs the exit animation, then removes it.
    alerts.dismiss(id);
    expect(store.alerts[0]?.leaving).toBe(true);
    sched.runNext();
    expect(store.alerts).toHaveLength(0);
  });

  test("multiple pushes stack in insertion order (oldest first)", () => {
    const store = makeStore();
    const alerts = createAlerts(store, { schedule: makeScheduler().schedule });
    alerts.push({ message: "first" });
    alerts.push({ message: "second" });
    expect(store.alerts.map((a) => a.message)).toEqual(["first", "second"]);
  });
});
