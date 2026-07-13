import { describe, expect, test } from "bun:test";
import type { Annotation } from "@core/types";
import type { ComposerScratch } from "./diffview/commenting.ts";
import {
  commentIndex,
  coveredLineCount,
  filterComments,
  formatFeedback,
  highlightMatches,
  pendingInlineCount,
  pendingItems,
  pendingLineCount,
  sourceLines,
} from "./feedback.ts";

// A synthetic plan whose lines are individually identifiable, so a quoted block
// is unambiguous. Line numbers are 1-based: line 1 is "# Title", line 3 is the
// first body line, etc.
const PLAN = [
  "# Title",
  "",
  "First body line.",
  "Second body line.",
  "Third body line.",
  "Fourth body line.",
].join("\n");

const ann = (over: Partial<Annotation>): Annotation => ({
  id: "a",
  blockId: "b0",
  startOffset: 0,
  endOffset: 1,
  quote: "x",
  comment: "c",
  ...over,
});

const lineAnn = (startLine: number, endLine: number, comment: string): Annotation => ({
  id: "l",
  startLine,
  endLine,
  comment,
});

const scratch = (startLine: number, endLine: number, text: string): ComposerScratch => ({
  key: `${startLine}:${endLine}`,
  startLine,
  endLine,
  text,
});

