import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import type { LineAnnotation } from "@core/types";
import { capture, render } from "../../test-mount.ts";
import SourceAnnotationCard from "./SourceAnnotationCard.svelte";

// SourceAnnotationCard is the collapsible inline card for the source-view
// surface. Component units cover its collapsed/expanded render, the focus/edit/
// delete callback wiring, and the rule that the collapse state is UI-only (it
// never reaches a callback). Positioning, scroll-sync, and the gutter marker are
// exercised by DiffPlanView units + e2e.

const annotation: LineAnnotation = { id: "a1", startLine: 3, endLine: 5, comment: "needs work" };

function click(root: ParentNode, selector: string): void {
  (root.querySelector(selector) as HTMLElement).click();
}

function base(over: Record<string, unknown> = {}) {
  return {
    annotation,
    focused: false,
    onFocus: () => {},
    onEdit: () => {},
    onDelete: () => {},
    ...over,
  };
}

describe("SourceAnnotationCard collapse", () => {
  test("renders collapsed (a chip) when not focused", () => {
    const { target } = render(SourceAnnotationCard, base({ focused: false }));
    expect(target.querySelector(".chip")).not.toBeNull();
    expect(target.querySelector(".body")).toBeNull();
  });

  test("renders expanded when focused", () => {
    const { target } = render(SourceAnnotationCard, base({ focused: true }));
    expect(target.querySelector(".body")).not.toBeNull();
    expect(target.querySelector(".comment")?.textContent).toBe("needs work");
  });

  test("clicking the collapsed chip expands the card without persisting", () => {
    let edited = false;
    const focused = capture<string>();
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: false, onFocus: focused.cb, onEdit: () => (edited = true) }),
    );
    click(target, ".chip");
    flush();
    // Clicking focuses (so the parent can drive the single-focus model) but never
    // routes the collapse toggle through a persistence callback.
    expect(focused.last()).toBe("a1");
    expect(edited).toBe(false);
    expect(target.querySelector(".body")).not.toBeNull();
  });

  test("an expanded card can collapse back to a chip via its toggle (UI-only)", () => {
    let edited = false;
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onEdit: () => (edited = true) }),
    );
    click(target, ".collapse");
    flush();
    expect(target.querySelector(".body")).toBeNull();
    expect(target.querySelector(".chip")).not.toBeNull();
    expect(edited).toBe(false);
  });
});

describe("SourceAnnotationCard label", () => {
  test("a single line shows 'Line N'", () => {
    const single: LineAnnotation = { id: "s", startLine: 7, endLine: 7, comment: "x" };
    const { target } = render(SourceAnnotationCard, base({ annotation: single }));
    expect(target.querySelector(".ref")?.textContent).toBe("Line 7");
  });

  test("a range shows 'Lines N–M'", () => {
    const { target } = render(SourceAnnotationCard, base());
    expect(target.querySelector(".ref")?.textContent).toBe("Lines 3–5");
  });
});

describe("SourceAnnotationCard focus + position", () => {
  test("the focused card carries the focused class", () => {
    const { target } = render(SourceAnnotationCard, base({ focused: true }));
    expect(target.querySelector(".card")?.classList.contains("focused")).toBe(true);
  });

  test("renders inline (no absolute positioning hook)", () => {
    // The card sits in the source view's annotation row, not as an overlay, so it
    // carries no inline top/position style — the parent projects it into the slot.
    const { target } = render(SourceAnnotationCard, base());
    const style = target.querySelector(".card")?.getAttribute("style");
    expect(style == null || !/top:|position\s*:/.test(style)).toBe(true);
  });

  test("carries the data-annotation-card hook for focus scroll", () => {
    const { target } = render(SourceAnnotationCard, base());
    expect(target.querySelector('[data-annotation-card="a1"]')).not.toBeNull();
  });
});

describe("SourceAnnotationCard edit/delete", () => {
  test("delete fires onDelete and does not also focus", () => {
    const deleted = capture<string>();
    let focused = false;
    const { target } = render(
      SourceAnnotationCard,
      base({ focused: true, onFocus: () => (focused = true), onDelete: deleted.cb }),
    );
    click(target, ".danger");
    expect(deleted.last()).toBe("a1");
    expect(focused).toBe(false);
  });

  test("edit opens a textarea seeded with the current comment", () => {
    const { target, flush } = render(SourceAnnotationCard, base({ focused: true }));
    click(target, ".edit");
    flush();
    expect((target.querySelector("textarea") as HTMLTextAreaElement).value).toBe("needs work");
  });

  test("saves a changed, non-empty comment on Cmd/Ctrl+Enter", () => {
    const edited = capture<{ id: string; comment: string }>();
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onEdit: (id: string, comment: string) => edited.cb({ id, comment }) }),
    );
    click(target, ".edit");
    flush();
    const ta = target.querySelector("textarea") as HTMLTextAreaElement;
    ta.value = "revised";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    flush();
    expect(edited.last()).toEqual({ id: "a1", comment: "revised" });
  });

  test("does NOT save an unchanged comment", () => {
    let called = false;
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onEdit: () => (called = true) }),
    );
    click(target, ".edit");
    flush();
    const ta = target.querySelector("textarea") as HTMLTextAreaElement;
    ta.value = "needs work";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    flush();
    expect(called).toBe(false);
  });

  test("Escape cancels the edit without saving", () => {
    let called = false;
    const { target, flush } = render(
      SourceAnnotationCard,
      base({ focused: true, onEdit: () => (called = true) }),
    );
    click(target, ".edit");
    flush();
    const ta = target.querySelector("textarea") as HTMLTextAreaElement;
    ta.value = "discarded";
    ta.dispatchEvent(new Event("input", { bubbles: true }));
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    flush();
    expect(called).toBe(false);
    expect(target.querySelector("textarea")).toBeNull();
  });
});
