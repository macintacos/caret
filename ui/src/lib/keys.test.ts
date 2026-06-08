import { describe, expect, test } from "bun:test";
import { isCancelKey, isSubmitChord } from "./keys.ts";

/** Build a minimal KeyboardEvent-shaped object for the predicates under test. */
function key(k: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}): KeyboardEvent {
  return { key: k, metaKey: false, ctrlKey: false, ...mods } as KeyboardEvent;
}

describe("isSubmitChord", () => {
  test("true for Cmd+Enter", () => {
    expect(isSubmitChord(key("Enter", { metaKey: true }))).toBe(true);
  });

  test("true for Ctrl+Enter", () => {
    expect(isSubmitChord(key("Enter", { ctrlKey: true }))).toBe(true);
  });

  test("false for Enter with no modifier", () => {
    expect(isSubmitChord(key("Enter"))).toBe(false);
  });

  test("false for a modified non-Enter key", () => {
    expect(isSubmitChord(key("a", { metaKey: true }))).toBe(false);
  });
});

describe("isCancelKey", () => {
  test("true for Escape", () => {
    expect(isCancelKey(key("Escape"))).toBe(true);
  });

  test("false for any other key", () => {
    expect(isCancelKey(key("Enter"))).toBe(false);
    expect(isCancelKey(key("Esc"))).toBe(false);
  });
});
