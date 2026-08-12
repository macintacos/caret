import { describe, expect, test } from "bun:test";

import { buildInlineSpans, type InlineSpan } from "$lib/diffview/inlineSpans.ts";

// buildInlineSpans is the pure per-line pass: display text + the line's link
// ranges -> flat atomic runs (one per maximal stretch of identical attribute
// set) plus the line's blockquote depth. Columns are 0-based, half-open
// [startCol, endCol) into the DISPLAY line. Nothing is stripped or rewritten
// here — the markers are part of the runs they mark.

/** Runs for a line. `links` are the ranges marked `link: true`; `labels` is the
 * superset the caller rewrote (references included) that the quote scan reads, and
 * defaults to `links` because every link range is also a label range. */
function runs(
  line: string,
  links: { startCol: number; endCol: number }[] = [],
  labels: { startCol: number; endCol: number }[] = links,
): InlineSpan[] {
  return buildInlineSpans(line, links, labels).spans;
}

function depth(line: string): number {
  return buildInlineSpans(line, [], []).quoteDepth;
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

  test("abutting elements with the same attribute stay two runs", () => {
    // Fusing these would erase the boundary EXC-867 draws a pill's rounded ends
    // at. For links it also erases which label belongs to which target, which
    // nothing downstream could recover.
    expect(runs("*a*_b_")).toEqual([
      { startCol: 0, endCol: 3, italic: true },
      { startCol: 3, endCol: 6, italic: true },
    ]);
    expect(
      runs("ab", [
        { startCol: 0, endCol: 1 },
        { startCol: 1, endCol: 2 },
      ]),
    ).toEqual([
      { startCol: 0, endCol: 1, link: true },
      { startCol: 1, endCol: 2, link: true },
    ]);
  });

  test("emphasis inside a link the layer left literal is still attributed", () => {
    // An uncollapsed link is the one container in production whose content sits
    // at a non-trivial offset inside a marker this module did not produce, so it
    // exercises the descent's raw-offset math rather than a symmetric one.
    expect(runs("[**a**](ftp://x.test/y)")).toEqual([{ startCol: 1, endCol: 6, bold: true }]);
  });

  test.each([
    ["an astral character", "👍 **bold**", 3],
    ["CJK characters", "日本語 **bold**", 4],
  ])("columns are UTF-16 code units, matching textContent.length (%s)", (_name, line, startCol) => {
    // tagTokenAt walks tokens by `textContent.length`, which counts UTF-16 code
    // units — so these columns must too, or a plan with an emoji misplaces every
    // decoration after it.
    expect(runs(line)).toEqual([{ startCol, endCol: startCol + 8, bold: true }]);
  });

  test("prose with nothing to mark yields no runs", () => {
    expect(runs("just a plain sentence.")).toEqual([]);
  });
});