describe("formatFeedback", () => {
  test("general comment only", () => {
    const out = formatFeedback([], "Please rethink the rollout.", PLAN);
    expect(out).toBe("Please rethink the rollout.");
  });

  test("single legacy annotation, no general comment", () => {
    const out = formatFeedback([ann({ quote: "deploy on Friday", comment: "risky" })], "", PLAN);
    expect(out).toBe(["Inline comments:", "", '1. On "deploy on Friday": risky'].join("\n"));
  });

  test("multiple legacy annotations are numbered in array order", () => {
    const out = formatFeedback(
      [ann({ quote: "first", comment: "a" }), ann({ quote: "second", comment: "b" })],
      "",
      PLAN,
    );
    expect(out).toBe(["Inline comments:", "", '1. On "first": a', '2. On "second": b'].join("\n"));
  });

  test("single-line annotation cites the line and quotes its source line", () => {
    const out = formatFeedback([lineAnn(3, 3, "tighten")], "", PLAN);
    expect(out).toBe(
      ["Inline comments:", "", "1. Line 3:", "   > First body line.", "   tighten"].join("\n"),
    );
  });

  test("multi-line range cites the range and abbreviates the quote to head … tail", () => {
    // Lines 4-6 flatten to nine words (> head + tail), so the middle is elided.
    const out = formatFeedback([lineAnn(4, 6, "split this up")], "", PLAN);
    expect(out).toBe(
      [
        "Inline comments:",
        "",
        "1. Lines 4-6:",
        "   > Second body line. … Fourth body line.",
        "   split this up",
      ].join("\n"),
    );
  });

  test("a short multi-line range collapses onto a single quote line", () => {
    // Lines 4-5 flatten to six words (== head + tail), kept whole but on one line.
    const out = formatFeedback([lineAnn(4, 5, "merge these")], "", PLAN);
    expect(out).toBe(
      [
        "Inline comments:",
        "",
        "1. Lines 4-5:",
        "   > Second body line. Third body line.",
        "   merge these",
      ].join("\n"),
    );
  });

  test("a long legacy quote is abbreviated to head … tail", () => {
    const out = formatFeedback(
      [ann({ quote: "deploy the new cache layer before the migration", comment: "risky" })],
      "",
      PLAN,
    );
    expect(out).toBe(
      ["Inline comments:", "", '1. On "deploy the new … before the migration": risky'].join("\n"),
    );
  });

  test("a quote of exactly six words is kept whole", () => {
    const out = formatFeedback(
      [ann({ quote: "one two three four five six", comment: "c" })],
      "",
      PLAN,
    );
    expect(out).toBe(["Inline comments:", "", '1. On "one two three four five six": c'].join("\n"));
  });

  test("a seven-word quote is abbreviated, dropping the middle word", () => {
    const out = formatFeedback(
      [ann({ quote: "one two three four five six seven", comment: "c" })],
      "",
      PLAN,
    );
    expect(out).toBe(
      ["Inline comments:", "", '1. On "one two three … five six seven": c'].join("\n"),
    );
  });

  test("a whitespace-only legacy quote renders an empty quote, never throwing", () => {
    const out = formatFeedback([ann({ quote: "   ", comment: "c" })], "", PLAN);
    expect(out).toBe(["Inline comments:", "", '1. On "": c'].join("\n"));
  });

  test("legacy and line annotations mix in array order", () => {
    const out = formatFeedback([ann({ quote: "q", comment: "a" }), lineAnn(3, 3, "b")], "", PLAN);
    expect(out).toBe(
      ["Inline comments:", "", '1. On "q": a', "2. Line 3:", "   > First body line.", "   b"].join(
        "\n",
      ),
    );
  });

  test("mixed bag: general + line + legacy in one feedback set", () => {
    const out = formatFeedback(
      [lineAnn(4, 5, "fix range"), ann({ quote: "legacy quote", comment: "legacy note" })],
      "Overall direction is good.",
      PLAN,
    );
    expect(out).toBe(
      [
        "Overall direction is good.",
        "",
        "Inline comments:",
        "",
        "1. Lines 4-5:",
        "   > Second body line. Third body line.",
        "   fix range",
        '2. On "legacy quote": legacy note',
      ].join("\n"),
    );
  });

  test("general comment precedes inline comments", () => {
    const out = formatFeedback(
      [ann({ quote: "q", comment: "tighten this" })],
      "Overall direction is good.",
      PLAN,
    );
    expect(out).toBe(
      ["Overall direction is good.", "", "Inline comments:", "", '1. On "q": tighten this'].join(
        "\n",
      ),
    );
  });

  test("empty annotations and empty comment yields empty string", () => {
    expect(formatFeedback([], "", PLAN)).toBe("");
    expect(formatFeedback([], "   ", PLAN)).toBe("");
  });

  test("trims surrounding whitespace from comment and legacy quote", () => {
    const out = formatFeedback(
      [ann({ quote: "  spaced  ", comment: "  note  " })],
      "  hello  ",
      PLAN,
    );
    expect(out).toBe(["hello", "", "Inline comments:", "", '1. On "spaced": note'].join("\n"));
  });

  test("annotations with blank comments are skipped", () => {
    const out = formatFeedback(
      [ann({ quote: "kept", comment: "real" }), ann({ quote: "dropped", comment: "   " })],
      "",
      PLAN,
    );
    expect(out).toBe(["Inline comments:", "", '1. On "kept": real'].join("\n"));
  });

  test("a line annotation with a blank comment is skipped", () => {
    const out = formatFeedback([lineAnn(3, 3, "   ")], "", PLAN);
    expect(out).toBe("");
  });

  test("collapses internal newlines in a legacy quote to a single space", () => {
    const out = formatFeedback([ann({ quote: "line one\nline two", comment: "fix" })], "", PLAN);
    expect(out).toBe(["Inline comments:", "", '1. On "line one line two": fix'].join("\n"));
  });

  test("a range past the end of the plan text degrades to the reference with no quote block", () => {
    // The plan has 6 lines; lines 9-10 do not exist. Never throw, never drop.
    const out = formatFeedback([lineAnn(9, 10, "stale anchor")], "", PLAN);
    expect(out).toBe(["Inline comments:", "", "1. Lines 9-10:", "   stale anchor"].join("\n"));
  });

  test("a line annotation against empty plan text degrades to the reference, no throw", () => {
    const out = formatFeedback([lineAnn(2, 2, "no text to quote")], "", "");
    expect(out).toBe(["Inline comments:", "", "1. Line 2:", "   no text to quote"].join("\n"));
  });

  test("is deterministic for identical input", () => {
    const anns = [ann({ quote: "a", comment: "1" }), lineAnn(3, 3, "2")];
    expect(formatFeedback(anns, "x", PLAN)).toBe(formatFeedback(anns, "x", PLAN));
  });
});

