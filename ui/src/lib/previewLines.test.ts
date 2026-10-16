import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import type { ThemedToken } from "shiki/core";

import { renderPlanMarkdown } from "$lib/planMarkdown.ts";
import { createPlanSourceMap, type PlanSourceMap } from "$lib/planSourceMap.ts";
import { highlightPreviewCode } from "$lib/previewCode.ts";
import {
  type Box,
  cursorBand,
  type ElementRect,
  lastVisualLine,
  pointForLine,
  type RangeRects,
  readingPoint,
  stepVisualLine,
  type TextPoint,
  visualLineBox,
} from "$lib/previewLines.ts";

const ROW = 10;

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

interface Grid {
  read: RangeRects;
  /** The root child index of every range handed to `read`, in order. */
  blocksRead: number[];
  /** Each block's rect; only its bottom edge is laid out. */
  rect: ElementRect;
}

/** Lays each block's text out as a monospace grid `width` characters wide, one `ROW`
 * high per row, blocks stacked. Code wraps at its newlines, which have no rect;
 * structural whitespace between tags and whitespace after whitespace in prose render
 * nothing, as in a browser. */
function grid(root: Element, width: number): Grid {
  const cells = new Map<Text, ({ row: number; col: number } | null)[]>();
  const bottoms = new Map<Element, number>();
  let top = 0;
  for (const block of root.children) {
    let row = 0;
    let col = 0;
    let space = false;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node as Text;
      const code = text.parentElement?.closest("pre") !== null;
      if (!code && text.data.trim() === "") {
        cells.set(
          text,
          [...text.data].map(() => null),
        );
        continue;
      }
      cells.set(
        text,
        [...text.data].map((ch) => {
          if (code && ch === "\n") {
            row++;
            col = 0;
            return null;
          }
          const collapsed = !code && space && /\s/.test(ch);
          space = /\s/.test(ch);
          if (collapsed) return null;
          if (col === width) {
            row++;
            col = 0;
          }
          return { row: top + row, col: col++ };
        }),
      );
    }
    top += row + (col > 0 ? 1 : 0);
    bottoms.set(block, top * ROW);
  }
  const blocksRead: number[] = [];
  const read: RangeRects = (range) => {
    const node = range.startContainer as Text;
    blocksRead.push([...root.children].findIndex((b) => b.contains(node)));
    const rows = new Map<number, Box>();
    for (const cell of (cells.get(node) ?? []).slice(range.startOffset, range.endOffset)) {
      if (cell === null) continue;
      const box = rows.get(cell.row);
      const left = cell.col;
      if (box === undefined) {
        rows.set(cell.row, {
          top: cell.row * ROW,
          bottom: (cell.row + 1) * ROW,
          left,
          right: left + 1,
        });
      } else box.right = left + 1;
    }
    return [...rows.values()];
  };
  const rect: ElementRect = (el) => ({ top: 0, bottom: bottoms.get(el) ?? 0, left: 0, right: 0 });
  return { read, blocksRead, rect };
}

/** The point at the start of the first occurrence of `needle`. */
function at(root: Element, map: PlanSourceMap, needle: string): TextPoint {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const index = (node as Text).data.indexOf(needle);
    if (index === -1) continue;
    const line = map.lineAt(node, index) as number;
    const range = map.rangeOf(line) as Range;
    range.setEnd(node, index);
    return { line, column: range.toString().length };
  }
  throw new Error(`no text holds ${JSON.stringify(needle)}`);
}

/** The text a point's line renders from the point on. */
function textFrom(map: PlanSourceMap, p: TextPoint): string {
  return (map.rangeOf(p.line)?.toString() ?? "").slice(p.column);
}

function walk(root: Element, map: PlanSourceMap, from: TextPoint, read: RangeRects, count = 1) {
  const points: TextPoint[] = [];
  let p = from;
  for (;;) {
    const next = stepVisualLine(root, map, p, count, read);
    if (next.line === p.line && next.column === p.column) return points;
    points.push(next);
    p = next;
  }
}

