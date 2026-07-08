import { describe, expect, test } from "bun:test";
import { type PlanBlock, parsePlan } from "./planBlocks.ts";

/** Visible text of a block's decorated inline HTML (tags stripped, entities decoded). */
function vis(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// One document exercising every construct, with known line numbers so the
// source-range mapping — the piece that keeps a comment's lines accurate to the
// source even as the view joins them — is pinned exactly.
const STRESS = [
  "# Title", // 1
  "", // 2
  "Para one soft", // 3
  "wrapped line.", // 4
  "", // 5
  "Para two.", // 6
  "", // 7
  "- item a", // 8
  "- [ ] todo", // 9
  "- [x] done", // 10
  "  - nested", // 11
  "", // 12
  "1. first", // 13
  "2. second", // 14
  "", // 15
  "> quote line", // 16
  "> > nested quote", // 17
  "", // 18
  "| A | B |", // 19
  "|---|:-:|", // 20
  "| 1 | 2 |", // 21
  "", // 22
  "```ts", // 23
  "const x = 1;", // 24
  "```", // 25
  "", // 26
  "Text with [^1] ref.", // 27
  "", // 28
  "[^1]: footnote def.", // 29
  "",
].join("\n");

describe("parsePlan — source line ranges (comment-accuracy invariant)", () => {
  test("every block maps to its exact source line range", () => {
    const shape = parsePlan(STRESS).map((b) => ({
      kind: b.kind,
      startLine: b.startLine,
      endLine: b.endLine,
    }));
    expect(shape).toEqual([
      { kind: "heading", startLine: 1, endLine: 1 },
      { kind: "paragraph", startLine: 3, endLine: 4 },
      { kind: "paragraph", startLine: 6, endLine: 6 },
      { kind: "list", startLine: 8, endLine: 11 },
      { kind: "list", startLine: 13, endLine: 14 },
      { kind: "blockquote", startLine: 16, endLine: 17 },
      { kind: "table", startLine: 19, endLine: 21 },
      { kind: "code", startLine: 23, endLine: 25 },
      { kind: "paragraph", startLine: 27, endLine: 27 },
      { kind: "footnote", startLine: 29, endLine: 29 },
    ]);
  });

  test("blank lines produce no block but never desync the line cursor", () => {
    // Two paragraphs separated by two blank lines; the second must still land on line 4.
    const blocks = parsePlan("first\n\n\nsecond\n");
    expect(blocks.map((b) => [b.kind, b.startLine, b.endLine])).toEqual([
      ["paragraph", 1, 1],
      ["paragraph", 4, 4],
    ]);
  });
});

function only<K extends PlanBlock["kind"]>(src: string, kind: K): Extract<PlanBlock, { kind: K }> {
  const block = parsePlan(src).find((b) => b.kind === kind);
  if (block == null) throw new Error(`no ${kind} block in: ${src}`);
  return block as Extract<PlanBlock, { kind: K }>;
}

/** The visible text of a list item's leading segments, joined as they render. */
function itemText(item: { lines: { html: string }[] } | undefined): string {
  return (item?.lines ?? []).map((l) => vis(l.html)).join(" ");
}

describe("parsePlan — paragraphs join soft-wrapped lines", () => {
  test("a single newline is a continuation: one block, one segment per source line", () => {
    const p = only("alpha line\nbeta line", "paragraph");
    expect(p.startLine).toBe(1);
    expect(p.endLine).toBe(2);
    // The block stays whole (the view flows it into one paragraph), but each
    // source line is its own segment carrying its true line number — the per-line
    // hover/click targets that mirror the source view.
    expect(p.lines.map((l) => [l.line, vis(l.html)])).toEqual([
      [1, "alpha line"],
      [2, "beta line"],
    ]);
  });

  test("segment line numbers are offset from the paragraph's start line", () => {
    // A paragraph that starts partway down the document keeps absolute line numbers.
    const p = only("intro\n\nfirst wrapped\nsecond wrapped", "paragraph");
    // "intro" is its own paragraph (blocks[0]); the wrapped one is blocks[1].
    const wrapped = parsePlan("intro\n\nfirst wrapped\nsecond wrapped").filter(
      (b) => b.kind === "paragraph",
    )[1];
    expect(wrapped?.kind === "paragraph" ? wrapped.lines.map((l) => l.line) : []).toEqual([3, 4]);
    expect(p.lines[0]?.line).toBe(1);
  });

  test("a blank line is a real break: two separate blocks", () => {
    const blocks = parsePlan("alpha\n\nbeta");
    expect(blocks.filter((b) => b.kind === "paragraph")).toHaveLength(2);
  });
});

describe("parsePlan — headings", () => {
  test("keeps a visible ## marker and reports its level", () => {
    const h = only("## Section name", "heading");
    expect(h.level).toBe(2);
    expect(vis(h.html)).toContain("##");
    expect(vis(h.html)).toContain("Section name");
  });
});

describe("parsePlan — lists and checkboxes", () => {
  test("unordered items expose task/checked; plain items are not tasks", () => {
    const list = only("- plain\n- [ ] todo\n- [x] done", "list");
    expect(list.ordered).toBe(false);
    expect(list.items.map((i) => [i.task, i.checked])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ]);
    expect(itemText(list.items[0])).toContain("plain");
  });

  test("a soft-wrapped bullet splits into a segment per source line", () => {
    // The bullet's text continues on line 2; each source line is its own target,
    // so a click on the continuation reports line 2, not the item's start.
    const list = only("- lead here\n  wrapped on", "list");
    expect(list.items[0]?.lines.map((l) => [l.line, vis(l.html)])).toEqual([
      [1, "lead here"],
      [2, "wrapped on"],
    ]);
  });

  test("a nested list lives in the parent item's children, not its own leading text", () => {
    const list = only("- outer\n  - inner", "list");
    const outer = list.items[0];
    expect(itemText(outer)).toContain("outer");
    expect(itemText(outer)).not.toContain("inner");
    expect(outer?.children.some((c) => c.kind === "list")).toBe(true);
  });

  test("a nested list's items carry their own source lines, not the parent's", () => {
    // The nested item is on source line 2; its line must track through the nesting
    // (not inherit the outer item's line 1) so a per-line click reports line 2.
    const list = only("- outer\n  - inner", "list");
    const nested = list.items[0]?.children.find((c) => c.kind === "list");
    const innerItem = nested?.kind === "list" ? nested.items[0] : undefined;
    expect(innerItem?.startLine).toBe(2);
  });

  test("ordered lists expose ordered + start number", () => {
    const list = only("3. three\n4. four", "list");
    expect(list.ordered).toBe(true);
    expect(list.start).toBe(3);
  });

  test("top-level list items carry their own source line ranges", () => {
    const list = only("- a\n- b\n- c", "list");
    expect(list.items.map((i) => [i.startLine, i.endLine])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  test("a loose item keeps its leading text separate from a following paragraph", () => {
    // The item's first line is its leading text; a second paragraph in the same
    // loose item is a child block, rendered below — never glued onto the lead.
    const list = only("- lead line\n\n  second paragraph\n- next", "list");
    const item = list.items[0];
    expect(itemText(item)).toBe("lead line");
    expect(itemText(item)).not.toContain("second paragraph");
    const para = item?.children.find((c) => c.kind === "paragraph");
    expect(para).toBeDefined();
    expect(
      para && para.kind === "paragraph" ? para.lines.map((l) => vis(l.html)).join(" ") : "",
    ).toContain("second paragraph");
  });
});

describe("parsePlan — tables", () => {
  test("exposes header, alignment, and decorated row cells", () => {
    const t = only("| A | B |\n|:--|--:|\n| 1 | **2** |", "table");
    expect(t.header.map(vis)).toEqual(["A", "B"]);
    expect(t.align).toEqual(["left", "right"]);
    expect(t.rows).toHaveLength(1);
    expect(vis(t.rows[0]?.[1])).toBe("**2**"); // emphasis markers stay visible in cells
  });

  test("carries per-row source lines: header, then data rows after the divider", () => {
    // Header on the start line, the |---| divider takes the next line (no rendered
    // row), and each data row follows — so a per-row click reports the true line.
    const t = only("| A | B |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |", "table");
    expect(t.headerLine).toBe(1);
    expect(t.rowLines).toEqual([3, 4]);
  });
});

describe("parsePlan — blockquotes", () => {
  test("nests, and its inner content renders without the > marker", () => {
    const bq = only("> outer quote\n> > deep quote", "blockquote");
    const nested = bq.children.find((c) => c.kind === "blockquote");
    expect(nested).toBeDefined();
    // No literal '>' survives into the rendered inner text.
    const text = bq.children
      .map((c) => (c.kind === "paragraph" ? c.lines.map((l) => vis(l.html)).join(" ") : ""))
      .join(" ");
    expect(text).toContain("outer quote");
    expect(text).not.toContain(">");
  });

  test("children carry accurate source lines through the > prefix", () => {
    // Stripping the '> ' prefix preserves newline counts, so line tracking holds:
    // the wrapped paragraph is lines 1–2, the nested quote line 3.
    const bq = only("> line one\n> line two\n> > nested at three", "blockquote");
    const para = bq.children.find((c) => c.kind === "paragraph");
    expect(para && para.kind === "paragraph" ? para.lines.map((l) => l.line) : []).toEqual([1, 2]);
    const nested = bq.children.find((c) => c.kind === "blockquote");
    expect(nested?.startLine).toBe(3);
  });
});

describe("parsePlan — code blocks", () => {
  test("strips the fences and keeps language + code text", () => {
    const c = only("```ts\nconst x = 1;\n```", "code");
    expect(c.lang).toBe("ts");
    expect(c.text).toBe("const x = 1;");
    expect(c.text).not.toContain("```");
  });

  test("a fence with no language reports null lang", () => {
    const c = only("```\nplain\n```", "code");
    expect(c.lang).toBeNull();
  });
});

describe("parsePlan — thematic breaks and footnotes", () => {
  test("a --- rule becomes an hr block", () => {
    expect(parsePlan("a\n\n---\n\nb").some((b) => b.kind === "hr")).toBe(true);
  });

  test("a [^id]: line becomes a footnote definition block", () => {
    const f = only("[^1]: the note body", "footnote");
    expect(f.label).toBe("1");
    expect(vis(f.html)).toContain("the note body");
  });
});
