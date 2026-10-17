import "@ui/support/setup.ts";
import { afterEach, describe, expect, test } from "bun:test";

import { renderPlanMarkdown } from "$lib/planMarkdown.ts";
import { createPlanSourceMap, type PlanSourceMap } from "$lib/planSourceMap.ts";

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

/** The first text node holding `needle` and the offset where it starts. */
function find(root: Node, needle: string): [Text, number] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const index = node.textContent?.indexOf(needle) ?? -1;
    if (index !== -1) return [node as Text, index];
  }
  throw new Error(`no text node holds ${JSON.stringify(needle)}`);
}

function lineOf(map: PlanSourceMap, root: Node, needle: string): number | null {
  return map.lineAt(...find(root, needle));
}

function rangeBetween(start: [Node, number], end: [Node, number]): Range {
  const range = document.createRange();
  range.setStart(...start);
  range.setEnd(...end);
  return range;
}

describe("lineAt", () => {
  test("each half of a bold run that straddles a break maps to its own line", () => {
    const { root, map } = mount("a **bold\nrun** b\n");
    expect(lineOf(map, root, "bold")).toBe(1);
    expect(lineOf(map, root, "run")).toBe(2);
  });

  test("each half of a link label that straddles a break maps to its own line", () => {
    const { root, map } = mount("see [the\nlabel](https://x.test) here\n");
    expect(lineOf(map, root, "the")).toBe(1);
    expect(lineOf(map, root, "label")).toBe(2);
    expect(lineOf(map, root, " here")).toBe(2);
  });

  test("a soft break's newline belongs to the line it ends", () => {
    const { root, map } = mount("one\ntwo\n");
    expect(lineOf(map, root, "\n")).toBe(1);
    expect(lineOf(map, root, "two")).toBe(2);
  });

  test("entities and backslash escapes keep the line's text in place", () => {
    const { root, map } = mount("x\na &amp; b\nc\na \\*not em\\* b\n");
    expect(lineOf(map, root, "& b")).toBe(2);
    expect(lineOf(map, root, "not em")).toBe(4);
  });

  test("autolinks and bare URLs map to their line", () => {
    const { root, map } = mount("x\n<https://a.test>\ny https://b.test\n");
    expect(lineOf(map, root, "a.test")).toBe(2);
    expect(lineOf(map, root, "b.test")).toBe(3);
  });

  test("a reference link's label maps to its line", () => {
    const { root, map } = mount("[def]: https://x.test\n\nsee\n[the ref][def]\n");
    expect(lineOf(map, root, "the ref")).toBe(4);
  });

  test("each line of a fenced code block maps to its own line", () => {
    const { root, map } = mount("```ts\nconst a = 1;\nconst b = 2;\n```\n");
    expect(lineOf(map, root, "const a")).toBe(2);
    expect(lineOf(map, root, "const b")).toBe(3);
  });

  test("table cells map to their row's line", () => {
    const { root, map } = mount("| h1 | h2 |\n| -- | -- |\n| a1 | a2 |\n| b1 | b2 |\n");
    expect(lineOf(map, root, "h2")).toBe(1);
    expect(lineOf(map, root, "a2")).toBe(3);
    expect(lineOf(map, root, "b1")).toBe(4);
  });

  test("an element-child offset maps to the character after it", () => {
    const { root, map } = mount("intro\n\n- first\n- second\n");
    const second = root.querySelectorAll("li")[1];
    if (second === undefined) throw new Error("no second item");
    expect(map.lineAt(second, 0)).toBe(4);
  });

  test("a point outside the root has no line", () => {
    const { map } = mount("text\n");
    expect(map.lineAt(document.body, 0)).toBe(null);
  });

  test("each level of a tight nested list maps to its line", () => {
    const { root, map } = mount("- outer\n  - inner\n    - deepest\n- back\n");
    expect(lineOf(map, root, "inner")).toBe(2);
    expect(lineOf(map, root, "deepest")).toBe(3);
    expect(lineOf(map, root, "back")).toBe(4);
  });

  test("each level of a loose nested list maps to its line", () => {
    const { root, map } = mount("- outer\n\n  - inner\n\n  - sibling\n\n- back\n");
    expect(lineOf(map, root, "inner")).toBe(3);
    expect(lineOf(map, root, "sibling")).toBe(5);
    expect(lineOf(map, root, "back")).toBe(7);
  });

  test("a loose list with two blank lines between items maps each item", () => {
    const { root, map } = mount("- one\n\n\n- two\n");
    expect(lineOf(map, root, "two")).toBe(4);
  });

  test("task items map to their line", () => {
    const { root, map } = mount("- [ ] open\n- [/] doing\n");
    expect(lineOf(map, root, "open")).toBe(1);
    expect(lineOf(map, root, "doing")).toBe(2);
  });

  test("each line of an indented code block maps to its own line", () => {
    const { root, map } = mount("para\n\n    let a;\n    let b;\n");
    expect(lineOf(map, root, "let a")).toBe(3);
    expect(lineOf(map, root, "let b")).toBe(4);
  });

  test("an empty preview has no lines", () => {
    const { root, map } = mount("");
    expect(map.lineAt(root, 0)).toBe(null);
  });
});

