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
  slotGap,
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