describe("pendingInlineCount", () => {
  test("counts only non-blank comments", () => {
    expect(
      pendingInlineCount([
        ann({ comment: "real" }),
        lineAnn(3, 3, "also real"),
        ann({ comment: "   " }),
      ]),
    ).toBe(2);
  });

  test("treats whitespace-only comments as blank", () => {
    expect(pendingInlineCount([ann({ comment: "   " }), lineAnn(3, 3, "\n\t ")])).toBe(0);
  });

  test("is zero for no annotations", () => {
    expect(pendingInlineCount([])).toBe(0);
  });

  test("agrees with formatFeedback's inline numbering", () => {
    // The count is the same predicate formatFeedback numbers by, so the two never
    // disagree about which comments are "pending".
    const anns = [ann({ comment: "kept" }), ann({ comment: "  " }), lineAnn(4, 4, "kept2")];
    expect(pendingInlineCount(anns)).toBe(2);
    expect(formatFeedback(anns, "", PLAN)).toContain("2. ");
  });
});

describe("pendingLineCount", () => {
  test("counts each pending comment on its own line as a distinct location", () => {
    expect(pendingLineCount([lineAnn(3, 3, "a"), lineAnn(4, 5, "b")])).toBe(2);
  });

  test("collapses several comments on the same line to one location", () => {
    expect(pendingLineCount([lineAnn(3, 3, "a"), lineAnn(3, 3, "b")])).toBe(1);
  });

  test("collapses comments sharing a multi-line range to one location", () => {
    expect(pendingLineCount([lineAnn(4, 6, "a"), lineAnn(4, 6, "b")])).toBe(2 - 1);
  });

  test("treats distinct ranges that overlap on a line as distinct locations", () => {
    expect(pendingLineCount([lineAnn(3, 3, "a"), lineAnn(3, 4, "b")])).toBe(2);
  });

  test("ignores blank-comment annotations", () => {
    expect(pendingLineCount([lineAnn(3, 3, "a"), lineAnn(4, 4, "   ")])).toBe(1);
  });

  test("counts each legacy annotation as its own location", () => {
    expect(pendingLineCount([ann({ comment: "a" }), ann({ comment: "b" })])).toBe(2);
  });

  test("is zero for no pending comments", () => {
    expect(pendingLineCount([])).toBe(0);
    expect(pendingLineCount([lineAnn(3, 3, "  ")])).toBe(0);
  });

  test("never exceeds the inline count", () => {
    const anns = [lineAnn(3, 3, "a"), lineAnn(3, 3, "b"), ann({ comment: "c" })];
    expect(pendingLineCount(anns)).toBeLessThanOrEqual(pendingInlineCount(anns));
  });
});

describe("coveredLineCount", () => {
  test("two overlapping line-annotations count their shared lines once", () => {
    // On a 10-line plan, [2-6] and [4-8] together touch lines 2..8 = 7 lines.
    // The naive sum of range lengths is 5 + 5 = 10, so a line in both comments
    // would be double-counted; the union counts it once.
    const overlapping = [lineAnn(2, 6, "a"), lineAnn(4, 8, "b")];
    const sumOfLengths = 5 + 5;
    expect(coveredLineCount(overlapping)).toBe(7);
    expect(coveredLineCount(overlapping)).toBeLessThan(sumOfLengths);
  });

  test("disjoint ranges sum their lengths", () => {
    expect(coveredLineCount([lineAnn(1, 2, "a"), lineAnn(5, 7, "b")])).toBe(2 + 3);
  });

  test("a single line counts as one covered line", () => {
    expect(coveredLineCount([lineAnn(3, 3, "a")])).toBe(1);
  });

  test("legacy annotations contribute to the comment count but not to coverage", () => {
    const mixed = [lineAnn(3, 4, "line"), ann({ comment: "legacy" })];
    // Two pending comments, but only the line annotation covers source lines.
    expect(pendingInlineCount(mixed)).toBe(2);
    expect(coveredLineCount(mixed)).toBe(2);
  });

  test("ignores blank-comment line annotations", () => {
    expect(coveredLineCount([lineAnn(3, 5, "real"), lineAnn(7, 9, "   ")])).toBe(3);
  });

  test("is zero with no line annotations", () => {
    expect(coveredLineCount([])).toBe(0);
    expect(coveredLineCount([ann({ comment: "legacy only" })])).toBe(0);
  });
});

