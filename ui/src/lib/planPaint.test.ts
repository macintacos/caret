import "../../test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Annotation } from "@core/types";
import { blockFinder, paintAnnotations, unwrapMarks } from "./planPaint.ts";

/** A plan article with the given inner HTML (blocks carry #bN ids). */
function article(html: string): HTMLElement {
  const el = document.createElement("article");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

const ann = (over: Partial<Annotation>): Annotation => ({
  id: "a1",
  blockId: "b0",
  startOffset: 0,
  endOffset: 5,
  quote: "Hello",
  comment: "c",
  ...over,
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("blockFinder", () => {
  test("resolves a block by its structural id", () => {
    const root = article('<p id="b0">Hello world</p>');
    const find = blockFinder(root);
    expect(find("b0")?.textContent).toBe("Hello world");
  });

  test("returns null for a missing block", () => {
    const root = article('<p id="b0">Hello</p>');
    expect(blockFinder(root)("b9")).toBeNull();
  });
});

describe("unwrapMarks", () => {
  test("removes annotation marks and rejoins the text", () => {
    const root = article('<p id="b0">a<mark data-annotation="x">bc</mark>d</p>');
    unwrapMarks(root);
    const p = root.querySelector("#b0")!;
    expect(p.querySelector("mark")).toBeNull();
    expect(p.textContent).toBe("abcd");
    // normalize() coalesces the spliced text back into a single node.
    expect(p.childNodes.length).toBe(1);
  });

  test("leaves a mark without the data-annotation marker untouched", () => {
    const root = article('<p id="b0">a<mark>plain</mark></p>');
    unwrapMarks(root);
    expect(root.querySelector("mark")).not.toBeNull();
  });

  test("is idempotent on a clean tree", () => {
    const root = article('<p id="b0">no marks here</p>');
    unwrapMarks(root);
    expect(root.querySelector("#b0")!.textContent).toBe("no marks here");
  });
});

describe("paintAnnotations", () => {
  test("wraps a tier-1 annotation in a mark carrying id and class", () => {
    const root = article('<p id="b0">Hello world</p>');
    const resolved = paintAnnotations(root, [ann({})], null);

    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.orphaned).toBe(false);
    const mark = root.querySelector("mark[data-annotation]")!;
    expect(mark.getAttribute("data-annotation")).toBe("a1");
    expect(mark.classList.contains("anno")).toBe(true);
    expect(mark.textContent).toBe("Hello");
  });

  test("adds the active class only to the active annotation's marks", () => {
    const root = article('<p id="b0">Hello there friend</p>');
    const annotations = [
      ann({ id: "a1", startOffset: 0, endOffset: 5, quote: "Hello" }),
      ann({ id: "a2", startOffset: 6, endOffset: 11, quote: "there" }),
    ];
    paintAnnotations(root, annotations, "a2");

    const active = root.querySelector('mark[data-annotation="a2"]')!;
    const inactive = root.querySelector('mark[data-annotation="a1"]')!;
    expect(active.classList.contains("active")).toBe(true);
    expect(inactive.classList.contains("active")).toBe(false);
  });

  test("orphans a tier-3 annotation whose block is gone (no mark)", () => {
    const root = article('<p id="b0">Hello world</p>');
    const resolved = paintAnnotations(root, [ann({ blockId: "bX" })], null);

    expect(resolved[0]!.orphaned).toBe(true);
    expect(resolved[0]!.top).toBeNull();
    expect(root.querySelector("mark[data-annotation]")).toBeNull();
  });

  test("orphans when offsets and quote both fail to resolve", () => {
    const root = article('<p id="b0">Hello world</p>');
    // Offsets out of range AND a quote that does not occur → tier 3.
    const resolved = paintAnnotations(
      root,
      [ann({ startOffset: 0, endOffset: 5, quote: "absent" })],
      null,
    );
    expect(resolved[0]!.orphaned).toBe(true);
  });

  test("treats a line-anchored annotation as unanchored on this surface (no mark)", () => {
    const root = article('<p id="b0">Hello world</p>');
    const lineAnn: Annotation = { id: "l1", startLine: 1, endLine: 2, comment: "c" };
    const resolved = paintAnnotations(root, [lineAnn], null);

    expect(resolved).toEqual([{ annotation: lineAnn, orphaned: true, top: null }]);
    expect(root.querySelector("mark[data-annotation]")).toBeNull();
  });

  test("repaints idempotently: a second paint does not accumulate marks", () => {
    const root = article('<p id="b0">Hello world</p>');
    paintAnnotations(root, [ann({})], null);
    paintAnnotations(root, [ann({})], null);
    expect(root.querySelectorAll("mark[data-annotation]")).toHaveLength(1);
  });

  test("wraps a selection crossing token spans in multiple marks sharing one id", () => {
    // shiki splits highlighted code into per-token <span>s; a selection across
    // them produces one mark per intersected text node, all the same annotation.
    const root = article('<pre id="b0"><span>foo</span><span> bar</span></pre>');
    // textContent = "foo bar"; select "oo ba" (offsets 1..6) across both spans.
    const resolved = paintAnnotations(
      root,
      [ann({ startOffset: 1, endOffset: 6, quote: "oo ba" })],
      "a1",
    );
    expect(resolved[0]!.orphaned).toBe(false);
    const marks = root.querySelectorAll('mark[data-annotation="a1"]');
    expect(marks.length).toBeGreaterThan(1);
    for (const m of marks) expect(m.classList.contains("active")).toBe(true);
  });

  test("resolves a drifted annotation by unique quote (tier 2)", () => {
    const root = article('<p id="b0">prefix Hello world</p>');
    // Offsets point at the old position; the quote is still uniquely findable.
    const resolved = paintAnnotations(
      root,
      [ann({ startOffset: 0, endOffset: 5, quote: "Hello" })],
      null,
    );
    expect(resolved[0]!.orphaned).toBe(false);
    expect(root.querySelector("mark[data-annotation]")!.textContent).toBe("Hello");
  });

  test("clears stale marks from a prior annotation set on repaint", () => {
    const root = article('<p id="b0">Hello world</p>');
    paintAnnotations(root, [ann({ id: "a1", quote: "Hello" })], null);
    // Repaint with a different annotation: the a1 mark must be gone.
    paintAnnotations(
      root,
      [ann({ id: "a2", startOffset: 6, endOffset: 11, quote: "world" })],
      null,
    );
    expect(root.querySelector('mark[data-annotation="a1"]')).toBeNull();
    expect(root.querySelector('mark[data-annotation="a2"]')).not.toBeNull();
  });

  test("returns resolutions in annotation order, mixing anchored and orphaned", () => {
    const root = article('<p id="b0">Hello world</p>');
    const resolved = paintAnnotations(
      root,
      [ann({ id: "a1", quote: "Hello" }), ann({ id: "a2", blockId: "bGone", quote: "x" })],
      null,
    );
    expect(resolved.map((r) => r.annotation.id)).toEqual(["a1", "a2"]);
    expect(resolved.map((r) => r.orphaned)).toEqual([false, true]);
  });
});
