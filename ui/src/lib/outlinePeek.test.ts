import { describe, expect, test } from "bun:test";

import { createPeekIntent, PEEK_INTENT_MS, peekTop, peekWidth } from "$lib/outlinePeek.ts";

// A hand-cranked clock: each scheduled callback waits in `pending` until `fire` runs it.
function harness() {
  const shown: (number | null)[] = [];
  const pending: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const intent = createPeekIntent({
    onChange: (line) => shown.push(line),
    schedule: (fn, ms) => {
      const timer = { fn, ms, cancelled: false };
      pending.push(timer);
      return () => {
        timer.cancelled = true;
      };
    },
  });
  const fire = () => {
    for (const timer of pending.splice(0)) if (!timer.cancelled) timer.fn();
  };
  return { intent, shown, pending, fire };
}

describe("createPeekIntent", () => {
  test("opens on a row once the pointer dwells there for the intent delay", () => {
    const { intent, shown, pending, fire } = harness();
    intent.reach(5);
    expect(shown).toEqual([]);
    expect(pending.map((t) => t.ms)).toEqual([PEEK_INTENT_MS]);
    fire();
    expect(shown).toEqual([5]);
  });

  test("restarts the dwell when the pointer reaches another row first", () => {
    const { intent, shown, fire } = harness();
    intent.reach(5);
    intent.reach(10);
    fire();
    expect(shown).toEqual([10]);
  });

  test("keeps the dwell running while the pointer moves within its row", () => {
    const { intent, pending } = harness();
    intent.reach(5);
    intent.reach(5);
    expect(pending).toHaveLength(1);
  });

  test("once open, follows from row to row at once", () => {
    const { intent, shown, pending, fire } = harness();
    intent.reach(5);
    fire();
    intent.reach(10);
    intent.reach(14);
    expect(shown).toEqual([5, 10, 14]);
    expect(pending).toHaveLength(0);
  });

  test("hides an open peek", () => {
    const { intent, shown, fire } = harness();
    intent.reach(5);
    fire();
    intent.hide();
    expect(shown).toEqual([5, null]);
  });

  test("hiding drops a dwell that has not opened yet", () => {
    const { intent, shown, fire } = harness();
    intent.reach(5);
    intent.hide();
    fire();
    expect(shown).toEqual([]);
  });

  test("needs a fresh dwell after it hides", () => {
    const { intent, shown, fire } = harness();
    intent.reach(5);
    fire();
    intent.hide();
    intent.reach(10);
    expect(shown).toEqual([5, null]);
    fire();
    expect(shown).toEqual([5, null, 10]);
  });
});

describe("peekWidth", () => {
  const size = { gap: 8, margin: 8, minWidth: 288, maxWidth: 576 };

  test("takes its full width where the room past the outline's edge allows", () => {
    expect(peekWidth(250, 1400, size)).toBe(576);
  });

  test("narrows to the room left between the outline's edge and the bounds", () => {
    expect(peekWidth(250, 800, size)).toBe(800 - 8 - (250 + 8));
  });

  test("is null where the room is narrower than its least width", () => {
    expect(peekWidth(250, 550, size)).toBeNull();
  });
});

describe("peekTop", () => {
  const bounds = { top: 50, bottom: 850 };

  test("aligns with the row's top edge", () => {
    expect(peekTop(300, 200, bounds, 8)).toBe(300);
  });

  test("rises so its foot stays inside the bounds", () => {
    expect(peekTop(800, 200, bounds, 8)).toBe(850 - 8 - 200);
  });

  test("never rises past the bounds' top", () => {
    expect(peekTop(60, 900, bounds, 8)).toBe(58);
  });
});