describe("pendingItems", () => {
  test("a non-blank general comment leads the list, labeled General", () => {
    expect(pendingItems([], "Please rethink the rollout.", [])).toEqual([
      { label: "General", text: "Please rethink the rollout." },
    ]);
  });

  test("a blank general comment contributes nothing", () => {
    expect(pendingItems([], "   ", [])).toEqual([]);
  });

  test("a line annotation is labeled by its range and carries its comment", () => {
    expect(pendingItems([lineAnn(3, 3, "tighten")], "", [])).toEqual([
      { label: "Line 3", text: "tighten" },
    ]);
  });

  test("a multi-line annotation uses the en-dash range label", () => {
    expect(pendingItems([lineAnn(4, 6, "split this up")], "", [])).toEqual([
      { label: "Lines 4–6", text: "split this up" },
    ]);
  });

  test("blank-comment annotations are skipped (shares pendingInline)", () => {
    expect(pendingItems([lineAnn(3, 3, "   ")], "", [])).toEqual([]);
  });

  test("a scratch is labeled by its range and carries its text", () => {
    expect(pendingItems([], "", [scratch(7, 8, "half a thought")])).toEqual([
      { label: "Lines 7–8", text: "half a thought" },
    ]);
  });

  test("orders general, then inline comments, then scratches", () => {
    const items = pendingItems([lineAnn(3, 3, "inline note")], "overall note", [
      scratch(7, 7, "draft note"),
    ]);
    expect(items).toEqual([
      { label: "General", text: "overall note" },
      { label: "Line 3", text: "inline note" },
      { label: "Line 7", text: "draft note" },
    ]);
  });

  test("a legacy annotation is labeled by its abbreviated quote", () => {
    expect(
      pendingItems(
        [ann({ quote: "deploy the new cache layer before the migration", comment: "risky" })],
        "",
        [],
      ),
    ).toEqual([{ label: "deploy the new … before the migration", text: "risky" }]);
  });

  test("trims the general comment and inline comment text", () => {
    expect(pendingItems([lineAnn(3, 3, "  spaced  ")], "  hi  ", [])).toEqual([
      { label: "General", text: "hi" },
      { label: "Line 3", text: "spaced" },
    ]);
  });

  test("length equals the shared pending count (general + inline + scratches)", () => {
    const anns = [lineAnn(3, 3, "a"), ann({ comment: "   " }), lineAnn(4, 4, "b")];
    const scratches = [scratch(7, 8, "s")];
    const items = pendingItems(anns, "note", scratches);
    // 1 general + 2 non-blank inline + 1 scratch = 4, matching App.svelte's pendingCount.
    expect(items.length).toBe(pendingInlineCount(anns) + scratches.length + 1);
    expect(items.length).toBe(4);
  });

  test("is empty for no feedback at all", () => {
    expect(pendingItems([], "", [])).toEqual([]);
  });
});

// The source lines a line-anchored comment sits on, sliced 1-based inclusive from
// the plan text — the "Context" the Request Changes dialog reveals under an inline
// comment so the reviewer can see the code the comment was written against.
describe("sourceLines", () => {
  test("returns the 1-based, inclusive span of plan lines", () => {
    // PLAN line 3 is "First body line.", line 4 is "Second body line."
    expect(sourceLines(3, 4, PLAN)).toEqual(["First body line.", "Second body line."]);
  });

  test("returns a single line for a single-line anchor", () => {
    expect(sourceLines(1, 1, PLAN)).toEqual(["# Title"]);
  });

  test("returns [] for a stale anchor past the end of the text", () => {
    expect(sourceLines(99, 100, PLAN)).toEqual([]);
  });
});

// A line-anchored annotation with a caller-chosen id, so commentIndex's id
// pass-through and line-order sort are observable (the shared lineAnn helper
// hardcodes one id).
const lineC = (id: string, startLine: number, endLine: number, comment: string): Annotation => ({
  id,
  startLine,
  endLine,
  comment,
});

