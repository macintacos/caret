import { describe, expect, test } from "bun:test";

import { buildInlineSpans, type InlineSpan } from "$lib/diffview/inlineSpans.ts";

// buildInlineSpans is the pure per-line pass: display text + the line's link
// ranges -> flat atomic runs (one per maximal stretch of identical attribute
// set) plus the line's blockquote depth. Columns are 0-based, half-open
// [startCol, endCol) into the DISPLAY line. Nothing is stripped or rewritten
// here — the markers are part of the runs they mark.

function runs(line: string, links: { start: number; end: number }[] = []): InlineSpan[] {
  return buildInlineSpans(line, links).spans;
}

function depth(line: string): number {
  return buildInlineSpans(line, []).quoteDepth;
}

describe("emphasis and code runs", () => {
  test("a bold element is one run covering its markers", () => {
    expect(runs("**bold**")).toEqual([{ startCol: 0, endCol: 8, bold: true }]);
  });

  test("an italic element is one run covering its markers", () => {
    expect(runs("*it*")).toEqual([{ startCol: 0, endCol: 4, italic: true }]);
  });

  test.each([
    ["underscore italic", "_it_", { italic: true as const }],
    ["underscore bold", "__b__", { bold: true as const }],
  ])("%s marks the same attribute as its asterisk spelling", (_name, line, attr) => {
    expect(runs(line)).toEqual([{ startCol: 0, endCol: line.length, ...attr }]);
  });

  test("an inline-code element is one run, backticks included", () => {
    expect(runs("`code`")).toEqual([{ startCol: 0, endCol: 6, code: true }]);
  });

  test("code inside bold resolves into three correctly-attributed runs", () => {
    // The ticket's worked example — flat runs, not nested wrappers. Its columns
    // are illustrative; these are the string's real ones.
    expect(runs("**a `b` c**")).toEqual([
      { startCol: 0, endCol: 4, bold: true },
      { startCol: 4, endCol: 7, bold: true, code: true },
      { startCol: 7, endCol: 11, bold: true },
    ]);
  });

  test("bold nested inside italic attributes both to the overlap", () => {
    expect(runs("***deep***")).toEqual([
      { startCol: 0, endCol: 1, italic: true },
      { startCol: 1, endCol: 9, bold: true, italic: true },
      { startCol: 9, endCol: 10, italic: true },
    ]);
  });

  test("bold inside italic mid-line keeps each element's own columns", () => {
    // a *b **c** d* e — italic [2,13), bold [5,10).
    expect(runs("a *b **c** d* e")).toEqual([
      { startCol: 2, endCol: 5, italic: true },
      { startCol: 5, endCol: 10, bold: true, italic: true },
      { startCol: 10, endCol: 13, italic: true },
    ]);
  });

  test("emphasis-looking text inside inline code is code and nothing else", () => {
    expect(runs("`a **b** c`")).toEqual([{ startCol: 0, endCol: 11, code: true }]);
  });

  test("escaped markers produce no emphasis", () => {
    expect(runs("a \\*b\\* c")).toEqual([]);
  });

  test("intraword underscores are not emphasis", () => {
    expect(runs("snake_case_word stays")).toEqual([]);
  });

  test("an unmatched marker produces no run", () => {
    expect(runs("unmatched **bold")).toEqual([]);
  });

  test("strikethrough carries no attribute of its own but its content is still walked", () => {
    // ~~ is a follow-up candidate in EXC-855, deliberately unattributed here —
    // the bold inside it must still land.
    expect(runs("~~gone **but bold**~~")).toEqual([{ startCol: 7, endCol: 19, bold: true }]);
  });

  test("two separate elements stay two runs", () => {
    expect(runs("**a** and *b*")).toEqual([
      { startCol: 0, endCol: 5, bold: true },
      { startCol: 10, endCol: 13, italic: true },
    ]);
  });

  test("prose with nothing to mark yields no runs", () => {
    expect(runs("just a plain sentence.")).toEqual([]);
  });
});

describe("link runs", () => {
  test("a link range becomes a link run", () => {
    expect(runs("See the docs now.", [{ start: 4, end: 12 }])).toEqual([
      { startCol: 4, endCol: 12, link: true },
    ]);
  });

  test("emphasis inside a collapsed label shares the link's columns", () => {
    // The label of [**bold**](https://x.test) collapses to `**bold**`, so the
    // link range and the bold element cover the same columns.
    expect(runs("**bold**", [{ start: 0, end: 8 }])).toEqual([
      { startCol: 0, endCol: 8, bold: true, link: true },
    ]);
  });

  test("a link partially overlapping emphasis splits into attributed runs", () => {
    expect(runs("**bold** tail", [{ start: 0, end: 13 }])).toEqual([
      { startCol: 0, endCol: 8, bold: true, link: true },
      { startCol: 8, endCol: 13, link: true },
    ]);
  });

  test("a zero-width link range yields no run", () => {
    expect(runs("nothing", [{ start: 3, end: 3 }])).toEqual([]);
  });
});

