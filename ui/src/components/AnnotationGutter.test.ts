import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import type { Annotation } from "@core/types";
import { capture, render } from "../../test-mount.ts";
import AnnotationGutter from "./AnnotationGutter.svelte";

const ann = (id: string): Annotation => ({
  id,
  blockId: "b0",
  startOffset: 0,
  endOffset: 3,
  quote: "abc",
  comment: `comment ${id}`,
});

const resolved = (id: string, orphaned: boolean) => ({
  annotation: ann(id),
  orphaned,
  top: orphaned ? null : 10,
});

const baseProps = {
  resolved: [] as ReturnType<typeof resolved>[],
  activeId: null,
  onFocus: () => {},
  onEdit: () => {},
  onDelete: () => {},
};

describe("AnnotationGutter", () => {
  test("empty: shows the count 0 and the select-to-comment hint", () => {
    const { target } = render(AnnotationGutter, baseProps);
    expect(target.querySelector(".count")!.textContent).toBe("0");
    expect(target.querySelector(".hint")).not.toBeNull();
    expect(target.querySelector("[data-annotation-card]")).toBeNull();
  });

  test("renders one card per anchored annotation; no detached section", () => {
    const { target } = render(AnnotationGutter, {
      ...baseProps,
      resolved: [resolved("a1", false), resolved("a2", false)],
    });
    expect(target.querySelectorAll("[data-annotation-card]")).toHaveLength(2);
    expect(target.querySelector(".orphan-section")).toBeNull();
    expect(target.querySelector(".hint")).toBeNull();
    expect(target.querySelector(".count")!.textContent).toBe("2");
  });

  test("splits anchored and orphaned into separate sections", () => {
    const { target } = render(AnnotationGutter, {
      ...baseProps,
      resolved: [resolved("a1", false), resolved("a2", true)],
    });
    expect(target.querySelector(".count")!.textContent).toBe("2");
    const orphanSection = target.querySelector(".orphan-section")!;
    expect(orphanSection).not.toBeNull();
    // The orphaned card carries the detached badge.
    expect(orphanSection.querySelector(".badge")!.textContent).toContain("detached");
  });

  test("passes activeId through to the matching card", () => {
    const { target } = render(AnnotationGutter, {
      ...baseProps,
      resolved: [resolved("a1", false), resolved("a2", false)],
      activeId: "a2",
    });
    const cards = target.querySelectorAll("[data-annotation-card]");
    expect((cards[0] as HTMLElement).classList.contains("active")).toBe(false);
    expect((cards[1] as HTMLElement).classList.contains("active")).toBe(true);
  });

  test("forwards a card's delete up to onDelete", () => {
    const deleted = capture<string>();
    const { target } = render(AnnotationGutter, {
      ...baseProps,
      resolved: [resolved("a1", false)],
      onDelete: deleted.cb,
    });
    (target.querySelector(".link.danger") as HTMLElement).click();
    expect(deleted.last()).toBe("a1");
  });
});
