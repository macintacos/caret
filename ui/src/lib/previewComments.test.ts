import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import type { RectReader } from "$lib/geometry.ts";
import { renderPlanMarkdown } from "$lib/planMarkdown.ts";
import { createPlanSourceMap, type PlanSourceMap } from "$lib/planSourceMap.ts";
import { previewCodeBlocks } from "$lib/previewCode.ts";
import {
  clearCommentHighlight,
  commentSlotIndex,
  createSlotGaps,
  groupBySlot,
  paintCommentHighlight,
  type SlotGap,
  sameSlotGaps,
  slotEdge,
  slotGap,
  slotRanks,
  spanRanges,
} from "$lib/previewComments.ts";

let mounted: HTMLElement[] = [];

afterEach(() => {
  for (const el of mounted) el.remove();
  mounted = [];
});

function mount(text: string): { root: HTMLElement; map: PlanSourceMap } {
  const root = document.createElement("div");
  root.innerHTML = renderPlanMarkdown(text).html;
  document.body.append(root);
  mounted.push(root);
  return { root, map: createPlanSourceMap(root) };
}

const texts = (ranges: Range[]): string[] => ranges.map((r) => r.toString());

describe("commentSlotIndex", () => {
  // Blocks: a paragraph on 1, a list on 3–5, a fence on 7–10, a paragraph on 12.
  const blocks = renderPlanMarkdown("para\n\n- a\n- b\n- c\n\n```ts\nx\ny\n```\n\nend").blocks;

  test("places a line after the block holding it", () => {
    expect(commentSlotIndex(blocks, 1)).toBe(0);
    expect(commentSlotIndex(blocks, 3)).toBe(1);
    expect(commentSlotIndex(blocks, 5)).toBe(1);
    expect(commentSlotIndex(blocks, 4)).toBe(1);
    expect(commentSlotIndex(blocks, 8)).toBe(2);
    expect(commentSlotIndex(blocks, 12)).toBe(3);
  });

  test("places a gap line after the block before it", () => {
    expect(commentSlotIndex(blocks, 6)).toBe(1);
  });

  test("places a line past the end after the last block", () => {
    expect(commentSlotIndex(blocks, 40)).toBe(3);
  });

  test("places a line above every block after the first", () => {
    expect(commentSlotIndex([{ start: 3, end: 4 }], 1)).toBe(0);
  });

  test("has no slot without blocks", () => {
    expect(commentSlotIndex([], 1)).toBeNull();
  });
});

describe("slotRanks", () => {
  // Blocks: a paragraph on 1–3, a paragraph on 5–6.
  const blocks = [
    { start: 1, end: 3 },
    { start: 5, end: 6 },
  ];
  // Line 1's comment opens mid-paragraph before the row starting at 2:4; lines 3 and 6 end
  // their blocks; line 2's shares line 1's gap.
  const gaps = new Map<number, SlotGap>([
    [1, { before: { line: 2, column: 4 } }],
    [2, { before: { line: 2, column: 4 } }],
    [3, { block: 0 }],
    [6, { block: 1 }],
  ]);
  const ranks = slotRanks(blocks, gaps);

  test("orders gaps top to bottom, a mid-block gap before its block's end", () => {
    expect([1, 3, 6].map(ranks.slotOf)).toEqual([0, 1, 2]);
  });

  test("gives comments sharing a gap one slot", () => {
    expect(ranks.slotOf(2)).toBe(ranks.slotOf(1));
  });

  test("counts a gap above a point at or after where it opens", () => {
    expect(ranks.slotAt({ line: 2, column: 3 })).toBe(0);
    expect(ranks.slotAt({ line: 2, column: 4 })).toBe(1);
    expect(ranks.slotAt({ line: 3, column: 0 })).toBe(1);
    expect(ranks.slotAt({ line: 5, column: 0 })).toBe(2);
    expect(ranks.slotAt({ line: 6, column: 9 })).toBe(2);
  });

  test("resolves a slot back to its gap", () => {
    expect(ranks.gapOf(0)).toEqual({ before: { line: 2, column: 4 } });
    expect(ranks.gapOf(2)).toEqual({ block: 1 });
  });

  test("puts a line without a gap after its block", () => {
    expect(ranks.slotOf(5)).toBe(ranks.slotOf(6));
  });

  test("ranks a line whose block end has no measured gap at that end", () => {
    const sparse = slotRanks(
      blocks,
      new Map<number, SlotGap>([
        [1, { before: { line: 2, column: 4 } }],
        [6, { block: 1 }],
      ]),
    );
    expect(sparse.slotOf(1)).toBeLessThan(sparse.slotOf(3));
    expect(sparse.slotOf(3)).toBeLessThan(sparse.slotOf(6));
    expect(sparse.gapOf(sparse.slotOf(3))).toEqual({ block: 0 });
  });

  test("ranks each block's lines apart before any gap is measured", () => {
    const empty = slotRanks(blocks, new Map());
    expect(empty.slotOf(3)).toBeLessThan(empty.slotOf(6));
    expect(empty.slotAt({ line: 5, column: 0 })).toBeGreaterThan(empty.slotOf(3));
  });
});

