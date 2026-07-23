import { describe, expect, test } from "bun:test";

import type { ShortcutEntry } from "$lib/shortcuts/registry.ts";
import { isEntryActive, scopedShortcuts } from "$lib/shortcuts/scope.ts";

// The scope predicate (EXC-849) the dispatcher and the help modal both read to
// answer "is this shortcut active in the current view?". A scopeless entry belongs
// to the base review surface; a global entry is always active; a named modal scope
// (settings) is active only while that modal owns the view.
const review: ShortcutEntry = {
  id: "actions.approve",
  keys: [{ key: "a" }],
  group: "actions",
  label: "Approve",
};
const settings: ShortcutEntry = {
  id: "settings.search",
  keys: [{ key: "/" }],
  group: "settings",
  label: "Search settings",
  scope: "settings",
};
const help: ShortcutEntry = {
  id: "help.show",
  keys: [{ key: "?" }],
  group: "help",
  label: "Show shortcuts",
  scope: "global",
};

describe("isEntryActive", () => {
  test("a scopeless entry belongs to the base review surface — active only with no modal scope", () => {
    expect(isEntryActive(review, null)).toBe(true);
    expect(isEntryActive(review, "settings")).toBe(false);
  });

  test("a settings-scoped entry is active only under the settings scope", () => {
    expect(isEntryActive(settings, "settings")).toBe(true);
    expect(isEntryActive(settings, null)).toBe(false);
  });

  test("a global entry is active in every scope", () => {
    expect(isEntryActive(help, null)).toBe(true);
    expect(isEntryActive(help, "settings")).toBe(true);
  });
});

describe("scopedShortcuts", () => {
  test("keeps the base surface's entries (plus globals) when no modal is open, in order", () => {
    expect(scopedShortcuts([review, settings, help], null).map((e) => e.id)).toEqual([
      "actions.approve",
      "help.show",
    ]);
  });

  test("swaps to the settings entries (plus globals) under the settings scope", () => {
    expect(scopedShortcuts([review, settings, help], "settings").map((e) => e.id)).toEqual([
      "settings.search",
      "help.show",
    ]);
  });
});
