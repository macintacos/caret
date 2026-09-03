import { describe, expect, test } from "bun:test";

import { type AlertDeps, type AlertStore, createAlerts } from "@/state/alerts.ts";
import type { SoundEvent } from "$lib/sound.ts";

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

/** A fresh alert queue over a fresh store and scheduler. */
function makeAlerts(deps: Omit<AlertDeps, "schedule"> = {}) {
  const store = makeStore();
  const sched = makeScheduler();
  const alerts = createAlerts(store, { schedule: sched.schedule, ...deps });
  return { store, sched, alerts };
}

describe("createAlerts", () => {
  test("push appends a non-leaving alert and returns its id", () => {
    const { store, alerts } = makeAlerts();
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
    const { store, alerts } = makeAlerts();
    alerts.push({ message: "hi" });
    expect(store.alerts[0]?.variant).toBe("default");
  });

  test("assigns distinct monotonic ids", () => {
    const { alerts } = makeAlerts();
    const a = alerts.push({ message: "one" });
    const b = alerts.push({ message: "two" });
    expect(b).toBeGreaterThan(a);
  });

  test("the dwell timer marks the alert leaving, then the exit timer removes it", () => {
    const { store, sched, alerts } = makeAlerts();
    alerts.push({ message: "hi" });
    sched.runNext(); // dwell elapses → begins exit
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0]?.leaving).toBe(true);
    sched.runNext(); // exit animation window elapses → removed
    expect(store.alerts).toHaveLength(0);
  });

  test("a manual dismiss before the dwell cancels the dwell timer", () => {
    const { store, sched, alerts } = makeAlerts();
    const id = alerts.push({ message: "hi" });
    alerts.dismiss(id);
    expect(store.alerts[0]?.leaving).toBe(true);
    // Only the exit timer remains live — the dwell timer was cancelled.
    expect(sched.active()).toBe(1);
    sched.runNext();
    expect(store.alerts).toHaveLength(0);
  });

  test("a second dismiss on the same alert schedules nothing new", () => {
    const { sched, alerts } = makeAlerts();
    const id = alerts.push({ message: "hi" });
    alerts.dismiss(id);
    const before = sched.active();
    alerts.dismiss(id);
    expect(sched.active()).toBe(before);
  });

  test("a persistent push arms no dwell timer, staying until it's manually dismissed", () => {
    const { store, sched, alerts } = makeAlerts();
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
    const { store, alerts } = makeAlerts();
    alerts.push({ message: "first" });
    alerts.push({ message: "second" });
    expect(store.alerts.map((a) => a.message)).toEqual(["first", "second"]);
  });
});

describe("createAlerts sound (EXC-1100)", () => {
  /** An alert queue wired to a recording sound dep, plus what it has played. */
  function withSound() {
    const events: SoundEvent[] = [];
    const { alerts } = makeAlerts({ sound: (e) => events.push(e) });
    return { alerts, events };
  }

  test("a success toast sounds success", () => {
    const { alerts, events } = withSound();
    alerts.push({ variant: "success", message: "Copied path to clipboard" });
    expect(events).toEqual(["toastSuccess"]);
  });

  test("a destructive toast sounds the error", () => {
    const { alerts, events } = withSound();
    alerts.push({ variant: "destructive", message: "Couldn't send the decision" });
    expect(events).toEqual(["toastError"]);
  });

  test("a plain toast sounds the neutral notice", () => {
    const { alerts, events } = withSound();
    alerts.push({ message: "Plan rejected" });
    expect(events).toEqual(["toastNotice"]);
  });

  test("an explicit sound displaces the variant's default, so a verdict is heard once", () => {
    const { alerts, events } = withSound();
    alerts.push({ variant: "success", message: "Plan approved", sound: "approved" });
    expect(events).toEqual(["approved"]);
  });

  test("a null sound pushes the toast silently", () => {
    const { alerts, events } = withSound();
    alerts.push({ message: "Nothing to hear", sound: null });
    expect(events).toEqual([]);
  });

  test("dismissing an alert makes no sound of its own", () => {
    const { alerts, events } = withSound();
    const id = alerts.push({ message: "one" });
    alerts.dismiss(id);
    expect(events).toEqual(["toastNotice"]);
  });

  test("the dep is optional — a queue with no sound still pushes", () => {
    const { store, alerts } = makeAlerts();
    alerts.push({ message: "hi" });
    expect(store.alerts).toHaveLength(1);
  });
});

describe("createAlerts action (EXC-1207)", () => {
  test("push carries an action onto the queued item", () => {
    const { store, alerts } = makeAlerts();
    const run = () => {};
    alerts.push({ message: "caret 1.2.0 is available", action: { label: "Update", run } });
    expect(store.alerts[0]?.action).toEqual({ label: "Update", run });
  });

  test("an alert pushed without one carries no action", () => {
    const { store, alerts } = makeAlerts();
    alerts.push({ message: "hi" });
    expect(store.alerts[0]?.action).toBeUndefined();
  });

  test("an action changes neither the dwell nor the dismiss path", () => {
    const { store, sched, alerts } = makeAlerts();
    alerts.push({ message: "hi", action: { label: "Update", run: () => {} } });
    // Still one dwell timer armed, and it still runs the two-phase exit.
    expect(sched.active()).toBe(1);
    sched.runNext();
    expect(store.alerts[0]?.leaving).toBe(true);
    sched.runNext();
    expect(store.alerts).toHaveLength(0);
  });
});