describe("sameSlotGaps", () => {
  const a = new Map<number, SlotGap>([
    [1, { before: { line: 2, column: 4 } }],
    [3, { block: 0 }],
  ]);

  test("matches a map with the same gaps", () => {
    expect(sameSlotGaps(a, new Map(a))).toBe(true);
  });

  test("tells a moved, retyped or missing gap apart", () => {
    expect(sameSlotGaps(a, new Map([...a, [1, { before: { line: 2, column: 5 } }]]))).toBe(false);
    expect(sameSlotGaps(a, new Map([...a, [3, { block: 1 }]]))).toBe(false);
    expect(sameSlotGaps(a, new Map([...a, [1, { block: 0 }]]))).toBe(false);
    expect(sameSlotGaps(a, new Map([[3, { block: 0 }]]))).toBe(false);
  });
});

describe("slotEdge", () => {
  // Visual lines: 1:0 and 1:8 (block 0), 3:0 (block 1); line 5 (block 2) renders nothing.
  const blocks = [
    { start: 1, end: 1 },
    { start: 3, end: 3 },
    { start: 5, end: 5 },
  ];
  const rows = [
    { line: 1, column: 0 },
    { line: 1, column: 8 },
    { line: 3, column: 0 },
  ];
  const index = (p: { line: number; column: number }) =>
    rows.findIndex((r) => r.line === p.line && r.column === p.column);
  const at = {
    pointForLine: (line: number) => rows.find((r) => r.line >= line) ?? rows.at(-1) ?? null,
    step: (p: { line: number; column: number }, count: number) =>
      rows[Math.min(Math.max(index(p) + count, 0), rows.length - 1)] ?? p,
    last: () => rows.at(-1) ?? null,
  };

  test("a mid-block gap's rows are the one it opens before and the one above", () => {
    const gap = { before: { line: 1, column: 8 } };
    expect(slotEdge(gap, "below", blocks, at)).toEqual({ line: 1, column: 8 });
    expect(slotEdge(gap, "above", blocks, at)).toEqual({ line: 1, column: 0 });
  });

  test("a block's gap sits between its last row and the next block's first", () => {
    expect(slotEdge({ block: 0 }, "below", blocks, at)).toEqual({ line: 3, column: 0 });
    expect(slotEdge({ block: 0 }, "above", blocks, at)).toEqual({ line: 1, column: 8 });
  });

  test("past the last block that renders text, nothing is below and the last row above", () => {
    expect(slotEdge({ block: 1 }, "below", blocks, at)).toBeNull();
    expect(slotEdge({ block: 1 }, "above", blocks, at)).toEqual({ line: 3, column: 0 });
  });
});

describe("groupBySlot", () => {
  test("groups by line ascending, keeping input order on a line", () => {
    const items = [
      { line: 6, id: "c" },
      { line: 1, id: "a" },
      { line: 5, id: "b1" },
      { line: 5, id: "b2" },
    ];
    expect(groupBySlot(items)).toEqual([
      { line: 1, items: [{ line: 1, id: "a" }] },
      {
        line: 5,
        items: [
          { line: 5, id: "b1" },
          { line: 5, id: "b2" },
        ],
      },
      { line: 6, items: [{ line: 6, id: "c" }] },
    ]);
  });
});

