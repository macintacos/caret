import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import type { Annotation } from "@core/types";
import { capture, render } from "../../test-mount.ts";
import AnnotationCard from "./AnnotationCard.svelte";

const annotation: Annotation = {
  id: "a1",
  blockId: "b0",
  startOffset: 0,
  endOffset: 5,
  quote: "Hello",
  comment: "original",
};

/** Click an element by selector, returning whether it was found. */
function click(root: ParentNode, selector: string): void {
  (root.querySelector(selector) as HTMLElement).click();
}

describe("AnnotationCard render", () => {
  test("shows quote and comment; hides the detached badge when anchored", () => {
    const { target } = render(AnnotationCard, {
      annotation,
      onFocus: () => {},
      onEdit: () => {},
      onDelete: () => {},
    });
    expect(target.querySelector(".quote")!.textContent).toBe("Hello");
    expect(target.querySelector(".comment")!.textContent).toBe("original");
    expect(target.querySelector(".badge")).toBeNull();
  });

  test("renders the detached badge for an orphaned annotation", () => {
    const { target } = render(AnnotationCard, {
      annotation,
      orphaned: true,
      onFocus: () => {},
      onEdit: () => {},
      onDelete: () => {},
    });
    expect(target.querySelector(".badge")!.textContent).toContain("detached");
    expect(target.querySelector(".card")!.classList.contains("orphaned")).toBe(true);
  });

  test("active prop toggles the active class", () => {
    const { target } = render(AnnotationCard, {
      annotation,
      active: true,
      onFocus: () => {},
      onEdit: () => {},
      onDelete: () => {},
    });
    expect(target.querySelector(".card")!.classList.contains("active")).toBe(true);
  });

  test("top prop positions the card via translateY", () => {
    const { target } = render(AnnotationCard, {
      annotation,
      top: 42,
      onFocus: () => {},
      onEdit: () => {},
      onDelete: () => {},
    });
    expect(target.querySelector(".card")!.getAttribute("style")).toContain("translateY(42px)");
  });
});

describe("AnnotationCard callbacks", () => {
  test("clicking the card focuses it", () => {
    const focused = capture<string>();
    const { target } = render(AnnotationCard, {
      annotation,
      onFocus: focused.cb,
      onEdit: () => {},
      onDelete: () => {},
    });
    click(target, ".card");
    expect(focused.last()).toBe("a1");
  });

  test("delete fires onDelete and stops focus propagation", () => {
    const deleted = capture<string>();
    let focused = false;
    const { target } = render(AnnotationCard, {
      annotation,
      onFocus: () => (focused = true),
      onEdit: () => {},
      onDelete: deleted.cb,
    });
    click(target, ".link.danger");
    expect(deleted.last()).toBe("a1");
    expect(focused).toBe(false);
  });
});

describe("AnnotationCard edit/save guard", () => {
  // The guard: save() only calls onEdit when the trimmed draft is non-empty AND
  // differs from the current comment.
  function startEditing(target: HTMLElement, flush: () => void): HTMLTextAreaElement {
    click(target, ".link:not(.danger)");
    flush();
    return target.querySelector("textarea") as HTMLTextAreaElement;
  }

  function type(textarea: HTMLTextAreaElement, value: string, flush: () => void): void {
    textarea.value = value;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    flush();
  }

  test("edit opens the textarea seeded with the current comment", () => {
    const { target, flush } = render(AnnotationCard, {
      annotation,
      onFocus: () => {},
      onEdit: () => {},
      onDelete: () => {},
    });
    const textarea = startEditing(target, flush);
    flush();
    expect(textarea.value).toBe("original");
  });

  test("saves a changed, non-empty comment", () => {
    const edited = capture<{ id: string; comment: string }>();
    const { target, flush } = render(AnnotationCard, {
      annotation,
      onFocus: () => {},
      onEdit: (id, comment) => edited.cb({ id, comment }),
      onDelete: () => {},
    });
    const textarea = startEditing(target, flush);
    type(textarea, "revised note", flush);
    textarea.dispatchEvent(new Event("blur", { bubbles: true }));
    flush();
    expect(edited.last()).toEqual({ id: "a1", comment: "revised note" });
  });

  test("does NOT save when the comment is unchanged", () => {
    let called = false;
    const { target, flush } = render(AnnotationCard, {
      annotation,
      onFocus: () => {},
      onEdit: () => (called = true),
      onDelete: () => {},
    });
    const textarea = startEditing(target, flush);
    type(textarea, "original", flush);
    textarea.dispatchEvent(new Event("blur", { bubbles: true }));
    flush();
    expect(called).toBe(false);
  });

  test("does NOT save when the comment is blank (whitespace only)", () => {
    let called = false;
    const { target, flush } = render(AnnotationCard, {
      annotation,
      onFocus: () => {},
      onEdit: () => (called = true),
      onDelete: () => {},
    });
    const textarea = startEditing(target, flush);
    type(textarea, "   ", flush);
    textarea.dispatchEvent(new Event("blur", { bubbles: true }));
    flush();
    expect(called).toBe(false);
  });

  test("trims before saving (and before the changed-check)", () => {
    const edited = capture<{ id: string; comment: string }>();
    const { target, flush } = render(AnnotationCard, {
      annotation,
      onFocus: () => {},
      onEdit: (id, comment) => edited.cb({ id, comment }),
      onDelete: () => {},
    });
    const textarea = startEditing(target, flush);
    type(textarea, "  spaced  ", flush);
    textarea.dispatchEvent(new Event("blur", { bubbles: true }));
    flush();
    expect(edited.last()).toEqual({ id: "a1", comment: "spaced" });
  });

  test("Escape cancels the edit without saving", () => {
    let called = false;
    const { target, flush } = render(AnnotationCard, {
      annotation,
      onFocus: () => {},
      onEdit: () => (called = true),
      onDelete: () => {},
    });
    const textarea = startEditing(target, flush);
    type(textarea, "discarded", flush);
    textarea.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    flush();
    expect(called).toBe(false);
    expect(target.querySelector("textarea")).toBeNull();
  });

  test("Cmd/Ctrl+Enter saves a changed comment", () => {
    const edited = capture<{ id: string; comment: string }>();
    const { target, flush } = render(AnnotationCard, {
      annotation,
      onFocus: () => {},
      onEdit: (id, comment) => edited.cb({ id, comment }),
      onDelete: () => {},
    });
    const textarea = startEditing(target, flush);
    type(textarea, "via chord", flush);
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
    flush();
    expect(edited.last()).toEqual({ id: "a1", comment: "via chord" });
  });
});
