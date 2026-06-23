import { describe, expect, test } from "bun:test";
import type { Annotation } from "@core/types";
import {
  coveredLineCount,
  formatFeedback,
  pendingInlineCount,
  pendingLineCount,
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