describe("spanRanges", () => {
  test("joins a soft-wrapped paragraph's lines to their rendered text", () => {
    const { map } = mount("one\ntwo");
    expect(
      texts(spanRanges(map, { start: 1, end: 2 }))
        .join("")
        .trim(),
    ).toBe("one\ntwo");
  });

  test("covers a span crossing two blocks", () => {
    const { map } = mount("one\n\ntwo");
    expect(texts(spanRanges(map, { start: 1, end: 3 })).map((t) => t.trim())).toEqual([
      "one",
      "two",
    ]);
  });

  test("skips blank and fence lines, which render no text", () => {
    const { map } = mount("one\n\n```\ncode\n```");
    expect(texts(spanRanges(map, { start: 1, end: 5 })).map((t) => t.trim())).toEqual([
      "one",
      "code",
    ]);
  });
});

describe("comment highlight", () => {
  test("paint and clear are no-ops without the Custom Highlight API", () => {
    expect(() => paintCommentHighlight([document.createRange()])).not.toThrow();
    expect(() => clearCommentHighlight()).not.toThrow();
  });
});

describe("slotGap", () => {
  test("lines with no row after theirs in their block open after commentSlotIndex's block", () => {
    const text = "one\n\n\n\n---\n\ntwo\n";
    const { root, map } = mount(text);
    const { blocks } = renderPlanMarkdown(text);
    const unlaid = () => [];

    expect(slotGap(root, map, blocks, { start: 1, end: 1 }, unlaid)).toEqual({ block: 0 });
    expect(slotGap(root, map, blocks, { start: 3, end: 3 }, unlaid)).toEqual({ block: 0 });
    expect(slotGap(root, map, blocks, { start: 5, end: 5 }, unlaid)).toEqual({ block: 1 });
  });

  test("lines ending on one that renders no text open after the block their text ends in", () => {
    const text = "para one\n\n```ts\ncode\n```\n";
    const { root, map } = mount(text);
    const { blocks } = renderPlanMarkdown(text);

    expect(slotGap(root, map, blocks, { start: 1, end: 3 }, () => [])).toEqual({ block: 0 });
  });
});

