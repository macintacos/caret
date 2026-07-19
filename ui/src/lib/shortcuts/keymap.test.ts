import "../../../test-setup.ts";
import { describe, expect, test } from "bun:test";

import { shortcuts } from "$lib/shortcuts/index.ts";
import { CANONICAL_KEYMAP, EDITOR_SHORTCUTS } from "$lib/shortcuts/keymap.ts";
import { createShortcutRegistry, keyCaps, specSignature } from "$lib/shortcuts/registry.ts";

describe("CANONICAL_KEYMAP", () => {
  test("every entry id is unique", () => {
    const ids = CANONICAL_KEYMAP.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("globally-dispatched groups have no colliding key specs", () => {
    const sigs = CANONICAL_KEYMAP.filter((e) => e.group !== "editor").map((e) =>
      specSignature(e.keys),
    );
    expect(new Set(sigs).size).toBe(sigs.length);
  });

  test("reserves the parent keymap's bindings", () => {
    const sigs = new Set(CANONICAL_KEYMAP.map((e) => specSignature(e.keys)));
    for (const sig of ["j", "k", "g g", "] ]", "a", "r", "?", "ctrl+d", ","]) {
      expect(sigs.has(sig)).toBe(true);
    }
  });

  test("reserves Shift+C for the comment navigator, rendered as ⇧ C caps", () => {
    // EXC-792: summons the comment navigator. Keyed "C" (a bare shifted key, no
    // command modifier), and its cap is set explicitly to ⇧ C — unlike V/G's
    // bare-letter caps — so it can't be misread as the lowercase-c comment-line
    // shortcut it sits beside.
    const entry = CANONICAL_KEYMAP.find((e) => e.id === "actions.toggleComments");
    if (!entry) throw new Error("actions.toggleComments missing");
    expect(entry.group).toBe("actions");
    expect(entry.label).toBe("Toggle comments");
    expect(specSignature(entry.keys)).toBe("C");
    expect(keyCaps(entry.keys)).toEqual([["⇧", "C"]]);
  });
});

describe("EDITOR_SHORTCUTS", () => {
  test("the existing editor chords are display-only (no run) so the dispatcher never fires them", () => {
    expect(EDITOR_SHORTCUTS.length).toBeGreaterThan(0);
    for (const e of EDITOR_SHORTCUTS) {
      expect(e.run).toBeUndefined();
      expect(e.group).toBe("editor");
    }
  });

  test("registering them surfaces them in list() for the help modal", () => {
    const reg = createShortcutRegistry();
    for (const e of EDITOR_SHORTCUTS) reg.register(e);
    expect(
      reg
        .list()
        .map((e) => e.id)
        .sort(),
    ).toEqual([...EDITOR_SHORTCUTS.map((e) => e.id)].sort());
  });

  test("the submit chord renders as ⌘↵ caps and cancel as Esc", () => {
    const submit = EDITOR_SHORTCUTS.find((e) => e.id === "editor.submit");
    const cancel = EDITOR_SHORTCUTS.find((e) => e.id === "editor.cancel");
    if (!submit || !cancel) throw new Error("editor chords missing");
    expect(keyCaps(submit.keys)).toEqual([["⌘", "↵"]]);
    expect(keyCaps(cancel.keys)).toEqual([["Esc"]]);
  });
});

describe("shortcuts singleton", () => {
  test("is a working registry instance", () => {
    const before = shortcuts.list().length;
    const off = shortcuts.register({
      id: "test.tmp",
      keys: [{ key: "z" }],
      group: "actions",
      label: "tmp",
      run: () => {},
    });
    expect(shortcuts.list().some((e) => e.id === "test.tmp")).toBe(true);
    off();
    expect(shortcuts.list().length).toBe(before);
  });
});
