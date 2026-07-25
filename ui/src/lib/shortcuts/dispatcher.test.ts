import "@ui/test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createShortcutDispatcher, type ShortcutDispatcher } from "$lib/shortcuts/dispatcher.ts";
import {
  createShortcutRegistry,
  type KeySpec,
  type ShortcutEntry,
  type ShortcutRegistry,
  type ShortcutScope,
} from "$lib/shortcuts/registry.ts";

let target: HTMLElement;
let registry: ShortcutRegistry;
let disp: ShortcutDispatcher | null;
let editing: boolean;
let scope: ShortcutScope | null;

beforeEach(() => {
  document.body.innerHTML = "";
  target = document.createElement("div");
  document.body.appendChild(target);
  registry = createShortcutRegistry();
  editing = false;
  scope = null;
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
    activeScope: () => scope,
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

  test("suppresses an out-of-scope shortcut while a modal scope owns the view", () => {
    // A scopeless entry belongs to the base review surface; while the settings modal
    // owns the view, it must not fire (EXC-849).
    const a = spyEntry("approve", [{ key: "a" }]);
    registry.register(a.entry);
    scope = "settings";
    mount();
    const ev = keydown("a");
    expect(a.calls()).toBe(0);
    expect(ev.defaultPrevented).toBe(false);
  });

  test("fires an in-scope shortcut while its modal scope owns the view", () => {
    const x = spyEntry("settings.act", [{ key: "x" }]);
    x.entry.scope = "settings";
    registry.register(x.entry);
    scope = "settings";
    mount();
    keydown("x");
    expect(x.calls()).toBe(1);
  });

  test("a global shortcut fires regardless of the active scope", () => {
    const help = spyEntry("help.show", [{ key: "?" }]);
    help.entry.scope = "global";
    registry.register(help.entry);
    scope = "settings";
    mount();
    keydown("?");
    expect(help.calls()).toBe(1);
  });

  test("does not complete a buffered sequence once a modal scope excludes it", () => {
    const gg = spyEntry("top", [{ key: "g" }, { key: "g" }]);
    registry.register(gg.entry);
    mount();
    keydown("g"); // buffers under the base review surface
    scope = "settings"; // a modal took the view
    keydown("g"); // the second key must not complete the now-out-of-scope sequence
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