describe("createSlotGaps", () => {
  const gapsIn = (root: Element) => [...root.querySelectorAll<HTMLElement>("[data-preview-gap]")];
  type Open = { at: SlotGap; height: number };
  const row = (line: number, column: number, height = 12): Open => ({
    at: { before: { line, column } },
    height,
  });
  const after = (block: number, height = 12): Open => ({ at: { block }, height });

  test("opens a gap of its height before the next row's first character, splitting the text", () => {
    const { root, map } = mount("one two three\n");

    createSlotGaps(root).set(map, new Map([[1, row(1, 4)]]));

    const [gap] = gapsIn(root);
    expect(gap?.previousSibling?.textContent).toBe("one ");
    expect(gap?.nextSibling?.textContent).toBe("two three");
    expect(gap?.style.height).toBe("12px");
    expect(root.textContent).toBe(mount("one two three\n").root.textContent);
  });

  test("climbs out of the elements the next row opens, so a list item's gap opens between the items", () => {
    const { root, map } = mount("- one\n- two\n");

    createSlotGaps(root).set(map, new Map([[1, row(2, 0)]]));

    const [gap] = gapsIn(root);
    expect(gap?.parentElement?.tagName).toBe("UL");
    expect(gap?.nextElementSibling?.textContent).toBe("two");
  });

  /** The point at the start of the first text node holding `needle`. */
  function pointAt(root: Element, map: PlanSourceMap, needle: string) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
      if (node.textContent?.includes(needle)) return map.textPoint(node, 0);
    throw new Error(`no text holds ${needle}`);
  }

  test("keeps a code block's marker with its pre, opening before the marker", () => {
    const { root, map } = mount("1. Edit foo:\n   ```ts\n   const x = 1;\n   ```\n");
    const before = pointAt(root, map, "const x");
    if (before === null) throw new Error("the code line has no point");

    createSlotGaps(root).set(map, new Map([[1, { at: { before }, height: 12 }]]));

    expect(previewCodeBlocks(root).length).toBe(1);
    expect(gapsIn(root)[0]?.nextElementSibling?.hasAttribute("data-source-code")).toBe(true);
  });

  test("opens a table's gap between its rows, wherever in the next row its first line starts", () => {
    const { root, map } = mount("| a | b |\n| - | - |\n| p | q |\n| r | s |\n");
    const before = pointAt(root, map, "s");
    if (before === null) throw new Error("the cell has no point");

    createSlotGaps(root).set(map, new Map([[3, { at: { before }, height: 12 }]]));

    const [gap] = gapsIn(root);
    expect(gap?.parentElement?.tagName).toBe("TBODY");
    expect(gap?.nextElementSibling?.textContent).toContain("r");
  });

  test("opens a block's gap after all of its content", () => {
    const { root, map } = mount("one\n\ntwo\n");

    createSlotGaps(root).set(map, new Map([[1, after(0)]]));

    expect(root.children[0]?.lastElementChild?.hasAttribute("data-preview-gap")).toBe(true);
  });

  test("a set with the same points and heights writes nothing", () => {
    const { root, map } = mount(
      "one two three\n\n- a\n- b\n\n1. Edit:\n   ```ts\n   const x = 1;\n   ```\n\n| p | q |\n| - | - |\n| r | s |\n| t | u |\n",
    );
    const gaps = createSlotGaps(root);
    const code = pointAt(root, map, "const x");
    const cell = pointAt(root, map, "u");
    if (code === null || cell === null) throw new Error("a fixture line has no point");
    const listed = new Map<number, Open>([
      [1, row(1, 4)],
      [3, after(1, 20)],
      [4, row(4, 0)],
      [6, { at: { before: code }, height: 12 }],
      [13, { at: { before: cell }, height: 12 }],
    ]);
    gaps.set(map, listed);
    const writes = new MutationObserver(() => {});
    writes.observe(root, { subtree: true, childList: true, attributes: true, characterData: true });

    gaps.set(map, listed);

    expect(writes.takeRecords()).toEqual([]);
    writes.disconnect();
  });

  test("stacks gaps at one point in line order, whichever opened first", () => {
    const { root, map } = mount("one two three\n");
    const gaps = createSlotGaps(root);

    gaps.set(map, new Map([[5, row(1, 4)]]));
    gaps.set(
      map,
      new Map([
        [3, row(1, 4)],
        [5, row(1, 4)],
      ]),
    );

    expect(gapsIn(root).map((g) => g.dataset.previewGap)).toEqual(["3", "5"]);
    expect(gapsIn(root)[1]?.nextSibling?.textContent).toBe("two three");
  });

  test("moves a gap whose point changed, closes the unlisted, and closes all on release", () => {
    const { root, map } = mount("one two three\n\nfour\n");
    const gaps = createSlotGaps(root);
    gaps.set(
      map,
      new Map([
        [1, row(1, 4)],
        [3, after(1)],
      ]),
    );

    gaps.set(map, new Map([[1, row(1, 8)]]));
    const [moved, ...rest] = gapsIn(root);
    const afterMove = [moved?.nextSibling?.textContent, rest.length];
    gaps.release();

    expect(afterMove).toEqual(["three", 0]);
    expect(gapsIn(root)).toEqual([]);
  });

  test("reopens a gap its block's html replaced", () => {
    const { root, map } = mount("one two three\n");
    const gaps = createSlotGaps(root);
    gaps.set(map, new Map([[1, row(1, 4)]]));

    root.innerHTML = renderPlanMarkdown("one two three\n").html;
    const remapped = createPlanSourceMap(root);
    gaps.set(remapped, new Map([[1, row(1, 4)]]));

    expect(gapsIn(root).length).toBe(1);
  });

  test("boxes each slot at its gap's top, across the root and padded to its block, in scrolled content coords", () => {
    const { root, map } = mount("a\n\nb");
    const gaps = createSlotGaps(root);
    gaps.set(map, new Map([[3, after(1)]]));
    const [gap] = gapsIn(root);
    const block = root.children[1];
    const scroller = document.createElement("div");
    scroller.scrollTop = 50;
    // The gap's top is at 58 and its block spans x [100,300], in a root spanning x
    // [60,500]; the scroller's top-left is (8, 5).
    const read: RectReader = (el) => {
      if (el === scroller) return { top: 5, bottom: 1000, left: 8, right: 600 };
      if (el === root) return { top: 0, bottom: 1000, left: 60, right: 500 };
      if (el === gap) return { top: 58, bottom: 70, left: 100, right: 300 };
      if (el === block) return { top: 40, bottom: 70, left: 100, right: 300 };
      return { top: 0, bottom: 0, left: 0, right: 0 };
    };

    // top = 58 - (5 - 50) = 103 ; left = 60 - 8 = 52
    expect(gaps.boxes(scroller, read)).toEqual(
      new Map([[3, { top: 103, left: 52, width: 440, padStart: 40, padEnd: 200 }]]),
    );
  });
});
