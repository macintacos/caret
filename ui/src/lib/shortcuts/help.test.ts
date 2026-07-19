import { describe, expect, test } from "bun:test";

import { filterShortcuts, groupShortcuts } from "$lib/shortcuts/help.ts";
import type { ShortcutEntry } from "$lib/shortcuts/registry.ts";

// A small out-of-order fixture spanning three of the five groups (commenting and
// actions deliberately absent, to prove empty groups drop out).
const entries: ShortcutEntry[] = [
  { id: "help.show", keys: [{ key: "?" }], group: "help", label: "Show shortcuts" },
  {
    id: "editor.cancel",
    keys: [{ key: "Escape", cap: "Esc" }],
    group: "editor",
    label: "Cancel editing",
  },
  { id: "motion.top", keys: [{ key: "g" }, { key: "g" }], group: "motion", label: "Go to top" },
  { id: "motion.down", keys: [{ key: "j" }], group: "motion", label: "Line down" },
];

describe("groupShortcuts", () => {
  test("orders present groups canonically, regardless of input order", () => {
    // Input order is help, editor, motion, motion — canonical order is
    // motion, commenting, actions, help, editor, so present groups come out
    // motion → help → editor.
    expect(groupShortcuts(entries).map((g) => g.group)).toEqual(["motion", "help", "editor"]);
  });

  test("drops groups with no entries", () => {
    const groups = groupShortcuts(entries).map((g) => g.group);
    expect(groups).not.toContain("commenting");
    expect(groups).not.toContain("actions");
  });

  test("gives each group a human-readable label", () => {
    const motion = groupShortcuts(entries).find((g) => g.group === "motion");
    expect(motion?.label).toBe("Motion");
  });

  test("preserves input order of entries within a group", () => {
    const motion = groupShortcuts(entries).find((g) => g.group === "motion");
    expect(motion?.entries.map((e) => e.id)).toEqual(["motion.top", "motion.down"]);
  });
});

describe("filterShortcuts", () => {
  test("an empty query returns every entry", () => {
    expect(filterShortcuts(entries, "")).toEqual(entries);
    expect(filterShortcuts(entries, "   ")).toEqual(entries);
  });

  test("matches on the label, case-insensitively", () => {
    expect(filterShortcuts(entries, "CANCEL").map((e) => e.id)).toEqual(["editor.cancel"]);
  });

  test("matches on a rendered key cap the label never mentions", () => {
    // "?" appears only as help.show's cap, never in any label.
    expect(filterShortcuts(entries, "?").map((e) => e.id)).toEqual(["help.show"]);
    // "Esc" is editor.cancel's explicit cap; the label is "Cancel editing".
    expect(filterShortcuts(entries, "esc").map((e) => e.id)).toEqual(["editor.cancel"]);
  });

  test("returns nothing when neither label nor caps match", () => {
    expect(filterShortcuts(entries, "zzzz")).toEqual([]);
  });
});
