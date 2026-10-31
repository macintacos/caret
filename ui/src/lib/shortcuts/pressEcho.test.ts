import "@ui/support/setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import { createPressEcho, PRESS_HOLD_MS } from "$lib/shortcuts/pressEcho.ts";
import type { ShortcutEntry } from "$lib/shortcuts/registry.ts";

const ENTRY: ShortcutEntry = {
  id: "actions.requestChanges",
  keys: [{ key: "r" }],
  group: "actions",
  label: "Request changes",
};

let root: HTMLElement;
let control: HTMLButtonElement;
let timers: Array<{ run: () => void; ms: number; live: boolean }>;

function echo(controls: () => Element[] = () => [control]) {
  return createPressEcho({
    root,
    controlsFor: controls,
    schedule: (run, ms) => {
      const timer = { run, ms, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
  });
}

function fireLive() {
  for (const t of timers.splice(0)) if (t.live) t.run();
}

beforeEach(() => {
  root = document.createElement("div");
  control = document.createElement("button");
  timers = [];
});

describe("createPressEcho", () => {
  test("presses the control for the hold, then releases it", () => {
    echo()(ENTRY);
    expect(control.hasAttribute("data-key-pressed")).toBe(true);
    expect(timers[0]?.ms).toBe(PRESS_HOLD_MS);
    fireLive();
    expect(control.hasAttribute("data-key-pressed")).toBe(false);
  });

  test("a re-press inside the hold restarts it", () => {
    const press = echo();
    press(ENTRY);
    press(ENTRY);
    const [first, second] = timers.filter((t) => t.ms === PRESS_HOLD_MS);
    first?.live && first.run();
    expect(control.hasAttribute("data-key-pressed")).toBe(true);
    second?.run();
    expect(control.hasAttribute("data-key-pressed")).toBe(false);
  });

  test("flags the root while a press echoes", () => {
    echo()(ENTRY);
    expect(root.hasAttribute("data-key-echo")).toBe(true);
    fireLive();
    expect(root.hasAttribute("data-key-echo")).toBe(false);
  });

  test("leaves the root unflagged when no control is on screen", () => {
    echo(() => [])(ENTRY);
    expect(root.hasAttribute("data-key-echo")).toBe(false);
  });
});