describe("linesOf", () => {
  test("a range inside one line reports that line", () => {
    const { root, map } = mount("one\ntwo three\n");
    const [node, at] = find(root, "two");
    expect(map.linesOf(rangeBetween([node, at], [node, at + 3]))).toEqual({ start: 2, end: 2 });
  });

  test("a range from a paragraph into the next block's middle spans both", () => {
    const { root, map } = mount("para\n\n- a\n- b\n- c\n");
    const [b, at] = find(root, "b");
    expect(map.linesOf(rangeBetween(find(root, "para"), [b, at + 1]))).toEqual({
      start: 1,
      end: 4,
    });
  });

  test("a range from a table cell into a later row spans the rows", () => {
    const { root, map } = mount("| h1 | h2 |\n| -- | -- |\n| a1 | a2 |\n| b1 | b2 |\n");
    const [b1, at] = find(root, "b1");
    expect(map.linesOf(rangeBetween(find(root, "a2"), [b1, at + 1]))).toEqual({
      start: 3,
      end: 4,
    });
  });

  test("a range starting at a row boundary reports that row's line", () => {
    const { root, map } = mount("| h1 | h2 |\n| -- | -- |\n| a1 | a2 |\n| b1 | b2 |\n");
    const row = root.querySelectorAll("tbody tr")[1];
    if (row === undefined) throw new Error("no second row");
    const [b2, at] = find(root, "b2");
    expect(map.linesOf(rangeBetween([row, 0], [b2, at + 2]))).toEqual({ start: 4, end: 4 });
  });

  test("a range ending at the start of the next block reports the previous block's last line", () => {
    const { root, map } = mount("one\ntwo\n\nthree\n");
    const blocks = root.children;
    const first = blocks[0];
    const next = blocks[1];
    if (first === undefined || next === undefined) throw new Error("missing block");
    expect(map.linesOf(rangeBetween([first, 0], [next, 0]))).toEqual({ start: 1, end: 2 });
  });

  test("a range covering only a soft break reports the line it ends", () => {
    const { root, map } = mount("one\ntwo\n");
    const [node, at] = find(root, "\n");
    expect(map.linesOf(rangeBetween([node, at], [node, at + 1]))).toEqual({ start: 1, end: 1 });
  });

  test("a range starting or ending outside the root has no lines", () => {
    const { root, map } = mount("one\n");
    const inside = find(root, "one");
    expect(map.linesOf(rangeBetween([document.body, 0], inside)) === null).toBe(true);
    const outside = document.createElement("p");
    outside.textContent = "x";
    document.body.append(outside);
    mounted.push(outside);
    expect(map.linesOf(rangeBetween(inside, [outside, 1])) === null).toBe(true);
  });

  test("a collapsed range reports its point's line", () => {
    const { root, map } = mount("one\ntwo\n");
    const [node, at] = find(root, "two");
    expect(map.linesOf(rangeBetween([node, at], [node, at]))).toEqual({ start: 2, end: 2 });
  });
});

