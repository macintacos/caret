import "../../../test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { type CreatedAnchor, createSourceCommenting } from "./commenting.ts";

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
  test("cancel closes the composer with no create", () => {
    const c = build();
    c.open({ start: 6, end: 6 });
    c.cancel();
    expect(created).toHaveLength(0);
    expect(c.pending()).toBeUndefined();
  });

  test("cancel while closed is a no-op", () => {
    const c = build();
    expect(() => c.cancel()).not.toThrow();
    expect(c.pending()).toBeUndefined();
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