// The navigable index the comment navigator lists: one entry per line-anchored
// comment, anchored to the line the reviewer jumps to, in document order.
describe("commentIndex", () => {
  test("maps each line-anchored comment to a navigable entry, trimming the text", () => {
    const entries = commentIndex([
      lineC("a", 3, 3, "  tighten this  "),
      lineC("b", 5, 6, "second"),
    ]);
    expect(entries).toEqual([
      { id: "a", line: 3, label: "Line 3", text: "tighten this", draft: false },
      { id: "b", line: 6, label: "Lines 5–6", text: "second", draft: false },
    ]);
  });

  test("anchors an entry to its endLine and labels the span", () => {
    expect(commentIndex([lineC("a", 4, 9, "x")])[0]).toMatchObject({ line: 9, label: "Lines 4–9" });
  });

  test("orders entries by anchor line ascending, regardless of input order", () => {
    const entries = commentIndex([lineC("late", 20, 20, "z"), lineC("early", 2, 2, "a")]);
    expect(entries.map((e) => e.id)).toEqual(["early", "late"]);
  });

  test("excludes legacy (selection-anchored) annotations — they have no line to jump to", () => {
    const entries = commentIndex([ann({ comment: "legacy note" }), lineC("l", 5, 5, "inline")]);
    expect(entries.map((e) => e.id)).toEqual(["l"]);
  });

  test("excludes blank-comment annotations, matching the pending-inline predicate", () => {
    const ids = commentIndex([lineC("blank", 3, 3, "   "), lineC("real", 4, 4, "hi")]).map(
      (e) => e.id,
    );
    expect(ids).toEqual(["real"]);
  });

  test("includes unsent scratches as draft entries, keyed and trimmed", () => {
    expect(commentIndex([], [scratch(3, 3, "  half a thought  ")])).toEqual([
      { id: "3:3", line: 3, label: "Line 3", text: "half a thought", draft: true },
    ]);
  });

  test("merges committed comments and draft scratches, sorted by line", () => {
    const entries = commentIndex(
      [lineC("committed", 10, 10, "placed comment")],
      [scratch(2, 2, "unsent draft")],
    );
    expect(entries).toEqual([
      { id: "2:2", line: 2, label: "Line 2", text: "unsent draft", draft: true },
      { id: "committed", line: 10, label: "Line 10", text: "placed comment", draft: false },
    ]);
  });
});

// The navigator's search: filters the entry list by the comment text alone, so
// typing narrows the list without touching the plan text.
describe("filterComments", () => {
  const entries = commentIndex([
    lineC("a", 2, 2, "Cache the cold path"),
    lineC("b", 5, 5, "Tighten the verification section"),
  ]);

  test("returns every entry for a blank query", () => {
    expect(filterComments(entries, "")).toEqual(entries);
    expect(filterComments(entries, "   ")).toEqual(entries);
  });

  test("matches the comment text case-insensitively", () => {
    expect(filterComments(entries, "CACHE").map((e) => e.id)).toEqual(["a"]);
  });

  test("trims the query before matching", () => {
    expect(filterComments(entries, "  verification  ").map((e) => e.id)).toEqual(["b"]);
  });

  test("returns [] when nothing matches", () => {
    expect(filterComments(entries, "zzzz")).toEqual([]);
  });

  test("searches the comment text, not the line label", () => {
    // "Line 2" is entry a's label but appears in no comment — a label query finds nothing.
    expect(filterComments(entries, "Line 2")).toEqual([]);
  });
});

// The navigator's search underlines the matched substring live as the reviewer
// types: this splits a comment into matched/unmatched segments, preserving the
// text's original case in the matched slice.
describe("highlightMatches", () => {
  test("returns the whole text as one unmatched segment for a blank query", () => {
    expect(highlightMatches("Cache the cold path", "")).toEqual([
      { text: "Cache the cold path", match: false },
    ]);
    expect(highlightMatches("Cache the cold path", "   ")).toEqual([
      { text: "Cache the cold path", match: false },
    ]);
  });

  test("splits around a single match, keeping the matched slice's original case", () => {
    expect(highlightMatches("Cache the cold path", "cache")).toEqual([
      { text: "Cache", match: true },
      { text: " the cold path", match: false },
    ]);
  });

  test("marks every occurrence", () => {
    expect(highlightMatches("warm then re-warm", "warm")).toEqual([
      { text: "warm", match: true },
      { text: " then re-", match: false },
      { text: "warm", match: true },
    ]);
  });

  test("handles a match in the middle and at the end", () => {
    expect(highlightMatches("the sidecar", "sidecar")).toEqual([
      { text: "the ", match: false },
      { text: "sidecar", match: true },
    ]);
  });

  test("returns a single unmatched segment when nothing matches", () => {
    expect(highlightMatches("Cache the cold path", "zzz")).toEqual([
      { text: "Cache the cold path", match: false },
    ]);
  });

  test("trims the query before matching, mirroring filterComments", () => {
    expect(highlightMatches("the sidecar", "  sidecar  ")).toEqual([
      { text: "the ", match: false },
      { text: "sidecar", match: true },
    ]);
  });
});
