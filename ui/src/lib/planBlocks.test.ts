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

describe("parsePlan — paragraphs join soft-wrapped lines", () => {
  test("a single newline is a continuation: one block carrying both lines", () => {
    const p = only("alpha line\nbeta line", "paragraph");
    expect(p.startLine).toBe(1);
    expect(p.endLine).toBe(2);
    expect(vis(p.html)).toContain("alpha line");
    expect(vis(p.html)).toContain("beta line");
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
    expect(vis(list.items[0]?.html)).toContain("plain");
  });

  test("a nested list lives in the parent item's children, not its own leading text", () => {
    const list = only("- outer\n  - inner", "list");
    const outer = list.items[0];
    expect(vis(outer?.html)).toContain("outer");
    expect(vis(outer?.html)).not.toContain("inner");
    expect(outer?.children.some((c) => c.kind === "list")).toBe(true);
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
    expect(vis(item?.html)).toBe("lead line");
    expect(vis(item?.html)).not.toContain("second paragraph");
    const para = item?.children.find((c) => c.kind === "paragraph");
    expect(para).toBeDefined();
    expect(para && para.kind === "paragraph" ? vis(para.html) : "").toContain("second paragraph");
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
});

describe("parsePlan — blockquotes", () => {
  test("nests, and its inner content renders without the > marker", () => {
    const bq = only("> outer quote\n> > deep quote", "blockquote");
    const nested = bq.children.find((c) => c.kind === "blockquote");
    expect(nested).toBeDefined();
    // No literal '>' survives into the rendered inner text.
    const text = bq.children.map((c) => (c.kind === "paragraph" ? vis(c.html) : "")).join(" ");
    expect(text).toContain("outer quote");
    expect(text).not.toContain(">");
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