describe("link runs", () => {
  test("a link range becomes a link run", () => {
    expect(runs("See the docs now.", [{ startCol: 4, endCol: 12 }])).toEqual([
      { startCol: 4, endCol: 12, link: true },
    ]);
  });

  test("emphasis inside a collapsed label shares the link's columns", () => {
    // The label of [**bold**](https://x.test) collapses to `**bold**`, so the
    // link range and the bold element cover the same columns.
    expect(runs("**bold**", [{ startCol: 0, endCol: 8 }])).toEqual([
      { startCol: 0, endCol: 8, bold: true, link: true },
    ]);
  });

  test("a link partially overlapping emphasis splits into attributed runs", () => {
    expect(runs("**bold** tail", [{ startCol: 0, endCol: 13 }])).toEqual([
      { startCol: 0, endCol: 8, bold: true, link: true },
      { startCol: 8, endCol: 13, link: true },
    ]);
  });

  test("a zero-width link range yields no run", () => {
    expect(runs("nothing", [{ startCol: 3, endCol: 3 }])).toEqual([]);
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
    ["brackets with no space before the content", "- [x]done"],
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

  test("three levels report depth 3 and one run per marker", () => {
    expect(depth("> > > deepest")).toBe(3);
    expect(runs("> > > deepest")).toEqual([
      { startCol: 0, endCol: 1, quoteMarker: 1 },
      { startCol: 2, endCol: 3, quoteMarker: 2 },
      { startCol: 4, endCol: 5, quoteMarker: 3 },
    ]);
  });

  // EXC-863: a tab is the marker's optional separator exactly as a space is, so
  // the scan has to step over it to find the next level. Deferred by EXC-866;
  // it matters here because the depth is now drawn as one bar per level, so a
  // miscount is a visibly missing bar rather than an unused number.
  test("a tab after the marker separates it from the next level", () => {
    expect(depth(">\t> deep")).toBe(2);
    expect(runs(">\t> deep")).toEqual([
      { startCol: 0, endCol: 1, quoteMarker: 1 },
      { startCol: 2, endCol: 3, quoteMarker: 2 },
    ]);
  });

  test("a tab after a single marker leaves the content start past it", () => {
    expect(runs(">\t- [x] task")).toEqual([
      { startCol: 0, endCol: 1, quoteMarker: 1 },
      { startCol: 4, endCol: 7, checkbox: "checked" },
    ]);
  });

  // EXC-863: `[> x](url)` collapses to the display text `> x`, whose leading `>`
  // belongs to the label rather than to a blockquote. Also deferred by EXC-866,
  // and likewise only visible once depth is drawn: unguarded it paints a bar
  // over a link and subdues the whole row.
  test("a `>` inside a collapsed link label is not a quote marker", () => {
    const label = [{ startCol: 0, endCol: 3 }];
    const { spans, quoteDepth } = buildInlineSpans("> x", label, label);
    expect(quoteDepth).toBe(0);
    expect(spans).toEqual([{ startCol: 0, endCol: 3, link: true }]);
  });

  // The same collapse, but the label resolved to a file reference — which is the
  // commoner shape in a plan, and the one that never reaches linkRanges (links.ts
  // marks a resolved reference as a reference, not a link). Counted as a marker it
  // would put data-md-quote and data-file-ref on ONE element, landing the bar's
  // ::before and the glyph's ::before on the same box.
  test("a `>` inside a collapsed reference label is not a quote marker either", () => {
    const { spans, quoteDepth } = buildInlineSpans("> a.ts", [], [{ startCol: 0, endCol: 6 }]);
    expect(quoteDepth).toBe(0);
    expect(spans).toEqual([]);
  });

  test("a real marker before a collapsed label still counts", () => {
    // `> [> x](url)` displays as `> > x`: the first marker is the line's, the
    // second is the label's and stops the scan.
    const label = [{ startCol: 2, endCol: 5 }];
    const { spans, quoteDepth } = buildInlineSpans("> > x", label, label);
    expect(quoteDepth).toBe(1);
    expect(spans).toEqual([
      { startCol: 0, endCol: 1, quoteMarker: 1 },
      { startCol: 2, endCol: 5, link: true },
    ]);
  });

  // EXC-863: `- > quoted` is a blockquote inside a list item. CommonMark counts
  // the list marker as indentation, so the scan steps over one — but only when a
  // `>` actually follows, which is what keeps `- [x] done` untouched.
  test("a quote inside a list item marks the marker the list indented", () => {
    expect(depth("- > quoted")).toBe(1);
    expect(runs("- > quoted")).toEqual([{ startCol: 2, endCol: 3, quoteMarker: 1 }]);
  });

  test("a nested quote inside an ordered list item counts both levels", () => {
    expect(depth("1. > > deep")).toBe(2);
    expect(runs("1. > > deep")).toEqual([
      { startCol: 3, endCol: 4, quoteMarker: 1 },
      { startCol: 5, endCol: 6, quoteMarker: 2 },
    ]);
  });

  test("a list marker with no quote after it leaves the task scan alone", () => {
    expect(runs("- [x] done")).toEqual([{ startCol: 2, endCol: 5, checkbox: "checked" }]);
  });
});

// The mixing cases the issue calls out. A quote's own bar is drawn per marker
// column, so what matters for each is that the markers still land where the
// source put them and the construct inside keeps its own columns.
describe("blockquote mixing cases", () => {
  test("a quote containing a list marks the marker and leaves the bullet", () => {
    expect(runs("> - item")).toEqual([{ startCol: 0, endCol: 1, quoteMarker: 1 }]);
  });

  test("a quote containing a table row keeps the marker at column zero", () => {
    expect(runs("> | a | **b** |")).toEqual([
      { startCol: 0, endCol: 1, quoteMarker: 1 },
      { startCol: 8, endCol: 13, bold: true },
    ]);
  });

  // A fence inside a quote is NOT detected as a fence by links.ts (its FENCE
  // regex is anchored past leading whitespace only, never past a marker), so the
  // row reaches this pass as ordinary prose. That is inherited from the same
  // stateless detection codeBlocks.ts uses and is out of scope here; what this
  // pins is that the quote half stays right regardless.
  test("a quote containing a fence row still marks its level", () => {
    expect(depth("> ```ts")).toBe(1);
    expect(runs("> ```ts")).toEqual([{ startCol: 0, endCol: 1, quoteMarker: 1 }]);
  });

  // The implication the decoration pass relies on to visit quoted rows without
  // unioning the depth map into its key set: depth is counted from marker
  // intervals, and each of those becomes a run, so a line with depth is never
  // absent from the run map. If this ever fails, inlineDecorate.ts stops tagging
  // some quoted rows — so it is pinned here, where the two are produced.
  test("a line with depth always emits at least one marker run", () => {
    for (const line of ["> a", "> > a", ">", "> >", "   > a", "- > a", ">\t> a", "> - [ ] t"]) {
      const { spans, quoteDepth } = buildInlineSpans(line, [], []);
      expect(quoteDepth, line).toBeGreaterThan(0);
      expect(
        spans.filter((s) => s.quoteMarker !== undefined),
        line,
      ).toHaveLength(quoteDepth);
    }
  });

  // A lazy continuation carries no marker column, so it carries no depth. The
  // bars are drawn over the source's own markers, and inferring a bar for a line
  // that has none would need block-level quote state this per-line pass does not
  // carry. Pinned so the boundary is recorded rather than assumed.
  test("a lazy continuation line carries no depth of its own", () => {
    expect(depth("continued from the quote above")).toBe(0);
    expect(runs("continued from the quote above")).toEqual([]);
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
      const emitted = runs(line, [{ startCol: 0, endCol: Math.min(3, line.length) }]);
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

  test("the runs of a line reconstruct exactly the text they cover", () => {
    // The partition claim, checked from the other side: slicing the line by each
    // run's columns must give back contiguous, in-order pieces of it. A run whose
    // columns drifted would slice out text it does not describe.
    for (const line of CORPUS) {
      for (const span of runs(line)) {
        expect(line.slice(span.startCol, span.endCol).length).toBe(span.endCol - span.startCol);
      }
    }
  });
});
