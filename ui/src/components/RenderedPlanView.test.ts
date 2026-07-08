import "../../test-mount.ts";
import { describe, expect, test } from "bun:test";
import { capture, render } from "../../test-mount.ts";
import RenderedPlanView from "./RenderedPlanView.svelte";

// RenderedPlanView renders the plan as rendered markdown blocks (EXC-693): each
// top-level markdown block is one anchor carrying its source line range, prose
// is joined (a soft-wrapped paragraph is one block), lists/tables/blockquotes/
// code render properly, and emphasis keeps its visible markers. Real-browser
// behavior (drag-select, scroll, shiki paint) is covered by the e2e spec; these
// units cover the rendered structure, line-range anchoring, and callback wiring.

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

describe("RenderedPlanView — block structure and anchoring", () => {
  test("renders one anchored block per top-level markdown block", () => {
    const { target } = mountDoc();
    const blocks = [...target.querySelectorAll("[data-line]")].map((el) => [
      el.getAttribute("data-line"),
      el.getAttribute("data-line-end"),
    ]);
    expect(blocks).toEqual([
      ["1", "1"], // heading
      ["3", "4"], // joined paragraph
      ["6", "6"], // link paragraph
      ["8", "10"], // list
      ["12", "12"], // blockquote
      ["14", "16"], // table
      ["18", "20"], // code
      ["22", "22"], // footnote-ref paragraph
      ["24", "24"], // footnote definition
    ]);
  });

  test("no line-number gutter: a block's text is its content, not a numbered row", () => {
    const { target } = mountDoc();
    const heading = target.querySelector('[data-line="1"]');
    expect(heading?.textContent?.trim().startsWith("#")).toBe(true);
    expect(heading?.textContent).not.toMatch(/^\s*1\b/);
  });
});

describe("RenderedPlanView — construct rendering", () => {
  test("a soft-wrapped paragraph is one joined block with visible emphasis markers", () => {
    const { target } = mountDoc();
    const para = target.querySelector('[data-line="3"]');
    expect(para?.querySelector("strong")).not.toBeNull();
    expect(para?.textContent).toContain("**bold**"); // markers stay visible
    expect(para?.textContent).toContain("Para soft");
    expect(para?.textContent).toContain("wrapped");
  });

  test("a link renders as a plain anchor, dropping the [..](..) syntax", () => {
    const { target } = mountDoc();
    const para = target.querySelector('[data-line="6"]');
    const link = para?.querySelector("a");
    expect(link?.getAttribute("href")).toBe("https://ex.test/a");
    expect(link?.textContent).toBe("docs");
    // Normalize the anchor's insignificant layout whitespace (the hover "+" span,
    // template indentation) before asserting the visible prose.
    expect(para?.textContent?.replace(/\s+/g, " ").trim()).toBe("See docs here.");
    expect(para?.textContent).not.toContain("](");
  });

  test("headings carry their level and a visible marker", () => {
    const { target } = mountDoc();
    const heading = target.querySelector('[data-line="1"]');
    expect(heading?.className).toContain("md-heading");
    expect(heading?.querySelector("[data-level]")?.getAttribute("data-level")).toBe("1");
    expect(heading?.textContent).toContain("#");
  });

  test("lists render as real lists with working checkboxes", () => {
    const { target } = mountDoc();
    const list = target.querySelector('[data-line="8"]');
    expect(list?.querySelector("ul")).not.toBeNull();
    expect(list?.querySelectorAll("li").length).toBe(3);
    const checks = list?.querySelectorAll('input[type="checkbox"]');
    expect(checks?.length).toBe(2);
    expect((checks?.[0] as HTMLInputElement)?.checked).toBe(false); // - [ ]
    expect((checks?.[1] as HTMLInputElement)?.checked).toBe(true); // - [x]
  });

  test("blockquotes render as a quote element with the > marker stripped", () => {
    const { target } = mountDoc();
    const quote = target.querySelector('[data-line="12"]');
    expect(quote?.querySelector("blockquote")).not.toBeNull();
    expect(quote?.textContent).toContain("quoted line");
    expect(quote?.textContent).not.toContain(">");
  });

  test("tables render as a real table", () => {
    const { target } = mountDoc();
    const table = target.querySelector('[data-line="14"]');
    expect(table?.querySelector("table")).not.toBeNull();
    expect(table?.querySelectorAll("th").length).toBe(2);
    expect(table?.querySelector("td")?.textContent).toContain("a");
  });

  test("code blocks render a code panel carrying the code text (shiki paints async)", () => {
    const { target } = mountDoc();
    const code = target.querySelector('[data-line="18"]');
    expect(code?.querySelector("pre")).not.toBeNull();
    expect(code?.textContent).toContain("const y = 2;");
    expect(code?.textContent).not.toContain("```"); // fences hidden
  });

  test("footnotes: a reference is a superscript and the definition is its own block", () => {
    const { target } = mountDoc();
    expect(target.querySelector('[data-line="22"] sup.md-fn-ref')).not.toBeNull();
    const def = target.querySelector('[data-line="24"]');
    expect(def?.className).toContain("md-footnote");
    expect(def?.textContent).toContain("a footnote");
  });
});

describe("RenderedPlanView — interaction wiring", () => {
  test("clicking a single-line block opens a comment on that line", () => {
    const onLineComment = capture<number>();
    const { target, flush } = mountDoc({ onLineComment: onLineComment.cb });
    flush();
    target
      .querySelector('[data-line="1"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onLineComment.last()).toBe(1);
  });

  test("clicking a multi-line block opens a range comment over its whole source range", () => {
    const ranges: Array<[number, number]> = [];
    const { target, flush } = mountDoc({
      onLineRangeComment: (s: number, e: number) => ranges.push([s, e]),
    });
    flush();
    target
      .querySelector('[data-line="3"]')
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(ranges).toEqual([[3, 4]]); // the joined paragraph spans lines 3-4
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

  test("highlights the blocks overlapping the selected range", () => {
    const { target } = mountDoc({ selectedRange: { startLine: 3, endLine: 4 } });
    expect(target.querySelector('[data-line="3"]')?.className).toContain("md-selected");
    expect(target.querySelector('[data-line="1"]')?.className).not.toContain("md-selected");
  });

  test("hands the parent a scroll-to-line API and its host on mount", () => {
    const onReady = capture<{ scrollToLine: (n: number) => boolean; host: HTMLElement }>();
    const { flush } = mountDoc({ onReady: onReady.cb });
    flush();
    expect(typeof onReady.last()?.scrollToLine).toBe("function");
    expect(onReady.last()?.host).toBeInstanceOf(HTMLElement);
  });
});
