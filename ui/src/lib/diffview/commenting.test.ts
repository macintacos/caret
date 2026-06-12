import "../../../test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import { type CreatedAnchor, createSourceCommenting } from "./commenting.ts";

// The source-view gutter composer is a plain controller over the @pierre/diffs
// gutter utility: a SelectedLineRange opens it, it builds the composer DOM that
// renderAnnotation slots inline at the pending line, and submit/cancel drive the
// transitions. The DOM-building and state machine are unit-tested here against
// happy-dom; the real-browser create flow is an e2e.

let created: CreatedAnchor[];

function build() {
  created = [];
  return createSourceCommenting({ onCreate: (a) => created.push(a) });
}

/** Find the composer's textarea / buttons within a built composer element. */
function parts(el: HTMLElement) {
  const textarea = el.querySelector("textarea") as HTMLTextAreaElement | null;
  const buttons = Array.from(el.querySelectorAll("button"));
  const submit = buttons.find((b) => b.dataset.action === "submit") ?? null;
  const cancel = buttons.find((b) => b.dataset.action === "cancel") ?? null;
  return { textarea, submit, cancel };
}

beforeEach(() => {
  created = [];
});

describe("composer open/close state", () => {
  test("starts closed: no pending line, no composer DOM", () => {
    const c = build();
    expect(c.pendingLine()).toBeUndefined();
    expect(c.renderComposer(1)).toBeUndefined();
  });

  test("open(range) sets the pending line to the range start", () => {
    const c = build();
    c.open({ start: 5, end: 5 });
    expect(c.pendingLine()).toBe(5);
  });

  test("open with a descending range normalizes start/end", () => {
    const c = build();
    c.open({ start: 9, end: 4 });
    expect(c.pendingLine()).toBe(4);
  });

  test("renderComposer returns DOM only for the pending line", () => {
    const c = build();
    c.open({ start: 5, end: 7 });
    expect(c.renderComposer(5)).toBeInstanceOf(HTMLElement);
    expect(c.renderComposer(6)).toBeUndefined();
  });
});

describe("submit transition", () => {
  test("submit with text creates a single-line anchor and closes", () => {
    const c = build();
    c.open({ start: 3, end: 3 });
    const el = c.renderComposer(3)!;
    const { textarea, submit } = parts(el);
    textarea!.value = "fix this";
    submit!.click();
    expect(created).toEqual([{ startLine: 3, endLine: 3, comment: "fix this" }]);
    expect(c.pendingLine()).toBeUndefined();
  });

  test("submit with a range creates the correct startLine and endLine", () => {
    const c = build();
    c.open({ start: 8, end: 12 });
    const el = c.renderComposer(8)!;
    const { textarea, submit } = parts(el);
    textarea!.value = "this block";
    submit!.click();
    expect(created).toEqual([{ startLine: 8, endLine: 12, comment: "this block" }]);
  });

  test("submit trims surrounding whitespace from the comment", () => {
    const c = build();
    c.open({ start: 2, end: 2 });
    const el = c.renderComposer(2)!;
    const { textarea, submit } = parts(el);
    textarea!.value = "  spaced  ";
    submit!.click();
    expect(created[0]?.comment).toBe("spaced");
  });

  test("submit with empty text cancels without creating", () => {
    const c = build();
    c.open({ start: 4, end: 4 });
    const el = c.renderComposer(4)!;
    const { textarea, submit } = parts(el);
    textarea!.value = "   ";
    submit!.click();
    expect(created).toHaveLength(0);
    expect(c.pendingLine()).toBeUndefined();
  });
});

describe("cancel transition", () => {
  test("cancel button closes the composer with no create", () => {
    const c = build();
    c.open({ start: 6, end: 6 });
    const el = c.renderComposer(6)!;
    const { cancel } = parts(el);
    cancel!.click();
    expect(created).toHaveLength(0);
    expect(c.pendingLine()).toBeUndefined();
  });

  test("cancel() method closes the composer", () => {
    const c = build();
    c.open({ start: 6, end: 6 });
    c.cancel();
    expect(c.pendingLine()).toBeUndefined();
    expect(c.renderComposer(6)).toBeUndefined();
  });
});

describe("keyboard chords", () => {
  test("Escape cancels the composer", () => {
    const c = build();
    c.open({ start: 1, end: 1 });
    const el = c.renderComposer(1)!;
    const { textarea } = parts(el);
    textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(c.pendingLine()).toBeUndefined();
    expect(created).toHaveLength(0);
  });

  test("Cmd/Ctrl+Enter submits the composer", () => {
    const c = build();
    c.open({ start: 1, end: 2 });
    const el = c.renderComposer(1)!;
    const { textarea } = parts(el);
    textarea!.value = "via chord";
    textarea!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
    expect(created).toEqual([{ startLine: 1, endLine: 2, comment: "via chord" }]);
    expect(c.pendingLine()).toBeUndefined();
  });

  test("a bare Enter does not submit", () => {
    const c = build();
    c.open({ start: 1, end: 1 });
    const el = c.renderComposer(1)!;
    const { textarea } = parts(el);
    textarea!.value = "no submit";
    textarea!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(created).toHaveLength(0);
    expect(c.pendingLine()).toBe(1);
  });
});

describe("notifies on state change", () => {
  test("open and close fire the onChange callback", () => {
    let ticks = 0;
    const c = createSourceCommenting({ onCreate: () => {}, onChange: () => ticks++ });
    c.open({ start: 1, end: 1 });
    c.cancel();
    expect(ticks).toBe(2);
  });
});