describe("task-list checkboxes", () => {
  test.each([
    ["a dash bullet", "- [ ] task", 2, "unchecked" as const],
    ["a checked item", "- [x] task", 2, "checked" as const],
    ["an uppercase X", "- [X] task", 2, "checked" as const],
    ["a star bullet", "* [ ] task", 2, "unchecked" as const],
    ["a plus bullet", "+ [x] task", 2, "checked" as const],
    ["an ordered item", "1. [ ] task", 3, "unchecked" as const],
    ["a paren-ordered item", "2) [x] task", 3, "checked" as const],
    ["a nested item", "    - [ ] task", 6, "unchecked" as const],
  ])("%s marks its bracket run", (_name, line, startCol, checkbox) => {
    expect(runs(line)).toEqual([{ startCol, endCol: startCol + 3, checkbox }]);
  });

  test.each([
    ["a bracketed word in prose", "see [note] for the rest"],
    ["a bracket run mid-sentence", "leave [ ] alone here"],
    ["a bracket with no list marker", "[ ] task"],
    ["a non-task bracket after a bullet", "- [note] not a task"],
  ])("%s is left alone", (_name, line) => {
    expect(runs(line).filter((s) => s.checkbox !== undefined)).toEqual([]);
  });

  test("a checkbox coexists with inline chips later on the line", () => {
    expect(runs("- [x] ship **now**")).toEqual([
      { startCol: 2, endCol: 5, checkbox: "checked" },
      { startCol: 11, endCol: 18, bold: true },
    ]);
  });
});

describe("blockquote depth and markers", () => {
  test("an unquoted line has depth zero and no marker runs", () => {
    expect(depth("plain prose")).toBe(0);
    expect(runs("plain prose")).toEqual([]);
  });

  test("a single quote level marks its own marker column", () => {
    expect(depth("> quoted")).toBe(1);
    expect(runs("> quoted")).toEqual([{ startCol: 0, endCol: 1, quoteMarker: 1 }]);
  });

  test.each([
    ["spaced markers", "> > deep", [0, 2]],
    ["tight markers", ">> deep", [0, 1]],
  ])("nesting reports depth 2 and one run per marker (%s)", (_name, line, cols) => {
    expect(depth(line)).toBe(2);
    expect(runs(line)).toEqual([
      { startCol: cols[0] as number, endCol: (cols[0] as number) + 1, quoteMarker: 1 },
      { startCol: cols[1] as number, endCol: (cols[1] as number) + 1, quoteMarker: 2 },
    ]);
  });

  test("an indented marker is still a quote", () => {
    expect(depth("   > quoted")).toBe(1);
    expect(runs("   > quoted")).toEqual([{ startCol: 3, endCol: 4, quoteMarker: 1 }]);
  });

  test("a bare `>` line is depth 1 with no content", () => {
    expect(depth(">")).toBe(1);
    expect(runs(">")).toEqual([{ startCol: 0, endCol: 1, quoteMarker: 1 }]);
  });

  test("a `>` past the fourth column is prose, not a quote", () => {
    expect(depth("    > indented code-ish")).toBe(0);
  });

  test("emphasis inside a quote keeps its own columns alongside the marker", () => {
    expect(runs("> a **b**")).toEqual([
      { startCol: 0, endCol: 1, quoteMarker: 1 },
      { startCol: 4, endCol: 9, bold: true },
    ]);
  });

  test("a quoted task item marks both the quote and the checkbox", () => {
    expect(runs("> - [ ] task")).toEqual([
      { startCol: 0, endCol: 1, quoteMarker: 1 },
      { startCol: 4, endCol: 7, checkbox: "unchecked" },
    ]);
  });
});

describe("run-set invariants", () => {
  const CORPUS = [
    "",
    "plain",
    "**a `b` c**",
    "***x*** and _y_ and __z__",
    "- [ ] a task with `code` and **bold**",
    "> > quoted **bold** with `code`",
    "a \\*b\\* escaped",
    "`**not bold**`",
    "~~del~~ *em* `c` **b**",
    "> - [x] done ***all***",
    "trailing spaces   ",
    "| a | **b** | `c` |",
    "unmatched ** and * and `",
    "    > deep indent",
    "1) [X] ordered task *em*",
  ];

  test("runs are sorted, disjoint, non-empty and inside the line", () => {
    for (const line of CORPUS) {
      const emitted = runs(line, [{ start: 0, end: Math.min(3, line.length) }]);
      let prevEnd = 0;
      for (const span of emitted) {
        expect(span.startCol).toBeGreaterThanOrEqual(prevEnd);
        expect(span.endCol).toBeGreaterThan(span.startCol);
        expect(span.endCol).toBeLessThanOrEqual(line.length);
        prevEnd = span.endCol;
      }
    }
  });

  test("every run carries at least one attribute", () => {
    for (const line of CORPUS) {
      for (const span of runs(line)) {
        const { startCol: _s, endCol: _e, ...attributes } = span;
        expect(Object.keys(attributes).length).toBeGreaterThan(0);
      }
    }
  });

  test("adjacent runs never share an identical attribute set", () => {
    for (const line of CORPUS) {
      const emitted = runs(line);
      for (let i = 1; i < emitted.length; i++) {
        const prev = emitted[i - 1] as InlineSpan;
        const next = emitted[i] as InlineSpan;
        if (prev.endCol !== next.startCol) continue;
        const key = (s: InlineSpan) =>
          JSON.stringify({ ...s, startCol: undefined, endCol: undefined });
        expect(key(prev)).not.toBe(key(next));
      }
    }
  });
});
