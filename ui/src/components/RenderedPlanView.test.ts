import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { capture, render } from "../../test-mount.ts";
import RenderedPlanView from "./RenderedPlanView.svelte";

// RenderedPlanView renders the plan as rendered markdown blocks (EXC-693): lists/
// tables/blockquotes/code render properly, prose is joined (a soft-wrapped
// paragraph is one flowing block), and emphasis keeps its visible markers. But the
// hover / click / drag targets are per SOURCE LINE — every source line is its own
// [data-line] element, so interaction mirrors the source view (a click comments on
// that exact line, a hover highlights just it). Real-browser behavior (drag-select,
// hover paint, shiki) is covered by the e2e spec; these units cover the rendered
// structure, per-line targets, and callback wiring.

// Lines (1-based) are pinned so the anchoring assertions read against known source
// positions:  1 heading · 3-4 joined paragraph · 6 link paragraph · 8-10 list ·
// 12 blockquote · 14-16 table · 18-20 code · 22 footnote-ref para · 24 footnote def.
const DOC = [
  "# Title", // 1
  "", // 2
  "Para soft", // 3
  "wrapped **bold** end.", // 4
  "", // 5
  "See [docs](https://ex.test/a) here.", // 6
  "", // 7
  "- one", // 8
  "- [ ] todo", // 9
  "- [x] done", // 10
  "", // 11
  "> quoted line", // 12
  "", // 13
  "| H1 | H2 |", // 14
  "|----|----|", // 15
  "| a | b |", // 16
  "", // 17
  "```ts", // 18
  "const y = 2;", // 19
  "```", // 20
  "", // 21
  "Note.[^1]", // 22
  "", // 23
  "[^1]: a footnote", // 24
  "",
].join("\n");

function mountDoc(props: Record<string, unknown> = {}) {
  return render(RenderedPlanView, {
    doc: { name: "plan.md", text: DOC },
    contentKey: "r1:v1",
    ...props,
  });
}

describe("RenderedPlanView — per-source-line hit targets", () => {
  test("every source line is its own [data-line] target (the fence line has no row)", () => {
    const { target } = mountDoc();
    const lines = [...target.querySelectorAll("[data-line]")].map((el) =>
      Number(el.getAttribute("data-line")),
    );
    // Heading 1; paragraph 3-4; link para 6; list 8-10; blockquote 12; table
    // header 14 + data row 16 (the |---| divider on 15 renders no row); code line
    // 19 (its fence on 18 is dropped); footnote-ref para 22; footnote def 24.
    expect([...new Set(lines)].sort((a, b) => a - b)).toEqual([
      1, 3, 4, 6, 8, 9, 10, 12, 14, 16, 19, 22, 24,
    ]);
  });

  test("blocks are structural: they no longer carry the anchor themselves", () => {
    const { target } = mountDoc();
    expect(target.querySelector(".md-block[data-line]")).toBeNull();
    expect(target.querySelector("[data-line-end]")).toBeNull();
  });

  test("no line-number gutter: a line's text is its content, not a numbered row", () => {
    const { target } = mountDoc();
    const heading = target.querySelector('[data-line="1"]');
    expect(heading?.textContent?.trim().startsWith("#")).toBe(true);
    expect(heading?.textContent).not.toMatch(/^\s*1\b/);
  });
});

