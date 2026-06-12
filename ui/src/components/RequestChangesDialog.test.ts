import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import type { Annotation } from "@core/types";
import { capture, render } from "../../test-mount.ts";
import RequestChangesDialog from "./RequestChangesDialog.svelte";

const ann = (id: string, comment: string): Annotation => ({
  id,
  blockId: "b0",
  startOffset: 0,
  endOffset: 3,
  quote: "abc",
  comment,
});

const lineAnn = (id: string, startLine: number, endLine: number, comment: string): Annotation => ({
  id,
  startLine,
  endLine,
  comment,
});

const baseProps = {
  annotations: [] as Annotation[],
  generalComment: "",
  planText: "",
  onGeneralCommentInput: () => {},
  onSubmit: () => {},
  onCancel: () => {},
};

function dialog(target: HTMLElement) {
  return target.querySelector(".dialog")!;
}

describe("RequestChangesDialog render", () => {
  test("pluralizes the inline-comment summary (0 → comments)", () => {
    const { target } = render(RequestChangesDialog, baseProps);
    expect(target.querySelector(".summary")!.textContent).toContain("0 inline comments");
  });

  test("singularizes the summary for exactly one commented annotation", () => {
    const { target } = render(RequestChangesDialog, {
      ...baseProps,
      annotations: [ann("a1", "fix this"), ann("a2", "   ")],
    });
    // Only the non-blank comment counts toward the inline count.
    expect(target.querySelector(".summary")!.textContent).toContain("1 inline comment");
  });

  test("hides the preview and disables submit when there is nothing to send", () => {
    const { target } = render(RequestChangesDialog, baseProps);
    expect(target.querySelector(".preview")).toBeNull();
    expect((target.querySelector(".deny") as HTMLButtonElement).disabled).toBe(true);
  });

  test("shows the preview and enables submit once there is feedback", () => {
    const { target } = render(RequestChangesDialog, {
      ...baseProps,
      generalComment: "please revise",
    });
    expect(target.querySelector(".preview")).not.toBeNull();
    expect(target.querySelector(".preview pre")!.textContent).toContain("please revise");
    expect((target.querySelector(".deny") as HTMLButtonElement).disabled).toBe(false);
  });

  test("the preview quotes a line-anchored annotation's source line from planText", () => {
    const { target } = render(RequestChangesDialog, {
      ...baseProps,
      annotations: [lineAnn("l1", 2, 2, "tighten")],
      planText: ["# Heading", "warm the cache on boot", "more"].join("\n"),
    });
    const preview = target.querySelector(".preview pre")!.textContent ?? "";
    expect(preview).toContain("Line 2:");
    expect(preview).toContain("> warm the cache on boot");
  });
});

describe("RequestChangesDialog callbacks", () => {
  test("typing in the textarea reports up through onGeneralCommentInput", () => {
    const value = capture<string>();
    const { target } = render(RequestChangesDialog, {
      ...baseProps,
      onGeneralCommentInput: value.cb,
    });
    const textarea = target.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "drafting";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    expect(value.last()).toBe("drafting");
  });

  test("submit sends the trimmed general comment", () => {
    const submitted = capture<string>();
    const { target } = render(RequestChangesDialog, {
      ...baseProps,
      generalComment: "  needs more detail  ",
      onSubmit: submitted.cb,
    });
    (target.querySelector(".deny") as HTMLElement).click();
    expect(submitted.last()).toBe("needs more detail");
  });

  test("Cancel button fires onCancel", () => {
    let canceled = false;
    const { target } = render(RequestChangesDialog, {
      ...baseProps,
      onCancel: () => (canceled = true),
    });
    (target.querySelector(".ghost") as HTMLElement).click();
    expect(canceled).toBe(true);
  });

  test("clicking the scrim (outside the dialog) cancels", () => {
    let canceled = false;
    const { target } = render(RequestChangesDialog, {
      ...baseProps,
      onCancel: () => (canceled = true),
    });
    (target.querySelector(".scrim") as HTMLElement).click();
    expect(canceled).toBe(true);
  });
});

describe("RequestChangesDialog keyboard", () => {
  test("Escape cancels", () => {
    let canceled = false;
    const { target } = render(RequestChangesDialog, {
      ...baseProps,
      onCancel: () => (canceled = true),
    });
    dialog(target).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(canceled).toBe(true);
  });

  test("Cmd/Ctrl+Enter submits", () => {
    const submitted = capture<string>();
    const { target } = render(RequestChangesDialog, {
      ...baseProps,
      generalComment: "send it",
      onSubmit: submitted.cb,
    });
    dialog(target).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
    expect(submitted.last()).toBe("send it");
  });
});
