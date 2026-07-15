import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";

import type { LineAnnotation } from "@core/lib/types";
import SourceAnnotationThread from "@/components/SourceAnnotationThread.svelte";

import { capture, render } from "../../test-mount.ts";

// SourceAnnotationThread is the caret-owned chrome that frames the comments
// sharing one source line as a single ordered thread. A lone comment renders as
// a bare card (no thread wrapping); two or more render inside a shared container
// with a count and a per-card order cue. Card behavior (collapse, edit, delete)
// lives in SourceAnnotationCard; this component owns only the grouping chrome and
// the focus/edit/delete callback passthrough.

const ann = (over: Partial<LineAnnotation> = {}): LineAnnotation => ({
  id: "a1",
  startLine: 7,
  endLine: 7,
  comment: "needs work",
  ...over,
});

function base(over: Record<string, unknown> = {}) {
  return {
    annotations: [ann()],
    focusedAnnotation: null,
    onFocus: () => {},
    onEdit: () => {},
    onDelete: () => {},
    ...over,
  };
}

describe("SourceAnnotationThread single comment", () => {
  test("renders one card with no thread container or count", () => {
    const { target } = render(SourceAnnotationThread, base());
    expect(target.querySelector('[data-annotation-card="a1"]')).not.toBeNull();
    expect(target.querySelector(".thread")).toBeNull();
    expect(target.querySelector(".thread-count")).toBeNull();
  });
});

describe("SourceAnnotationThread stacked comments", () => {
  const two = [ann({ id: "a", comment: "first" }), ann({ id: "b", comment: "second" })];

  test("wraps the cards in one shared thread container", () => {
    const { target } = render(SourceAnnotationThread, base({ annotations: two }));
    const thread = target.querySelector(".thread");
    expect(thread).not.toBeNull();
    expect(thread!.querySelectorAll("[data-annotation-card]")).toHaveLength(2);
  });

  test("shows the comment count in the header", () => {
    const { target } = render(SourceAnnotationThread, base({ annotations: two }));
    expect(target.querySelector(".thread-count")?.textContent).toContain("2");
  });

  test("renders an ordinal cue per card in input order", () => {
    const { target } = render(SourceAnnotationThread, base({ annotations: two }));
    const ordinals = [...target.querySelectorAll(".thread-ordinal")].map((o) =>
      o.textContent?.trim(),
    );
    expect(ordinals).toEqual(["1", "2"]);
  });

  test("keeps the cards in the thread's annotation order", () => {
    const { target } = render(SourceAnnotationThread, base({ annotations: two }));
    const ids = [...target.querySelectorAll("[data-annotation-card]")].map((c) =>
      c.getAttribute("data-annotation-card"),
    );
    expect(ids).toEqual(["a", "b"]);
  });

  test("passes the focused flag to the matching card only", () => {
    const { target } = render(
      SourceAnnotationThread,
      base({ annotations: two, focusedAnnotation: "b" }),
    );
    // Only the matching card expands; the other stays a collapsed chip. (The body
    // is always mounted for the grid reveal, so expansion is the .expanded class.)
    expect(target.querySelector('[data-annotation-card="b"].card.expanded')).not.toBeNull();
    expect(target.querySelector('[data-annotation-card="a"].card.expanded')).toBeNull();
    expect(target.querySelector('[data-annotation-card="a"] .chip')).not.toBeNull();
  });

  test("routes a card's delete to onDelete with its id", () => {
    const deleted = capture<string>();
    const { target, flush } = render(
      SourceAnnotationThread,
      base({ annotations: two, focusedAnnotation: "a", onDelete: deleted.cb }),
    );
    (target.querySelector('[data-annotation-card="a"] .danger') as HTMLElement).click();
    flush();
    // Delete now confirms first (EXC-749); confirm to fire onDelete. The confirm
    // bubble portals to document.body (anchor mode), so it's reached from there.
    (document.querySelector(".confirm-popover .confirm") as HTMLElement).click();
    expect(deleted.last()).toBe("a");
  });

  test("routes a collapsed card's click to onFocus with its id", () => {
    const focused = capture<string>();
    const { target, flush } = render(
      SourceAnnotationThread,
      base({ annotations: two, onFocus: focused.cb }),
    );
    (target.querySelector('[data-annotation-card="b"] .chip') as HTMLElement).click();
    flush();
    expect(focused.last()).toBe("b");
  });
});
