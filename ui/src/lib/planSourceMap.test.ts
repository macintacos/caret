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

  test("a map built before highlighting hands back connected ranges with the same text", () => {
    const { root, map } = mount(CODE);
    const before = [4, 5].map((line) => map.rangeOf(line)?.toString());
    highlight(root);
    [4, 5].forEach((line, i) => {
      const range = map.rangeOf(line);
      if (range === null) throw new Error(`line ${line} has no range`);
      expect(range.startContainer.isConnected).toBe(true);
      expect(range.endContainer.isConnected).toBe(true);
      expect(range.toString()).toBe(before[i] ?? "");
    });
  });

  test("domPoint at a text-node boundary: before takes the earlier node, after the later", () => {
    const { root, map } = mount(CODE);
    highlight(root);
    const [x] = find(root, "let x");
    const [y] = find(root, "let y");
    const before = map.domPoint({ line: 5, column: 0 }, "before");
    const after = map.domPoint({ line: 5, column: 0 }, "after");
    expect(before !== null && before[0] === x && before[1] === x.data.length).toBe(true);
    expect(after !== null && after[0] === y && after[1] === 0).toBe(true);
  });
});

const LOOKUP_PLAN = [
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

describe("text points", () => {
  test("textPoint inverts clampedPoint at every column of every rendered line", () => {
    const { map } = mount(LOOKUP_PLAN);
    let checked = 0;
    for (let line = 1; line <= 14; line++) {
      const length = map.rangeOf(line)?.toString().length ?? 0;
      for (let column = 0; column < length; column++, checked++) {
        const point = map.clampedPoint({ line, column });
        if (point === null) throw new Error(`line ${line} column ${column} has no point`);
        expect(map.textPoint(...point)).toEqual({ line, column });
      }
    }
    expect(checked > 0).toBe(true);
  });

  test("clampedPoint clamps a column past the line to its last character", () => {
    const { map } = mount(LOOKUP_PLAN);
    const length = map.rangeOf(1)?.toString().length ?? 0;
    expect(map.clampedPoint({ line: 1, column: 999 })).toEqual(
      map.clampedPoint({ line: 1, column: length - 1 }),
    );
  });

  test("domPoint with a column past a soft-broken line's text lands in the next line", () => {
    const { map } = mount("one\ntwo\n");
    const point = map.domPoint({ line: 1, column: 5 }, "after");
    if (point === null) throw new Error("no point");
    expect(map.lineAt(...point)).toBe(2);
  });

  test("at the end of the preview's text only before resolves, to the last text node's end", () => {
    const { root, map } = mount(LOOKUP_PLAN);
    const column = map.rangeOf(13)?.toString().length ?? 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const texts: Text[] = [];
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
      texts.push(node as Text);
    const last = texts.at(-1);
    if (last === undefined) throw new Error("no text node");
    const point = map.domPoint({ line: 13, column }, "before");
    expect(point !== null && point[0] === last && point[1] === last.data.length).toBe(true);
    expect(map.domPoint({ line: 13, column }, "after") === null).toBe(true);
  });

  test("a line with no text has no DOM point", () => {
    const { map } = mount(LOOKUP_PLAN);
    expect(map.clampedPoint({ line: 3, column: 0 }) === null).toBe(true);
    expect(map.domPoint({ line: 3, column: 0 }, "after") === null).toBe(true);
  });

  test("an element point past the last block reads as the last line", () => {
    const { root, map } = mount(LOOKUP_PLAN);
    expect(map.lineAt(root, root.childNodes.length)).toBe(13);
  });

  test("a point in the structural text before the first line's text is at column 0", () => {
    const { root, map } = mount("| h1 | h2 |\n| -- | -- |\n| c1 | c2 |\n");
    const table = root.querySelector("table");
    if (!(table?.firstChild instanceof Text)) throw new Error("no text before the head");
    expect(map.textPoint(table.firstChild, 0)).toEqual({ line: 1, column: 0 });
  });
});

describe("lookups", () => {
  test("no lookup walks the preview from its root", () => {
    const { root, map } = mount(LOOKUP_PLAN);
    const points = ["paragraph", "wraps", "item two", "c2", "let y"].map((n) => find(root, n));
    const row = root.querySelector("tbody tr");
    if (row === null) throw new Error("no body row");
    const [two, at] = find(root, "two");
    const ranges = [
      rangeBetween(find(root, "wraps"), [two, at + 3]),
      rangeBetween([row, 0], find(root, "let x")),
    ];
    const walks: string[] = [];
    // A root walk is a TreeWalker (every one here starts at the root) or a Range from (root, 0);
    // happy-dom's Range.toString uses no TreeWalker, so setStart is what catches the latter.
    const setStart = Range.prototype.setStart;
    const createTreeWalker = Document.prototype.createTreeWalker;
    try {
      Document.prototype.createTreeWalker = function (
        this: Document,
        ...args: Parameters<Document["createTreeWalker"]>
      ) {
        walks.push("createTreeWalker");
        return createTreeWalker.apply(this, args);
      };
      Range.prototype.setStart = function (this: Range, node: Node, offset: number) {
        if (node === root) walks.push("setStart(root)");
        setStart.call(this, node, offset);
      };
      for (const point of points) map.lineAt(...point);
      map.lineAt(row, 0);
      for (const range of ranges) map.linesOf(range);
      for (let line = 1; line <= 14; line++) {
        map.rangeOf(line);
        map.offsetOfLine(line);
        map.lineAtOffset(line * 5);
        map.domPoint({ line, column: 2 }, "before");
        const point = map.clampedPoint({ line, column: 2 });
        if (point !== null) map.textPoint(...point);
      }
    } finally {
      Document.prototype.createTreeWalker = createTreeWalker;
      Range.prototype.setStart = setStart;
    }
    expect(walks).toEqual([]);
  });
});

describe("swapped text", () => {
  function wrapMiddle(root: Element): { first: Text; middle: Text; span: HTMLSpanElement } {
    const [first] = find(root, "A paragraph that");
    const middle = first.splitText(2);
    middle.splitText(9);
    const span = document.createElement("span");
    middle.replaceWith(span);
    span.append(middle);
    return { first, middle, span };
  }

  function expectLineOne(map: PlanSourceMap, text: string): void {
    const range = map.rangeOf(1);
    if (range === null) throw new Error("line 1 has no range");
    expect(range.toString()).toBe(text);
    expect(range.startContainer.isConnected).toBe(true);
    expect(range.endContainer.isConnected).toBe(true);
  }

  test("a wrapped reference keeps its line's range and lookups", () => {
    const { root, map } = mount(LOOKUP_PLAN);
    const text = map.rangeOf(1)?.toString() ?? "";
    const { middle } = wrapMiddle(root);
    expectLineOne(map, text);
    expect(map.lineAt(middle, 0)).toBe(1);
  });

  test("merging the split text back keeps the same answers", () => {
    const { root, map } = mount(LOOKUP_PLAN);
    const text = map.rangeOf(1)?.toString() ?? "";
    const { first, middle, span } = wrapMiddle(root);
    span.replaceWith(...span.childNodes);
    root.normalize();
    expect(first.data.startsWith("A paragraph that") && !middle.isConnected).toBe(true);
    expectLineOne(map, text);
    expect(lineOf(map, root, "paragraph")).toBe(1);
  });
});
