import { describe, expect, test } from "bun:test";

import { isKbdKey, kbdCap } from "$lib/shortcuts/caps.ts";

// The typed cap schema (caps.ts): "shift" is the one key that resolves to the
// global icon; letters render as their own text; glyph strings from the reserved
// keymap are not known keys, so they pass through untouched.
describe("kbd caps", () => {
  test("shift resolves to the global shift icon, not a glyph", () => {
    expect(kbdCap("shift")).toEqual({ icon: "arrow-big-up", label: "Shift" });
  });

  test("a letter renders as its own text, case preserved", () => {
    expect(kbdCap("C")).toEqual({ text: "C" });
    expect(kbdCap("j")).toEqual({ text: "j" });
  });

  test("isKbdKey accepts letters and shift, rejects glyph strings", () => {
    for (const known of ["shift", "a", "Z", "c", "C"]) {
      expect(isKbdKey(known)).toBe(true);
    }
    for (const glyph of ["⇧", "⌘", "Esc", "↵", "/", "]"]) {
      expect(isKbdKey(glyph)).toBe(false);
    }
  });
});