describe("rangeOf", () => {
  const MIXED = [
    "# Title", // 1
    "", // 2
    "A paragraph that", // 3
    "wraps **here and", // 4
    "there**.", // 5
    "", // 6
    "- item one", // 7
    "- item two", // 8
    "  continues", // 9
    "", // 10
    "> quoted", // 11
    "> more", // 12
    "", // 13
    "| h1 | h2 |", // 14
    "| -- | -- |", // 15
    "| c1 | c2 |", // 16
    "", // 17
    "```js", // 18
    "let x = 1;", // 19
    "let y = 2;", // 20
    "```", // 21
    "", // 22
    "```", // 23
    "```", // 24
    "", // 25
    "[d]: https://x.test", // 26
  ].join("\n");
  const TEXT: Record<number, string> = {
    1: "Title",
    3: "A paragraph that",
    4: "wraps here and",
    5: "there.",
    7: "item one",
    8: "item two",
    9: "continues",
    11: "quoted",
    12: "more",
    14: "h1",
    16: "c2",
    19: "let x = 1;",
    20: "let y = 2;",
  };

  test("each rendered line's range holds its text and maps back to it", () => {
    const { map } = mount(MIXED);
    for (const [key, text] of Object.entries(TEXT)) {
      const line = Number(key);
      const range = map.rangeOf(line);
      if (range === null) throw new Error(`line ${line} has no range`);
      expect(range.toString()).toContain(text);
      expect(map.linesOf(range)).toEqual({ start: line, end: line });
    }
  });

  test("lines that render no text have no range", () => {
    const { map } = mount(MIXED);
    for (const line of [2, 6, 15, 18, 21, 23, 24, 26, 99]) {
      expect(map.rangeOf(line) === null).toBe(true);
    }
  });

  test("a range for a line that opens a block starts inside that block", () => {
    const { root, map } = mount("para one\n\nsecond\n");
    const start = map.rangeOf(3)?.startContainer.parentElement;
    expect(start?.closest("[data-source-start]") === root.children[1]).toBe(true);
  });
});

describe("offset accessors", () => {
  const PLAN = [
    "A paragraph that", // 1
    "wraps here.", // 2
    "", // 3
    "- item one", // 4
    "- item two", // 5
    "", // 6
    "| h1 | h2 |", // 7
    "| -- | -- |", // 8
    "| c1 | c2 |", // 9
    "", // 10
    "```js", // 11
    "let x = 1;", // 12
    "let y = 2;", // 13
    "```", // 14
  ].join("\n");

  test("lineAtOffset agrees with lineAt at every character", () => {
    const { root, map } = mount(PLAN);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let offset = 0;
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node as Text;
      for (let i = 0; i < text.data.length; i++, offset++) {
        expect(map.lineAtOffset(offset)).toBe(map.lineAt(text, i));
      }
    }
    expect(offset > 0).toBe(true);
  });

  test("offsetOfLine is where rangeOf's text starts, and null where it has none", () => {
    const { root, map } = mount(PLAN);
    for (let line = 1; line <= 16; line++) {
      const range = map.rangeOf(line);
      if (range === null) {
        expect(map.offsetOfLine(line)).toBe(null);
        continue;
      }
      const before = document.createRange();
      before.setStart(root, 0);
      before.setEnd(range.startContainer, range.startOffset);
      expect(map.offsetOfLine(line)).toBe(before.toString().length);
    }
  });
});

describe("comments", () => {
  test("a comment under the root moves no line or range", () => {
    const { root } = mount("one\n\ntwo\n");
    root.prepend(document.createComment("a long comment"));
    const map = createPlanSourceMap(root);
    expect(lineOf(map, root, "two")).toBe(3);
    expect(map.rangeOf(3)?.toString()).toBe("two\n");
  });
});

describe("raw HTML", () => {
  test("a raw-HTML pre maps to its first line and the next block still maps", () => {
    const { root, map } = mount("<pre>a&#10;&#10;b</pre>\n\nafter\n");
    expect(lineOf(map, root, "b")).toBe(1);
    expect(lineOf(map, root, "after")).toBe(3);
    expect(map.rangeOf(3)?.toString()).toContain("after");
    expect(map.rangeOf(2) === null).toBe(true);
  });
});

describe("highlighted code", () => {
  const CODE = "intro\n\n```js\nlet x = 1;\nlet y = 2;\n```\n\nafter\n";

  function highlight(root: Element): void {
    const code = root.querySelector("pre > code");
    if (code === null) throw new Error("no code block");
    const lines = (code.textContent ?? "").split(/(?<=\n)/);
    code.replaceChildren(
      ...lines.map((text) => {
        const span = document.createElement("span");
        span.textContent = text;
        return span;
      }),
    );
  }

  function expectCodeLines(root: Element, map: PlanSourceMap): void {
    expect(lineOf(map, root, "let x")).toBe(4);
    expect(lineOf(map, root, "let y")).toBe(5);
    expect(map.rangeOf(4)?.toString()).toContain("let x = 1;");
    expect(map.rangeOf(5)?.toString()).toContain("let y = 2;");
    expect(lineOf(map, root, "after")).toBe(8);
  }

  test("a map built before highlighting still answers", () => {
    const { root, map } = mount(CODE);
    highlight(root);
    expectCodeLines(root, map);
  });

  test("a map built after highlighting answers the same", () => {
    const { root } = mount(CODE);
    highlight(root);
    expectCodeLines(root, createPlanSourceMap(root));
  });
});
