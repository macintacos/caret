import { describe, expect, test } from "bun:test";
import type { Annotation } from "@core/types";
import { formatFeedback } from "./feedback.ts";

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
    const out = formatFeedback([], "Please rethink the rollout.");
    expect(out).toBe("Please rethink the rollout.");
  });

  test("single annotation, no general comment", () => {
    const out = formatFeedback([ann({ quote: "deploy on Friday", comment: "risky" })], "");
    expect(out).toBe(["Inline comments:", "", '1. On "deploy on Friday": risky'].join("\n"));
  });

  test("multiple annotations are numbered in array order", () => {
    const out = formatFeedback(
      [ann({ quote: "first", comment: "a" }), ann({ quote: "second", comment: "b" })],
      "",
    );
    expect(out).toBe(["Inline comments:", "", '1. On "first": a', '2. On "second": b'].join("\n"));
  });

  test("line-anchored annotations cite their line range", () => {
    const out = formatFeedback([lineAnn(3, 3, "tighten"), lineAnn(4, 7, "split this up")], "");
    expect(out).toBe(
      ["Inline comments:", "", "1. On line 3: tighten", "2. On lines 4-7: split this up"].join(
        "\n",
      ),
    );
  });

  test("legacy and line annotations mix in array order", () => {
    const out = formatFeedback([ann({ quote: "q", comment: "a" }), lineAnn(2, 2, "b")], "");
    expect(out).toBe(["Inline comments:", "", '1. On "q": a', "2. On line 2: b"].join("\n"));
  });

  test("general comment precedes inline comments", () => {
    const out = formatFeedback(
      [ann({ quote: "q", comment: "tighten this" })],
      "Overall direction is good.",
    );
    expect(out).toBe(
      ["Overall direction is good.", "", "Inline comments:", "", '1. On "q": tighten this'].join(
        "\n",
      ),
    );
  });

  test("empty annotations and empty comment yields empty string", () => {
    expect(formatFeedback([], "")).toBe("");
    expect(formatFeedback([], "   ")).toBe("");
  });

  test("trims surrounding whitespace from comment and quote", () => {
    const out = formatFeedback([ann({ quote: "  spaced  ", comment: "  note  " })], "  hello  ");
    expect(out).toBe(["hello", "", "Inline comments:", "", '1. On "spaced": note'].join("\n"));
  });

  test("annotations with blank comments are skipped", () => {
    const out = formatFeedback(
      [ann({ quote: "kept", comment: "real" }), ann({ quote: "dropped", comment: "   " })],
      "",
    );
    expect(out).toBe(["Inline comments:", "", '1. On "kept": real'].join("\n"));
  });

  test("collapses internal newlines in a quote to a single space", () => {
    const out = formatFeedback([ann({ quote: "line one\nline two", comment: "fix" })], "");
    expect(out).toBe(["Inline comments:", "", '1. On "line one line two": fix'].join("\n"));
  });

  test("is deterministic for identical input", () => {
    const anns = [ann({ quote: "a", comment: "1" }), ann({ quote: "b", comment: "2" })];
    expect(formatFeedback(anns, "x")).toBe(formatFeedback(anns, "x"));
  });
});
