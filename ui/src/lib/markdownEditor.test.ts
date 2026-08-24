import "@ui/test-setup.ts";
import { describe, expect, test } from "bun:test";

import { type CompletionSource, completionStatus } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

import {
  backspaceIn as backspace,
  mountEditor,
  completionListPainted as painted,
  typeInto as type,
} from "@ui/test-helpers.ts";

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

// The Escape contract with a REAL completion list. chordAction's table above is
// pure; what it gets fed is where the acceptance criterion actually lives, so this
// drives a live EditorView with a real source rather than asserting on a boolean.
// The window that matters is the one a status check misses: while a source
// re-queries, @codemirror/autocomplete keeps the previous list painted (dimmed)
// and reports "pending" — and Escape there must still belong to the list.
describe("Escape with a live completion list", () => {
  const REVIEW = { reviewId: "rev-1", cwd: "/w/caret", adapter: "claude" };

  function mount(source: CompletionSource, onCancelChord: () => void) {
    return mountEditor({
      placeholder: "",
      ariaLabel: "Comment",
      onCancelChord,
      reviewContext: REVIEW,
      completionSources: [() => source],
    });
  }

  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const pressEscape = (view: EditorView) =>
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    );

  test("dismisses only the list while a re-query holds the painted list open", async () => {
    let cancels = 0;
    let queries = 0;
    let releaseSecondQuery = () => {};
    // No validFor, so every keystroke re-runs the source — the shape a source that
    // asks the daemon per prefix has. The second query hangs, which is the painted
    // -but-"pending" window.
    const source: CompletionSource = async (ctx) => {
      if (++queries > 1) await new Promise<void>((r) => (releaseSecondQuery = r));
      // Anchor after the "@" so the typed prefix filters the options rather than
      // eliminating them — an unmatched prefix paints no list at all.
      return {
        from: ctx.state.doc.toString().lastIndexOf("@") + 1,
        options: [{ label: "alpha.ts" }, { label: "beta.ts" }],
      };
    };
    const { view, dispose } = mount(source, () => cancels++);
    try {
      type(view, "@a");
      await settle(400);
      expect(painted(view)).toBe(true);

      type(view, "l");
      await settle(200);
      expect(completionStatus(view.state)).toBe("pending");
      expect(painted(view)).toBe(true);

      pressEscape(view);
      expect(cancels).toBe(0);
      expect(painted(view)).toBe(false);
    } finally {
      releaseSecondQuery();
      dispose();
    }
  });

  test("an open list claims Enter ahead of the default keymap's newline", async () => {
    // The one thing autocomplete's stock `Prec.highest` keymap buys, and the reason
    // it is kept rather than rebound at a lower precedence: without it, Enter would
    // reach defaultKeymap's insertNewlineAndIndent and split the line instead.
    const source: CompletionSource = async (ctx) => ({
      from: ctx.state.doc.toString().lastIndexOf("@") + 1,
      options: [{ label: "alpha.ts" }],
    });
    const { view, dispose } = mount(source, () => {});
    try {
      type(view, "@a");
      await settle(400);
      expect(painted(view)).toBe(true);

      view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      expect(view.state.doc.toString()).toBe("@alpha.ts");
    } finally {
      dispose();
    }
  });

  test("cancels the editor when no list is painted", async () => {
    let cancels = 0;
    const { view, dispose } = mount(
      async () => null,
      () => cancels++,
    );
    try {
      type(view, "@a");
      await settle(400);
      expect(painted(view)).toBe(false);

      pressEscape(view);
      expect(cancels).toBe(1);
    } finally {
      dispose();
    }
  });

  // Backspace after over-typing. A source that finds nothing returns null, which
  // leaves it in autocomplete's Inactive state — and autocomplete only ARMS a
  // source on `input.type`, so deleting never brings it back on its own.
  // Subsequence matching is permissive, so the way a reviewer reaches zero
  // matches is a typo, and backspace is the reflex correction; without the
  // re-arm the completion is silently dead for the rest of that token.
  test("backspacing off a typo reopens the list", async () => {
    const source: CompletionSource = async (ctx) => {
      const trigger = ctx.matchBefore(/@[^\s@]*/);
      if (trigger === null) return null;
      // The shipped file source's shape: nothing matched is a null result.
      if (trigger.text.includes("z")) return null;
      return { from: trigger.from, filter: false, options: [{ label: "alpha.ts" }] };
    };
    const { view, dispose } = mount(source, () => {});
    try {
      type(view, "@a");
      await settle(400);
      expect(painted(view)).toBe(true);

      type(view, "z");
      await settle(400);
      expect(painted(view)).toBe(false);

      backspace(view);
      await settle(400);
      expect(painted(view)).toBe(true);
    } finally {
      dispose();
    }
  });
});