const LONG = "abcdefghij".repeat(5); // 50 characters

describe("stepVisualLine", () => {
  test("steps a wrapped paragraph one visual line per call, fewer lines at a wider width", () => {
    const { root, map } = mount(`${LONG}\n`);
    const narrow = walk(root, map, { line: 1, column: 0 }, grid(root, 20).read);
    expect(narrow).toEqual([
      { line: 1, column: 20 },
      { line: 1, column: 40 },
    ]);
    const wide = walk(root, map, { line: 1, column: 0 }, grid(root, 30).read);
    expect(wide).toEqual([{ line: 1, column: 30 }]);
  });

  test("crosses into the next and previous block, skipping blocks with no text", () => {
    const { root, map } = mount("one\n\n![a](https://x.test/a.png)\n\n---\n\ntwo\n");
    const { read } = grid(root, 20);
    const down = stepVisualLine(root, map, { line: 1, column: 0 }, 1, read);
    expect(down).toEqual({ line: 7, column: 0 });
    expect(stepVisualLine(root, map, down, -1, read)).toEqual({ line: 1, column: 0 });
  });

  test("stops at the first and last visual line", () => {
    const { root, map } = mount(`${LONG}\n\ntail\n`);
    const { read } = grid(root, 20);
    expect(stepVisualLine(root, map, { line: 1, column: 0 }, -1, read)).toEqual({
      line: 1,
      column: 0,
    });
    expect(stepVisualLine(root, map, { line: 3, column: 0 }, 1, read)).toEqual({
      line: 3,
      column: 0,
    });
    expect(stepVisualLine(root, map, { line: 1, column: 0 }, 99, read)).toEqual({
      line: 3,
      column: 0,
    });
  });

  test("a count above one walks several lines across blocks", () => {
    const { root, map } = mount(`${LONG}\n\n${LONG}\n`);
    const { read } = grid(root, 20);
    expect(stepVisualLine(root, map, { line: 1, column: 20 }, 3, read)).toEqual({
      line: 3,
      column: 20,
    });
    expect(stepVisualLine(root, map, { line: 3, column: 20 }, -3, read)).toEqual({
      line: 1,
      column: 20,
    });
  });

  test("a point mid-line steps to the next line's start", () => {
    const { root, map } = mount(`${LONG}\n`);
    const { read } = grid(root, 20);
    expect(stepVisualLine(root, map, { line: 1, column: 7 }, 1, read)).toEqual({
      line: 1,
      column: 20,
    });
    expect(stepVisualLine(root, map, { line: 1, column: 27 }, -1, read)).toEqual({
      line: 1,
      column: 0,
    });
  });

  test("in a hard-wrapped paragraph each step lands on the source line of its first character", () => {
    const { root, map } = mount("aaaaaaaaaa bbbbbbbbbb\ncccccccccc dddddddddd\n");
    const points = walk(root, map, { line: 1, column: 0 }, grid(root, 15).read);
    expect(points.map((p) => [p.line, textFrom(map, p).slice(0, 4)])).toEqual([
      [1, "bbbb"],
      [2, "cc d"],
    ]);
  });

  test("a highlighted code block steps one code line at a time", async () => {
    const { root, map } = mount("```ts\nconst a = 1;\nlet b = 2;\nc();\n```\n");
    await highlightPreviewCode(root, new Map([[2, "ts"]]), {
      tokenize: async (code) =>
        code.split("\n").map((line) => {
          const [head = "", ...rest] = line.split(" ");
          return [
            { content: head, offset: 0, color: "#f00" },
            { content: rest.length > 0 ? ` ${rest.join(" ")}` : "", offset: 0, color: "#0f0" },
          ] as ThemedToken[];
        }),
      nextTask: async () => {},
      signal: new AbortController().signal,
    });
    expect(root.querySelector("code span")).not.toBe(null);
    const points = walk(root, map, { line: 2, column: 0 }, grid(root, 80).read);
    expect(points).toEqual([
      { line: 3, column: 0 },
      { line: 4, column: 0 },
    ]);
  });

  test("a plain code block steps onto each code line's own source line", () => {
    const { root, map } = mount("```\nconst a = 1;\nlet b = 2;\nc();\n```\n");
    const points = walk(root, map, { line: 2, column: 0 }, grid(root, 80).read);
    expect(points).toEqual([
      { line: 3, column: 0 },
      { line: 4, column: 0 },
    ]);
  });

  test("collapsed whitespace on an earlier row does not pull a step back", () => {
    const { root, map } = mount(`aaaa  ${"b".repeat(17)}\n`);
    const points = walk(root, map, { line: 1, column: 0 }, grid(root, 10).read);
    expect(points).toEqual([
      { line: 1, column: 11 },
      { line: 1, column: 21 },
    ]);
  });

  test("a paragraph set tighter than its glyph rects still steps every wrapped line", () => {
    const { root, map } = mount(`${LONG}\n`);
    // 13px glyph rects at a 12px pitch: each line's rect overlaps the next one's.
    const read: RangeRects = (range) => {
      const rows = new Set<number>();
      for (let k = range.startOffset; k < range.endOffset; k++) rows.add(Math.floor(k / 20));
      return [...rows].map((r) => ({ top: r * 12, bottom: r * 12 + 13, left: 0, right: 1 }));
    };
    expect(walk(root, map, { line: 1, column: 0 }, read)).toEqual([
      { line: 1, column: 20 },
      { line: 1, column: 40 },
    ]);
  });

  test("a table row with middle-aligned cells steps once per line of its tallest cell", () => {
    const { root, map } = mount("| a | b |\n|---|---|\n| two | note |\n| xx | yyy |\n");
    // Glyph rects are shorter than the line pitch, leaving a gap between lines.
    const box = (top: number): Box => ({ top, bottom: top + 8, left: 0, right: 1 });
    // "two" sits a half line down beside the two-line "note"; the two-line "xx" sits a
    // half line down beside the three-line "yyy". Each cell's characters split evenly
    // across its lines.
    const lines = new Map<string, Box[]>([
      ["a", [box(0)]],
      ["b", [box(0)]],
      ["two", [box(15)]],
      ["note", [box(10), box(20)]],
      ["xx", [box(35), box(45)]],
      ["yyy", [box(30), box(40), box(50)]],
    ]);
    const read: RangeRects = (range) => {
      const node = range.startContainer as Text;
      const boxes = lines.get(node.data) ?? [];
      const of = (k: number) => Math.floor((k * boxes.length) / node.data.length);
      return boxes.slice(of(range.startOffset), of(range.endOffset - 1) + 1);
    };
    const points = [{ line: 1, column: 0 }, ...walk(root, map, { line: 1, column: 0 }, read)];
    const tops = points.map((p) => visualLineBox(root, map, p, read)?.top);
    expect(tops).toEqual([0, 10, 20, 30, 40, 50]);
    const bottoms = points.map((p) => visualLineBox(root, map, p, read)?.bottom);
    expect(bottoms).toEqual([8, 18, 28, 38, 48, 58]);
  });

  test("a one-line step reads layout only in the blocks it crosses", () => {
    const blocks = Array.from({ length: 300 }, (_, i) => `para ${i}`);
    const { root, map } = mount(`${blocks.join("\n\n")}\n`);
    const g = grid(root, 20);
    const from = at(root, map, "para 150");
    g.blocksRead.length = 0;
    expect(stepVisualLine(root, map, from, 1, g.read)).toEqual(at(root, map, "para 151"));
    expect([...new Set(g.blocksRead)].sort((a, b) => a - b)).toEqual([150, 151]);
  });
});

