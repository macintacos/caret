import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { capture, render } from "../../test-mount.ts";
import RenderedPlanView from "./RenderedPlanView.svelte";

// RenderedPlanView renders the plan as decorated markdown source: one row per
// source line, the syntax markers kept but styled, and no line-number gutter.
// Real-browser behavior (drag-select, scroll, text selection) is covered by the
// e2e spec; these units cover render output and callback wiring.

const text = "# Title\nPlain **bold** and `code`.\n- a point\n";

describe("RenderedPlanView rendering", () => {
  test("renders one data-line row per source line", () => {
    const { target } = render(RenderedPlanView, {
      doc: { name: "plan.md", text },
      contentKey: "r1:v1",
    });
    const rows = target.querySelectorAll("[data-line]");
    expect(rows.length).toBe(text.split("\n").length);
    expect(rows[0]?.getAttribute("data-line")).toBe("1");
  });

  test("keeps the markdown syntax visible, styled, and gutter-free", () => {
    const { target } = render(RenderedPlanView, {
      doc: { name: "plan.md", text },
      contentKey: "r1:v1",
    });
    const boldRow = target.querySelector('[data-line="2"]');
    // the asterisks are still shown, wrapped in a strong element
    expect(boldRow?.querySelector("strong")).not.toBeNull();
    // no gutter: the row's visible text is exactly the source line (no "2" prefix)
    expect(boldRow?.textContent).toBe("Plain **bold** and `code`.");
    // the heading row carries its decoration class
    expect(target.querySelector('[data-line="1"]')?.className).toContain("md-heading");
  });
});

describe("RenderedPlanView interaction wiring", () => {
  test("clicking a row opens a comment on that line", () => {
    const onLineComment = capture<number>();
    const { target, flush } = render(RenderedPlanView, {
      doc: { name: "plan.md", text },
      contentKey: "r1:v1",
      onLineComment: onLineComment.cb,
    });
    flush(); // run the effect that attaches the click listener
    target
      .querySelector('[data-line="3"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onLineComment.last()).toBe(3);
  });

  test("hands the parent a scroll-to-line API and its host on mount", () => {
    const onReady = capture<{ scrollToLine: (n: number) => boolean; host: HTMLElement }>();
    const { flush } = render(RenderedPlanView, {
      doc: { name: "plan.md", text },
      contentKey: "r1:v1",
      onReady: onReady.cb,
    });
    flush(); // run the onReady effect
    expect(typeof onReady.last()?.scrollToLine).toBe("function");
    expect(onReady.last()?.host).toBeInstanceOf(HTMLElement);
  });
});
