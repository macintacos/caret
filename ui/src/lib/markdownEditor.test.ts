import { describe, expect, test } from "bun:test";

import { EditorSelection, EditorState } from "@codemirror/state";

import { cursorInList } from "./markdownEditor.ts";

// cursorInList drives the Tab key: on a list line Tab nests the item, elsewhere
// it inserts four spaces. It reads only the cursor's line, so a bare EditorState
// (no view, no DOM) exercises it fully.
function stateWithCursor(doc: string, at: number): EditorState {
  return EditorState.create({ doc, selection: EditorSelection.cursor(at) });
}

describe("cursorInList", () => {
  test("true on a bullet line", () => {
    expect(cursorInList(stateWithCursor("- item", 3))).toBe(true);
  });

  test("true on an ordered-list line", () => {
    expect(cursorInList(stateWithCursor("1. item", 4))).toBe(true);
    expect(cursorInList(stateWithCursor("2) item", 4))).toBe(true);
  });

  test("true on an already-indented (nested) list line", () => {
    expect(cursorInList(stateWithCursor("    - nested", 8))).toBe(true);
  });

  test("false on a plain paragraph line", () => {
    expect(cursorInList(stateWithCursor("just prose here", 5))).toBe(false);
  });

  test("false when the marker has no following space (not a list)", () => {
    expect(cursorInList(stateWithCursor("-word", 3))).toBe(false);
  });

  test("reads the cursor's own line in a multi-line doc", () => {
    const doc = "prose\n- item";
    expect(cursorInList(stateWithCursor(doc, 8))).toBe(true); // on "- item"
    expect(cursorInList(stateWithCursor(doc, 2))).toBe(false); // on "prose"
  });
});
