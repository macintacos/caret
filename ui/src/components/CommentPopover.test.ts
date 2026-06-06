import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { capture, render } from "../../test-mount.ts";
import CommentPopover from "./CommentPopover.svelte";

const baseProps = {
  x: 100,
  y: 200,
  quote: "selected text",
  onConfirm: () => {},
  onDismiss: () => {},
};

/** Open the editor (click the trigger) and return the textarea. */
function openEditor(target: HTMLElement, flush: () => void): HTMLTextAreaElement {
  (target.querySelector(".trigger") as HTMLElement).click();
  flush();
  return target.querySelector("textarea") as HTMLTextAreaElement;
}

function typeInto(textarea: HTMLTextAreaElement, value: string, flush: () => void): void {
  textarea.value = value;
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
  flush();
}

describe("CommentPopover render", () => {
  test("positions itself at the selection coordinates", () => {
    const { target } = render(CommentPopover, baseProps);
    const style = target.querySelector(".popover")!.getAttribute("style") ?? "";
    expect(style).toContain("left: 100px");
    expect(style).toContain("top: 200px");
  });

  test("starts collapsed showing the Comment trigger", () => {
    const { target } = render(CommentPopover, baseProps);
    expect(target.querySelector(".trigger")).not.toBeNull();
    expect(target.querySelector(".card")).toBeNull();
  });

  test("opening reveals the editor card with the quote", () => {
    const { target, flush } = render(CommentPopover, baseProps);
    openEditor(target, flush);
    expect(target.querySelector(".card")).not.toBeNull();
    expect(target.querySelector(".quote")!.getAttribute("title")).toBe("selected text");
  });
});

describe("CommentPopover submit-vs-dismiss", () => {
  test("Comment button confirms a non-empty comment", () => {
    const confirmed = capture<string>();
    const { target, flush } = render(CommentPopover, {
      ...baseProps,
      onConfirm: confirmed.cb,
    });
    const textarea = openEditor(target, flush);
    typeInto(textarea, "needs work", flush);
    (target.querySelector(".solid") as HTMLElement).click();
    expect(confirmed.last()).toBe("needs work");
  });

  test("submitting an empty comment dismisses instead of confirming", () => {
    let confirmed = false;
    let dismissed = false;
    const { target, flush } = render(CommentPopover, {
      ...baseProps,
      onConfirm: () => (confirmed = true),
      onDismiss: () => (dismissed = true),
    });
    openEditor(target, flush);
    (target.querySelector(".solid") as HTMLElement).click();
    expect(confirmed).toBe(false);
    expect(dismissed).toBe(true);
  });

  test("submitting a whitespace-only comment dismisses", () => {
    let confirmed = false;
    let dismissed = false;
    const { target, flush } = render(CommentPopover, {
      ...baseProps,
      onConfirm: () => (confirmed = true),
      onDismiss: () => (dismissed = true),
    });
    const textarea = openEditor(target, flush);
    typeInto(textarea, "   ", flush);
    (target.querySelector(".solid") as HTMLElement).click();
    expect(confirmed).toBe(false);
    expect(dismissed).toBe(true);
  });

  test("confirms the trimmed comment", () => {
    const confirmed = capture<string>();
    const { target, flush } = render(CommentPopover, {
      ...baseProps,
      onConfirm: confirmed.cb,
    });
    const textarea = openEditor(target, flush);
    typeInto(textarea, "  trimmed  ", flush);
    (target.querySelector(".solid") as HTMLElement).click();
    expect(confirmed.last()).toBe("trimmed");
  });

  test("Cancel button dismisses", () => {
    let dismissed = false;
    const { target, flush } = render(CommentPopover, {
      ...baseProps,
      onDismiss: () => (dismissed = true),
    });
    openEditor(target, flush);
    (target.querySelector(".ghost") as HTMLElement).click();
    expect(dismissed).toBe(true);
  });
});

describe("CommentPopover keyboard", () => {
  test("Escape dismisses", () => {
    let dismissed = false;
    const { target, flush } = render(CommentPopover, {
      ...baseProps,
      onDismiss: () => (dismissed = true),
    });
    openEditor(target, flush);
    target
      .querySelector(".popover")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(dismissed).toBe(true);
  });

  test("Cmd/Ctrl+Enter submits a non-empty comment", () => {
    const confirmed = capture<string>();
    const { target, flush } = render(CommentPopover, {
      ...baseProps,
      onConfirm: confirmed.cb,
    });
    const textarea = openEditor(target, flush);
    typeInto(textarea, "chord submit", flush);
    target
      .querySelector(".popover")!
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    expect(confirmed.last()).toBe("chord submit");
  });
});