describe("visualLineBox", () => {
  test("measures the DOMRects a browser hands back", () => {
    const { root, map } = mount(`${LONG}\n`);
    const gridRects = grid(root, 20).read;
    const read: RangeRects = (range) =>
      gridRects(range).map((b) => new DOMRect(b.left, b.top, b.right - b.left, b.bottom - b.top));
    expect(visualLineBox(root, map, { line: 1, column: 25 }, read)).toMatchObject({
      top: 10,
      bottom: 20,
    });
  });

  test("after a reflow, boxes the row now holding the point's character", () => {
    const { root, map } = mount(`${LONG}\n`);
    const p = { line: 1, column: 25 };
    expect(visualLineBox(root, map, p, grid(root, 20).read)).toMatchObject({ top: 10, bottom: 20 });
    expect(visualLineBox(root, map, p, grid(root, 10).read)).toMatchObject({ top: 20, bottom: 30 });
  });
});

describe("cursorBand", () => {
  test("spans the root in the scroller's content coordinates, padded to the line-height", () => {
    const { root, map } = mount(`${LONG}\n`);
    const scroller = document.createElement("div");
    scroller.scrollTop = 40;
    const rect: ElementRect = (el) =>
      el === scroller
        ? { top: 100, bottom: 1100, left: 5, right: 505 }
        : { top: 50, bottom: 1050, left: 25, right: 325 };
    const read = grid(root, 20).read;
    expect(cursorBand(root, scroller, map, { line: 1, column: 25 }, 16, read, rect)).toEqual({
      top: 10 - 3 - 60,
      left: 20,
      width: 300,
      height: 16,
    });
    expect(cursorBand(root, scroller, map, { line: 1, column: 25 }, 0, read, rect)?.height).toBe(
      10,
    );
  });

  test("is null for a point the preview does not render", () => {
    const { root, map } = mount("");
    expect(cursorBand(root, root, map, { line: 1, column: 0 }, 16)).toBe(null);
  });
});

