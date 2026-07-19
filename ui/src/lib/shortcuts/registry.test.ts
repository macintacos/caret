import "../../../test-setup.ts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { flush } from "$lib/log.ts";
import {
  createShortcutRegistry,
  keyCaps,
  type ShortcutEntry,
  specSignature,
} from "$lib/shortcuts/registry.ts";

import { type LogCapture, logCapture } from "../../../test-helpers.ts";

function entry(over: Partial<ShortcutEntry> & Pick<ShortcutEntry, "id" | "keys">): ShortcutEntry {
  return { group: "actions", label: over.id, ...over };
}

describe("createShortcutRegistry", () => {
  test("register adds an entry that list() returns", () => {
    const reg = createShortcutRegistry();
    reg.register(entry({ id: "approve", keys: [{ key: "a" }], run: () => {} }));
    expect(reg.list().map((e) => e.id)).toEqual(["approve"]);
  });

  test("register returns an unregister that removes the entry", () => {
    const reg = createShortcutRegistry();
    const off = reg.register(entry({ id: "approve", keys: [{ key: "a" }], run: () => {} }));
    off();
    expect(reg.list()).toEqual([]);
  });

  test("re-registering the same id replaces rather than duplicates", () => {
    const reg = createShortcutRegistry();
    reg.register(entry({ id: "x", keys: [{ key: "a" }], label: "first", run: () => {} }));
    reg.register(entry({ id: "x", keys: [{ key: "b" }], label: "second", run: () => {} }));
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0]?.label).toBe("second");
  });

  test("run() and enabled() are exposed on listed entries so the modal can execute and grey out", () => {
    const reg = createShortcutRegistry();
    let ran = 0;
    reg.register(entry({ id: "a", keys: [{ key: "a" }], run: () => ran++, enabled: () => false }));
    const e = reg.list()[0];
    e?.run?.();
    expect(ran).toBe(1);
    expect(e?.enabled?.()).toBe(false);
  });

  test("display-only entries (no run) are listed for the help modal", () => {
    const reg = createShortcutRegistry();
    reg.register(entry({ id: "submit", keys: [{ key: "Enter", mods: ["mod"] }], group: "editor" }));
    const e = reg.list()[0];
    expect(e?.run).toBeUndefined();
    expect(e?.id).toBe("submit");
  });
});

describe("createShortcutRegistry collision detection", () => {
  let cap: LogCapture;
  beforeEach(() => {
    cap = logCapture();
  });
  afterEach(() => {
    cap.restore();
  });

  test("two dispatchable entries on the same key spec warn", () => {
    const reg = createShortcutRegistry();
    reg.register(entry({ id: "one", keys: [{ key: "a" }], run: () => {} }));
    reg.register(entry({ id: "two", keys: [{ key: "a" }], run: () => {} }));
    flush();
    const warns = cap.events().filter((e) => e.msg === "shortcut key collision");
    expect(warns).toHaveLength(1);
    expect(warns[0]).toMatchObject({ level: "warn", step: "ui" });
  });

  test("a display-only entry sharing a key with an action does not warn", () => {
    const reg = createShortcutRegistry();
    reg.register(entry({ id: "disp", keys: [{ key: "Escape" }], group: "editor" })); // no run
    reg.register(entry({ id: "act", keys: [{ key: "Escape" }], run: () => {} }));
    flush();
    expect(cap.events().filter((e) => e.msg === "shortcut key collision")).toHaveLength(0);
  });
});

describe("keyCaps", () => {
  test("a two-key sequence yields one cap-list per chord", () => {
    expect(keyCaps([{ key: "g" }, { key: "g" }])).toEqual([["g"], ["g"]]);
  });
  test("a cap override wins over derivation", () => {
    expect(keyCaps([{ key: "Escape", cap: "Esc" }])).toEqual([["Esc"]]);
    expect(keyCaps([{ key: "Enter", mods: ["mod"], cap: ["⌘", "↵"] }])).toEqual([["⌘", "↵"]]);
  });
  test("a ctrl chord derives platform-independent caps", () => {
    expect(keyCaps([{ key: "d", mods: ["ctrl"] }])).toEqual([["Ctrl", "d"]]);
  });
  test("a plain symbol key renders as itself", () => {
    expect(keyCaps([{ key: "?" }])).toEqual([["?"]]);
  });
});

describe("specSignature", () => {
  test("equal specs share a signature; different specs differ", () => {
    expect(specSignature([{ key: "g" }, { key: "g" }])).toBe(
      specSignature([{ key: "g" }, { key: "g" }]),
    );
    expect(specSignature([{ key: "a" }])).not.toBe(specSignature([{ key: "b" }]));
  });
  test("modifier order does not affect the signature", () => {
    expect(specSignature([{ key: "Enter", mods: ["ctrl", "alt"] }])).toBe(
      specSignature([{ key: "Enter", mods: ["alt", "ctrl"] }]),
    );
  });
});
