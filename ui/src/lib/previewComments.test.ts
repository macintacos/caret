import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { selectText } from "@ui/support/selection.ts";
import type { RectReader } from "$lib/geometry.ts";
import { renderPlanMarkdown } from "$lib/planMarkdown.ts";
import { createPlanSourceMap, type PlanSourceMap } from "$lib/planSourceMap.ts";
import {
  clearCommentHighlight,
  commentSlotIndex,
  createSlotReserve,
  groupBySlot,
  isCommentClick,
  isCommentDrag,
  paintCommentHighlight,
  previewSlotBoxes,
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

const textIn = (el: Element): Node =>
  document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode() as Node;

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
  const blocks = [
    { start: 1, end: 2 },
    { start: 4, end: 6 },
  ];

  test("groups by block ascending, by line within a block, input order on a line", () => {
    const items = [
      { line: 6, id: "c" },
      { line: 1, id: "a" },
      { line: 5, id: "b1" },
      { line: 5, id: "b2" },
    ];
    expect(groupBySlot(blocks, items)).toEqual([
      { block: 0, items: [{ line: 1, id: "a" }] },
      {
        block: 1,
        items: [
          { line: 5, id: "b1" },
          { line: 5, id: "b2" },
          { line: 6, id: "c" },
        ],
      },
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

describe("createSlotReserve", () => {
  test("pads listed blocks and releases the rest", () => {
    const { root } = mount("a\n\nb");
    const [first, second] = [...root.children] as HTMLElement[];
    const reserve = createSlotReserve(root);
    reserve.set(new Map([[1, 40]]));
    expect(second?.style.paddingBlockEnd).toBe("40px");
    expect(first?.style.paddingBlockEnd).toBe("");
    reserve.set(new Map([[0, 10]]));
    expect(second?.style.paddingBlockEnd).toBe("");
    expect(first?.style.paddingBlockEnd).toBe("10px");
    reserve.release();
    expect(first?.style.paddingBlockEnd).toBe("");
  });
});

describe("previewSlotBoxes", () => {
  test("puts a slot at its block's bottom less the reserve, across the root and padded to its block, in scrolled content coords", () => {
    const { root } = mount("a\n\nb");
    const blocks = [...root.children];
    const scroller = document.createElement("div");
    scroller.scrollTop = 50;
    // Block i spans y [10+40i, 30+40i], x [100,300], in a root spanning x [60,500]; the
    // scroller's top-left is (8, 5).
    const read: RectReader = (el) => {
      if (el === scroller) return { top: 5, bottom: 1000, left: 8, right: 600 };
      if (el === root) return { top: 0, bottom: 1000, left: 60, right: 500 };
      const i = blocks.indexOf(el);
      return { top: 10 + i * 40, bottom: 30 + i * 40, left: 100, right: 300 };
    };
    // top = 70 - 12 - (5 - 50) = 103 ; left = 60 - 8 = 52
    expect(previewSlotBoxes(root, scroller, new Map([[1, 12]]), read)).toEqual(
      new Map([[1, { top: 103, left: 52, width: 440, padStart: 40, padEnd: 200 }]]),
    );
  });
});

describe("isCommentClick", () => {
  afterEach(() => document.getSelection()?.removeAllRanges());

  test("is a click on text that leaves the selection collapsed in the root", () => {
    const { root } = mount("Plain words.");
    const text = textIn(root);
    selectText([text, 3]);

    expect(isCommentClick(root, text.parentElement, document.getSelection())).toBe(true);
  });

  test("is not a click on a control, nor one leaving a spread or an outside selection", () => {
    const { root } = mount("A [link](https://x.test) here.");
    const link = root.querySelector("a") as Element;
    const outside = document.createElement("div");
    outside.textContent = "out";
    root.after(outside);
    mounted.push(outside);

    selectText([link.firstChild as Node, 1]);
    const onLink = isCommentClick(root, link, document.getSelection());
    selectText([textIn(root), 0], [link.firstChild as Node, 1]);
    const spread = isCommentClick(root, root.querySelector("p"), document.getSelection());
    selectText([outside.firstChild as Node, 1]);
    const away = isCommentClick(root, root.querySelector("p"), document.getSelection());

    expect([onLink, spread, away]).toEqual([false, false, false]);
  });
});

describe("isCommentDrag", () => {
  afterEach(() => document.getSelection()?.removeAllRanges());

  test("is a release leaving a new selection anchored in the root, wherever it ends", () => {
    const { root } = mount("one\n\ntwo");
    const slot = document.createElement("div");
    slot.textContent = "slot";
    root.after(slot);
    mounted.push(slot);
    const text = textIn(root);

    selectText([text, 0], [text, 2]);
    const inside = isCommentDrag(root, null, document.getSelection());
    selectText([text, 0], [slot.firstChild as Node, 2]);
    const overSlot = isCommentDrag(root, null, document.getSelection());

    expect([inside, overSlot]).toEqual([true, true]);
  });

  test("is not a collapsed, unchanged or outside-anchored selection", () => {
    const { root } = mount("Plain words.");
    const text = textIn(root);
    const outside = document.createElement("div");
    outside.textContent = "outside";
    root.after(outside);
    mounted.push(outside);

    selectText([text, 2]);
    const collapsed = isCommentDrag(root, null, document.getSelection());
    const standing = selectText([text, 0], [text, 5]).cloneRange();
    const unchanged = isCommentDrag(root, standing, document.getSelection());
    selectText([outside.firstChild as Node, 0], [outside.firstChild as Node, 3]);
    const away = isCommentDrag(root, null, document.getSelection());

    expect([collapsed, unchanged, away]).toEqual([false, false, false]);
  });
});