describe("pointForLine", () => {
  const PLAN = "# Head\n\npara\n\n";

  test("a line with text maps to its start", () => {
    const { map } = mount(PLAN);
    expect(pointForLine(map, 1, 4)).toEqual({ line: 1, column: 0 });
  });

  test("a blank line maps to the next line with text", () => {
    const { map } = mount(PLAN);
    expect(pointForLine(map, 2, 4)).toEqual({ line: 3, column: 0 });
  });

  test("a trailing blank maps to the last line with text", () => {
    const { map } = mount(PLAN);
    expect(pointForLine(map, 4, 4)).toEqual({ line: 3, column: 0 });
  });

  test("an empty preview has no point", () => {
    const { map } = mount("");
    expect(pointForLine(map, 1, 1)).toBe(null);
  });
});

describe("lastVisualLine", () => {
  test("is the last line of the last block with text", () => {
    const { root, map } = mount(`one\n\n${LONG}\n\n---\n`);
    expect(lastVisualLine(root, map, grid(root, 20).read)).toEqual({ line: 3, column: 40 });
  });
});

describe("readingPoint", () => {
  test("is the first visual line whose bottom clears the reading zone", () => {
    const { root, map } = mount(`${LONG}\n\n${LONG}\n`);
    const g = grid(root, 20);
    // Rows sit at 0, 10, 20 (block 0) and 30, 40, 50 (block 1); the zone is 13 below the top.
    expect(readingPoint(root, map, 25, g.read, g.rect)).toEqual({ line: 3, column: 0 });
    expect(readingPoint(root, map, 10, g.read, g.rect)).toEqual({ line: 1, column: 40 });
  });

  test("passes over a block whose padding, not its text, reaches the reading zone", () => {
    const { root, map } = mount(`${LONG}\n\n${LONG}\n`);
    const g = grid(root, 20);
    const padded: ElementRect = (el) =>
      el === root.firstElementChild ? { ...g.rect(el), bottom: 300 } : g.rect(el);
    expect(readingPoint(root, map, 25, g.read, padded)).toEqual({ line: 3, column: 0 });
  });
});
