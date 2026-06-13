import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { render } from "../../test-mount.ts";
import SourceComposer from "./SourceComposer.svelte";

// SourceComposer is the inline comment editor for the source-view gutter flow.
// Component units cover its render output, the line-range label, and its
// submit/cancel callback wiring (including the keyboard chords). The gutter
// reveal and persisted create are e2e.

function mount(over: Record<string, unknown> = {}) {
  const submitted: string[] = [];
  let cancelled = 0;
  const { target } = render(SourceComposer, {
    startLine: 3,
    endLine: 3,
    onSubmit: (c: string) => submitted.push(c),
    onCancel: () => cancelled++,
    ...over,
  });
  const textarea = target.querySelector("textarea") as HTMLTextAreaElement;
  const buttons = Array.from(target.querySelectorAll("button"));
  return {
    target,
    textarea,
    submitBtn: buttons.find((b) => b.textContent?.includes("Comment")) ?? null,
    cancelBtn: buttons.find((b) => b.textContent?.includes("Cancel")) ?? null,
    submitted,
    cancelled: () => cancelled,
  };
}

describe("SourceComposer label", () => {
  test("a single line shows 'Line N'", () => {
    const { target } = mount({ startLine: 5, endLine: 5 });
    expect(target.querySelector(".label")?.textContent).toBe("Line 5");
  });

  test("a range shows 'Lines N–M'", () => {
    const { target } = mount({ startLine: 5, endLine: 9 });
    expect(target.querySelector(".label")?.textContent).toBe("Lines 5–9");
  });
});

describe("SourceComposer submit/cancel", () => {
  test("the Comment button submits the textarea value", () => {
    const { textarea, submitBtn, submitted } = mount();
    textarea.value = "fix this";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    submitBtn!.click();
    expect(submitted).toEqual(["fix this"]);
  });

  test("the Cancel button fires onCancel", () => {
    const { cancelBtn, cancelled } = mount();
    cancelBtn!.click();
    expect(cancelled()).toBe(1);
  });
});

describe("SourceComposer keyboard chords", () => {
  test("Cmd/Ctrl+Enter submits", () => {
    const { textarea, submitted } = mount();
    textarea.value = "via chord";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
    expect(submitted).toEqual(["via chord"]);
  });

  test("Escape cancels", () => {
    const { textarea, cancelled } = mount();
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(cancelled()).toBe(1);
  });

  test("a bare Enter does not submit", () => {
    const { textarea, submitted } = mount();
    textarea.value = "no submit";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(submitted).toHaveLength(0);
  });
});
