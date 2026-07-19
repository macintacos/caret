import "../../../test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createShortcutDispatcher, type ShortcutDispatcher } from "$lib/shortcuts/dispatcher.ts";
import {
  createShortcutRegistry,
  type KeySpec,
  type ShortcutEntry,
  type ShortcutRegistry,
} from "$lib/shortcuts/registry.ts";

let target: HTMLElement;
let registry: ShortcutRegistry;
let disp: ShortcutDispatcher | null;
let editing: boolean;

beforeEach(() => {
  document.body.innerHTML = "";
  target = document.createElement("div");
  document.body.appendChild(target);
  registry = createShortcutRegistry();
  editing = false;
  disp = null;
});

afterEach(() => {
  disp?.destroy();
});

function mount() {
  disp = createShortcutDispatcher({
    target,
    registry,
    isEditingContext: () => editing,
    now: () => 0,
  });
}

function spyEntry(
  id: string,
  keys: KeySpec,
  opts: { enabled?: () => boolean } = {},
): { entry: ShortcutEntry; calls: () => number } {
  let n = 0;
  const entry: ShortcutEntry = {
    id,
    keys,
    group: "actions",
    label: id,
    run: () => {
      n += 1;
    },
    enabled: opts.enabled,
  };
  return { entry, calls: () => n };
}

function keydown(key: string, mods: Record<string, boolean> = {}): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...mods });
  target.dispatchEvent(ev);
  return ev;
}

describe("createShortcutDispatcher", () => {
  test("runs a matched single-key shortcut and prevents default", () => {
    const a = spyEntry("approve", [{ key: "a" }]);
    registry.register(a.entry);
    mount();
    const ev = keydown("a");
    expect(a.calls()).toBe(1);
    expect(ev.defaultPrevented).toBe(true);
  });

  test("suppresses single-key shortcuts while an editing context is focused", () => {
    const a = spyEntry("approve", [{ key: "a" }]);
    registry.register(a.entry);
    mount();
    editing = true;
    const ev = keydown("a");
    expect(a.calls()).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
  });

  test("yields to a focused widget that already handled the key", () => {
    const inner = document.createElement("div");
    target.appendChild(inner);
    const a = spyEntry("approve", [{ key: "a" }]);
    registry.register(a.entry);
    mount();
    inner.addEventListener("keydown", (e) => e.preventDefault()); // widget handles it first
    const ev = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    inner.dispatchEvent(ev);
    expect(a.calls()).toBe(0);
    expect(ev.defaultPrevented).toBe(true);
  });

  test("does not run a disabled shortcut", () => {
    const a = spyEntry("approve", [{ key: "a" }], { enabled: () => false });
    registry.register(a.entry);
    mount();
    const ev = keydown("a");
    expect(a.calls()).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
  });

  test("never dispatches a display-only (no run) entry", () => {
    registry.register({ id: "submit", keys: [{ key: "a" }], group: "editor", label: "Submit" });
    mount();
    const ev = keydown("a");
    expect(ev.defaultPrevented).toBe(false);
  });

  test("dispatches a two-key sequence", () => {
    const gg = spyEntry("top", [{ key: "g" }, { key: "g" }]);
    registry.register(gg.entry);
    mount();
    keydown("g"); // buffers
    expect(gg.calls()).toBe(0);
    keydown("g"); // completes
    expect(gg.calls()).toBe(1);
  });

  test("does not complete a bare sequence once an editing context takes focus", () => {
    const gg = spyEntry("top", [{ key: "g" }, { key: "g" }]);
    registry.register(gg.entry);
    mount();
    keydown("g"); // buffers while not editing
    editing = true;
    keydown("g"); // focus now in a field — the second key must not complete it
    expect(gg.calls()).toBe(0);
  });

  test("destroy() removes the listener", () => {
    const a = spyEntry("approve", [{ key: "a" }]);
    registry.register(a.entry);
    mount();
    disp?.destroy();
    disp = null;
    const ev = keydown("a");
    expect(a.calls()).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
  });
});