describe("RenderedPlanView — construct rendering", () => {
  test("a soft-wrapped paragraph joins into one block but keeps a target per line", () => {
    const { target } = mountDoc();
    const para = target.querySelector(".md-paragraph");
    expect(para?.querySelector("strong")).not.toBeNull();
    expect(para?.textContent).toContain("**bold**"); // markers stay visible
    expect(para?.textContent).toContain("Para soft");
    expect(para?.textContent).toContain("wrapped");
    // Two source lines → two per-line targets, flowed together into one paragraph.
    expect(para?.querySelectorAll("[data-line]").length).toBe(2);
  });

  test("a link renders as a plain anchor, dropping the [..](..) syntax", () => {
    const { target } = mountDoc();
    const line = target.querySelector('[data-line="6"]');
    const link = line?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://ex.test/a");
    expect(link?.textContent).toBe("docs");
    expect(line?.textContent?.replace(/\s+/g, " ").trim()).toBe("See docs here.");
    expect(line?.textContent).not.toContain("](");
  });

  test("headings carry their level and a visible marker", () => {
    const { target } = mountDoc();
    const heading = target.querySelector('.md-h[data-line="1"]');
    expect(heading?.getAttribute("data-level")).toBe("1");
    expect(heading?.textContent).toContain("#");
    expect(target.querySelector(".md-block.md-heading .md-h")).not.toBeNull();
  });

  test("lists render as real lists with working checkboxes", () => {
    const { target } = mountDoc();
    const list = target.querySelector(".md-list");
    expect(list?.querySelector("ul")).not.toBeNull();
    expect(list?.querySelectorAll("li").length).toBe(3);
    const checks = list?.querySelectorAll('input[type="checkbox"]');
    expect(checks?.length).toBe(2);
    expect((checks?.[0] as HTMLInputElement)?.checked).toBe(false); // - [ ]
    expect((checks?.[1] as HTMLInputElement)?.checked).toBe(true); // - [x]
  });

  test("each list item is its own line target at its source line", () => {
    const { target } = mountDoc();
    expect(target.querySelector('li [data-line="8"]')?.textContent).toContain("one");
    expect(target.querySelector('li [data-line="9"]')?.textContent).toContain("todo");
    expect(target.querySelector('li [data-line="10"]')?.textContent).toContain("done");
  });

  test("blockquotes render as a quote element with the > marker stripped", () => {
    const { target } = mountDoc();
    const quote = target.querySelector(".md-blockquote");
    expect(quote?.querySelector("blockquote")).not.toBeNull();
    expect(quote?.textContent).toContain("quoted line");
    expect(quote?.textContent).not.toContain(">");
  });

  test("tables render as a real table with a target per row", () => {
    const { target } = mountDoc();
    const table = target.querySelector(".md-table");
    expect(table?.querySelector("table")).not.toBeNull();
    expect(table?.querySelectorAll("th").length).toBe(2);
    expect(table?.querySelector("td")?.textContent).toContain("a");
    // Header row anchors on line 14, the data row on 16 (past the |---| divider).
    expect(table?.querySelector('tr[data-line="14"] th')).not.toBeNull();
    expect(table?.querySelector('tr[data-line="16"] td')).not.toBeNull();
  });

  test("code blocks render a code panel with a per-line target (shiki paints async)", () => {
    const { target } = mountDoc();
    const code = target.querySelector(".md-code");
    expect(code?.querySelector("pre")).not.toBeNull();
    expect(code?.textContent).toContain("const y = 2;");
    expect(code?.textContent).not.toContain("```"); // fences hidden
    // The first code line (source line 19) is its own hit target.
    expect(code?.querySelector('[data-line="19"]')).not.toBeNull();
  });

  test("footnotes: a reference is a superscript and the definition is its own block", () => {
    const { target } = mountDoc();
    expect(target.querySelector('[data-line="22"] sup.md-fn-ref')).not.toBeNull();
    const def = target.querySelector(".md-footnote");
    expect(def?.className).toContain("md-footnote");
    expect(def?.textContent).toContain("a footnote");
  });
});

describe("RenderedPlanView — line-level interaction wiring", () => {
  test("clicking a source line opens a comment on that exact line", () => {
    const onLineComment = capture<number>();
    const { target, flush } = mountDoc({ onLineComment: onLineComment.cb });
    flush();
    target
      .querySelector('[data-line="1"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onLineComment.last()).toBe(1);
  });

  test("clicking the second line of a joined paragraph comments on that line, not the block", () => {
    // The paragraph spans lines 3-4 but is one joined block; clicking line 4 must
    // report line 4 — the per-line precision that mirrors the source view, rather
    // than the whole 3-4 range.
    const onLineComment = capture<number>();
    const { target, flush } = mountDoc({ onLineComment: onLineComment.cb });
    flush();
    target
      .querySelector('[data-line="4"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onLineComment.last()).toBe(4);
  });

  test("a click on a link does not also open a comment", () => {
    // A fragment href keeps happy-dom from attempting a real navigation/fetch on
    // the synthetic click while still exercising the link-click guard.
    const onLineComment = capture<number>();
    const { target, flush } = render(RenderedPlanView, {
      doc: { name: "plan.md", text: "See [the docs](#anchor) here." },
      contentKey: "r1:v1",
      onLineComment: onLineComment.cb,
    });
    flush();
    target.querySelector("a")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onLineComment.last()).toBeUndefined();
  });

  test("marks the source lines in the selected range with is-selected", () => {
    const { target, flush } = mountDoc({ selectedRange: { startLine: 3, endLine: 4 } });
    flush();
    expect(target.querySelector('[data-line="3"]')?.className).toContain("is-selected");
    expect(target.querySelector('[data-line="4"]')?.className).toContain("is-selected");
    expect(target.querySelector('[data-line="1"]')?.className).not.toContain("is-selected");
  });

  test("hands the parent a scroll-to-line API and its host on mount", () => {
    const onReady = capture<{ scrollToLine: (n: number) => boolean; host: HTMLElement }>();
    const { flush } = mountDoc({ onReady: onReady.cb });
    flush();
    expect(typeof onReady.last()?.scrollToLine).toBe("function");
    expect(onReady.last()?.host).toBeInstanceOf(HTMLElement);
  });
});
