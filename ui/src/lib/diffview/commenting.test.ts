import "../../../test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import {
  type ComposerScratch,
  type CreatedAnchor,
  createSourceCommenting,
  normalizeRange,
  rangeLabel,
  scratchKey,
} from "./commenting.ts";

// The source-view gutter commenting controller is a pure state machine over the
// @pierre/diffs gutter utility: a SelectedLineRange opens it, submit/cancel
// drive the transitions, and submit with non-empty text creates a line-anchored
// {startLine, endLine} annotation. The composer DOM is a Svelte component
// (SourceComposer.svelte, covered by its own unit + the e2e); here we test the
// transitions in isolation.

let created: CreatedAnchor[];

function build() {
  created = [];
  return createSourceCommenting({ onCreate: (a) => created.push(a) });
}

beforeEach(() => {
  created = [];
});

describe("composer open/close state", () => {
  test("starts closed: no pending target", () => {
    const c = build();
    expect(c.pending()).toBeUndefined();
  });

  test("open(range) sets the pending range", () => {
    const c = build();
    c.open({ start: 5, end: 7 });
    expect(c.pending()).toEqual({ startLine: 5, endLine: 7 });
  });

  test("a single-line open has startLine === endLine", () => {
    const c = build();
    c.open({ start: 5, end: 5 });
    expect(c.pending()).toEqual({ startLine: 5, endLine: 5 });
  });

  test("open with a descending range normalizes start/end", () => {
    const c = build();
    c.open({ start: 9, end: 4 });
    expect(c.pending()).toEqual({ startLine: 4, endLine: 9 });
  });
});

describe("submit transition", () => {
  test("submit with text creates a single-line anchor and closes", () => {
    const c = build();
    c.open({ start: 3, end: 3 });
    c.submit("fix this");
    expect(created).toEqual([{ startLine: 3, endLine: 3, comment: "fix this" }]);
    expect(c.pending()).toBeUndefined();
  });

  test("submit with a range creates the correct startLine and endLine", () => {
    const c = build();
    c.open({ start: 8, end: 12 });
    c.submit("this block");
    expect(created).toEqual([{ startLine: 8, endLine: 12, comment: "this block" }]);
  });

  test("submit trims surrounding whitespace from the comment", () => {
    const c = build();
    c.open({ start: 2, end: 2 });
    c.submit("  spaced  ");
    expect(created[0]?.comment).toBe("spaced");
  });

  test("submit with empty/whitespace text cancels without creating", () => {
    const c = build();
    c.open({ start: 4, end: 4 });
    c.submit("   ");
    expect(created).toHaveLength(0);
    expect(c.pending()).toBeUndefined();
  });

  test("submit while closed is a no-op", () => {
    const c = build();
    c.submit("nothing open");
    expect(created).toHaveLength(0);
  });
});

describe("cancel transition", () => {
  test("cancel with no text closes the composer with no create and no scratch", () => {
    const c = build();
    c.open({ start: 6, end: 6 });
    c.cancel();
    expect(created).toHaveLength(0);
    expect(c.pending()).toBeUndefined();
    expect(c.scratches()).toHaveLength(0);
  });

  test("cancel with empty/whitespace text leaves no scratch (preserves current discard)", () => {
    const c = build();
    c.open({ start: 6, end: 6 });
    c.cancel("   ");
    expect(c.scratches()).toHaveLength(0);
  });

  test("cancel while closed is a no-op", () => {
    const c = build();
    expect(() => c.cancel()).not.toThrow();
    expect(c.pending()).toBeUndefined();
    expect(c.scratches()).toHaveLength(0);
  });
});

