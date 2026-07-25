import "@ui/test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import type { PendingComposer } from "$lib/diffview/commenting.ts";
import { createLineDrag, type LineDrag, type LineDragPointer } from "$lib/diffview/lineDrag.ts";

// The content-drag controller is a pure pointer state machine: a non-Shift drag
// across the code body selects a line range and, on release, commits it (the host
// opens the range composer); Shift bows out so native text selection runs; a press
// with no movement falls through to the single-line click path. The DOM hit-test
// (line under a point) is injected, so the transitions are tested without a browser.
// Here lineFromPoint maps clientY directly to a 1-based line (null below 1), so an
// event at clientY: 3 sits on line 3.

let commits: PendingComposer[];
let previews: (PendingComposer | null)[];

function build(): LineDrag {
  commits = [];
  previews = [];
  return createLineDrag({
    lineFromPoint: (_x, y) => (y >= 1 ? y : null),
    onPreview: (r) => previews.push(r),
    onCommit: (r) => commits.push(r),
  });
}

function ev(line: number, opts: Partial<LineDragPointer> = {}): LineDragPointer {
  return {
    pointerId: 1,
    button: 0,
    shiftKey: false,
    clientX: 10,
    clientY: line,
    ...opts,
  };
}

beforeEach(() => {
  commits = [];
  previews = [];
});

describe("commit on release", () => {
  test("a plain drag across lines commits one ascending range", () => {
    const d = build();
    d.pointerdown(ev(3));
    d.pointermove(ev(7));
    d.pointerup(ev(7));
    expect(commits).toEqual([{ startLine: 3, endLine: 7 }]);
  });

  test("a bottom-up drag normalizes to an ascending range", () => {
    const d = build();
    d.pointerdown(ev(9));
    d.pointermove(ev(5));
    d.pointerup(ev(5));
    expect(commits).toEqual([{ startLine: 5, endLine: 9 }]);
  });

  test("a press with no movement does not commit (single-line click falls through)", () => {
    const d = build();
    d.pointerdown(ev(3));
    d.pointerup(ev(3));
    expect(commits).toEqual([]);
    expect(previews).toEqual([]);
  });
});

describe("live preview", () => {
  test("the preview tracks the growing range and clears on commit", () => {
    const d = build();
    d.pointerdown(ev(3));
    d.pointermove(ev(5));
    d.pointermove(ev(7));
    d.pointerup(ev(7));
    expect(previews).toEqual([{ startLine: 3, endLine: 5 }, { startLine: 3, endLine: 7 }, null]);
  });

  test("cancel mid-drag clears the preview without committing", () => {
    const d = build();
    d.pointerdown(ev(3));
    d.pointermove(ev(7));
    d.cancel();
    d.pointerup(ev(7));
    expect(commits).toEqual([]);
    expect(previews).toEqual([{ startLine: 3, endLine: 7 }, null]);
  });
});

describe("the Shift escape-hatch", () => {
  test("Shift+drag is ignored so native text selection runs", () => {
    const d = build();
    d.pointerdown(ev(3, { shiftKey: true }));
    d.pointermove(ev(7, { shiftKey: true }));
    d.pointerup(ev(7, { shiftKey: true }));
    expect(commits).toEqual([]);
    expect(previews).toEqual([]);
  });
});

describe("guards", () => {
  test("a pointerdown off any code line is ignored", () => {
    const d = build();
    d.pointerdown(ev(0)); // lineFromPoint returns null below line 1
    d.pointermove(ev(7));
    d.pointerup(ev(7));
    expect(commits).toEqual([]);
  });

  test("a non-primary button is ignored", () => {
    const d = build();
    d.pointerdown(ev(3, { button: 2 }));
    d.pointermove(ev(7));
    d.pointerup(ev(7));
    expect(commits).toEqual([]);
  });

  test("moves from a different pointer id do not advance the drag", () => {
    const d = build();
    d.pointerdown(ev(3));
    d.pointermove(ev(7, { pointerId: 2 }));
    d.pointerup(ev(3));
    expect(commits).toEqual([]);
    expect(previews).toEqual([]);
  });
});

describe("arm signal", () => {
  test("pointerdown returns true when it arms a gesture", () => {
    expect(build().pointerdown(ev(3))).toBe(true);
  });

  test("pointerdown returns false for Shift, a non-primary button, or off any code line", () => {
    expect(build().pointerdown(ev(3, { shiftKey: true }))).toBe(false);
    expect(build().pointerdown(ev(3, { button: 2 }))).toBe(false);
    expect(build().pointerdown(ev(0))).toBe(false);
  });

  test("pointerdown returns false while a gesture is already armed", () => {
    const d = build();
    expect(d.pointerdown(ev(3))).toBe(true);
    expect(d.pointerdown(ev(5))).toBe(false);
  });
});
