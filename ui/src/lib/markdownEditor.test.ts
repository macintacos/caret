import { describe, expect, test } from "bun:test";

import { EditorSelection, EditorState } from "@codemirror/state";

import { chordAction, cursorInList } from "./markdownEditor.ts";

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

// chordAction is the editor's whole Escape/submit decision. It matters because a
// completion list and the surrounding dialog both want Escape, and the dialogs
// listen for it on `document` — so the editor has to decide, not defer.
function keydown(k: string, mods: { metaKey?: boolean; ctrlKey?: boolean } = {}): KeyboardEvent {
  return { key: k, metaKey: false, ctrlKey: false, ...mods } as KeyboardEvent;
}

describe("chordAction", () => {
  test("submits on Cmd+Enter and Ctrl+Enter, list open or not", () => {
    expect(chordAction(keydown("Enter", { metaKey: true }), false)).toBe("submit");
    expect(chordAction(keydown("Enter", { ctrlKey: true }), false)).toBe("submit");
    expect(chordAction(keydown("Enter", { metaKey: true }), true)).toBe("submit");
  });

  test("Escape cancels the editor when no completion list is open", () => {
    expect(chordAction(keydown("Escape"), false)).toBe("cancel");
  });

  test("Escape closes the completion list when one is open", () => {
    expect(chordAction(keydown("Escape"), true)).toBe("closeCompletion");
  });

  test("leaves every other key to the rest of the stack", () => {
    expect(chordAction(keydown("Enter"), false)).toBeNull();
    expect(chordAction(keydown("Enter"), true)).toBeNull();
    expect(chordAction(keydown("Tab"), false)).toBeNull();
    expect(chordAction(keydown("a"), true)).toBeNull();
  });
});