// An unsubmitted composer dismissed with typed text is retained as an in-memory
// scratch anchored to its range, so the reviewer can resume it. This is distinct
// from commentState.ts's "Draft" (a created, pending annotation) — a scratch was
// never added to the working copy; the marker offers "Resume", not "Draft".
describe("scratch drafts", () => {
  test("cancel with text retains a scratch keyed to the pending range", () => {
    const c = build();
    c.open({ start: 4, end: 6 });
    c.cancel("half a thought");
    expect(created).toHaveLength(0);
    expect(c.pending()).toBeUndefined();
    expect(c.scratches()).toEqual([
      {
        key: scratchKey(4, 6),
        startLine: 4,
        endLine: 6,
        text: "half a thought",
      } satisfies ComposerScratch,
    ]);
  });

  test("a scratch trims surrounding whitespace from the retained text", () => {
    const c = build();
    c.open({ start: 2, end: 2 });
    c.cancel("  spaced thought  ");
    expect(c.scratches()[0]?.text).toBe("spaced thought");
  });

  test("opening a scratched range restores its text and consumes the scratch", () => {
    const c = build();
    c.open({ start: 4, end: 6 });
    c.cancel("restore me");
    // Reopen the same range: the pending composer should seed from the scratch,
    // and the scratch is consumed (it moved into the open composer, not copied).
    c.open({ start: 4, end: 6 });
    expect(c.pending()).toEqual({ startLine: 4, endLine: 6 });
    expect(c.pendingText()).toBe("restore me");
    expect(c.scratches()).toHaveLength(0);
  });

  test("opening a range with no scratch seeds empty pending text", () => {
    const c = build();
    c.open({ start: 7, end: 7 });
    expect(c.pendingText()).toBe("");
  });

  test("resume reopens the composer at the scratch's range with its text", () => {
    const c = build();
    c.open({ start: 9, end: 9 });
    c.cancel("resume via marker");
    c.resume(scratchKey(9, 9));
    expect(c.pending()).toEqual({ startLine: 9, endLine: 9 });
    expect(c.pendingText()).toBe("resume via marker");
    expect(c.scratches()).toHaveLength(0);
  });

  test("resume with an unknown key is a no-op", () => {
    const c = build();
    expect(() => c.resume(scratchKey(1, 1))).not.toThrow();
    expect(c.pending()).toBeUndefined();
  });

  test("submitting an open composer clears any scratch for its range", () => {
    const c = build();
    c.open({ start: 3, end: 3 });
    c.cancel("started here");
    expect(c.scratches()).toHaveLength(1);
    c.open({ start: 3, end: 3 });
    c.submit("finished it");
    expect(created).toEqual([{ startLine: 3, endLine: 3, comment: "finished it" }]);
    expect(c.scratches()).toHaveLength(0);
  });

  test("an empty submit of a resumed composer leaves no scratch (the box was cleared)", () => {
    const c = build();
    c.open({ start: 5, end: 5 });
    c.cancel("typed then cleared");
    c.resume(scratchKey(5, 5));
    c.submit("   ");
    expect(created).toHaveLength(0);
    expect(c.scratches()).toHaveLength(0);
  });

  test("scratches on distinct ranges coexist", () => {
    const c = build();
    c.open({ start: 1, end: 1 });
    c.cancel("first");
    c.open({ start: 5, end: 8 });
    c.cancel("second");
    expect(c.scratches()).toEqual([
      { key: scratchKey(1, 1), startLine: 1, endLine: 1, text: "first" },
      { key: scratchKey(5, 8), startLine: 5, endLine: 8, text: "second" },
    ]);
  });

  test("clear() empties the scratch store and closes any open composer", () => {
    const c = build();
    c.open({ start: 2, end: 2 });
    c.cancel("gone on new version");
    c.open({ start: 4, end: 4 });
    c.clear();
    expect(c.scratches()).toHaveLength(0);
    expect(c.pending()).toBeUndefined();
  });

  test("onChange fires when a scratch is retained, resumed, and cleared", () => {
    let ticks = 0;
    const c = createSourceCommenting({ onCreate: () => {}, onChange: () => ticks++ });
    c.open({ start: 1, end: 1 }); // 1
    c.cancel("retain"); // 2 (close + store)
    c.resume(scratchKey(1, 1)); // 3 (reopen)
    c.clear(); // 4 (empties + closes)
    expect(ticks).toBe(4);
  });
});

describe("notifies on state change", () => {
  test("open, submit, and cancel fire the onChange callback", () => {
    let ticks = 0;
    const c = createSourceCommenting({ onCreate: () => {}, onChange: () => ticks++ });
    c.open({ start: 1, end: 1 });
    c.submit("x");
    c.open({ start: 2, end: 2 });
    c.cancel();
    expect(ticks).toBe(4);
  });
});

// The shared normalization the live drag readout and the composer both read, so
// a preview while dragging and the label after release can never disagree.
describe("normalizeRange", () => {
  test("ascending range passes through", () => {
    expect(normalizeRange({ start: 3, end: 7 })).toEqual({ startLine: 3, endLine: 7 });
  });

  test("descending range (bottom-up drag) flips to ascending", () => {
    expect(normalizeRange({ start: 9, end: 4 })).toEqual({ startLine: 4, endLine: 9 });
  });

  test("single line normalizes to startLine === endLine", () => {
    expect(normalizeRange({ start: 5, end: 5 })).toEqual({ startLine: 5, endLine: 5 });
  });
});

describe("rangeLabel", () => {
  test("a single line reads 'Line N'", () => {
    expect(rangeLabel(3, 3)).toBe("Line 3");
  });

  test("a span reads 'Lines X–Y' with an en dash", () => {
    expect(rangeLabel(5, 8)).toBe("Lines 5–8");
  });
});
