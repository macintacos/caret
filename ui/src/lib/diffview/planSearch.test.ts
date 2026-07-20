import "../../../test-setup.ts";
import { describe, expect, test } from "bun:test";

import {
  findMatches,
  matchStepFromLine,
  nearestMatchIndex,
  stepIndex,
} from "$lib/diffview/planSearch.ts";

describe("findMatches", () => {
  test("empty query yields no matches", () => {
    expect(findMatches(["anything here"], "")).toEqual([]);
  });

  test("smartcase: a lowercase query is case-insensitive", () => {
    const lines = ["match", "Match", "MATCH", "mismatch"];
    expect(findMatches(lines, "match")).toEqual([
      { line: 1, startCol: 0, endCol: 5 },
      { line: 2, startCol: 0, endCol: 5 },
      { line: 3, startCol: 0, endCol: 5 },
      { line: 4, startCol: 3, endCol: 8 },
    ]);
  });

  test("smartcase: any uppercase letter makes the query case-sensitive", () => {
    const lines = ["match", "Match", "MATCH"];
    expect(findMatches(lines, "Match")).toEqual([{ line: 2, startCol: 0, endCol: 5 }]);
  });

  test("literal, not regex: special characters match themselves", () => {
    // "a.b" must match the literal "a.b", not the regex a<any>b — so "axb" is not a hit.
    expect(findMatches(["a.b", "axb"], "a.b")).toEqual([{ line: 1, startCol: 0, endCol: 3 }]);
  });

  test("multiple non-overlapping matches on one line, in column order", () => {
    expect(findMatches(["foo foo foo"], "foo")).toEqual([
      { line: 1, startCol: 0, endCol: 3 },
      { line: 1, startCol: 4, endCol: 7 },
      { line: 1, startCol: 8, endCol: 11 },
    ]);
  });

  test("overlapping occurrences advance past each match (no overlap)", () => {
    // "aa" in "aaaa" → positions 0 and 2, not 0/1/2/3.
    expect(findMatches(["aaaa"], "aa")).toEqual([
      { line: 1, startCol: 0, endCol: 2 },
      { line: 1, startCol: 2, endCol: 4 },
    ]);
  });
});

describe("nearestMatchIndex", () => {
  const matches = [
    { line: 2, startCol: 0, endCol: 1 },
    { line: 5, startCol: 0, endCol: 1 },
    { line: 9, startCol: 0, endCol: 1 },
  ];

  test("first match at or after the given line", () => {
    expect(nearestMatchIndex(matches, 5)).toBe(1); // on the line counts
    expect(nearestMatchIndex(matches, 3)).toBe(1); // next after
    expect(nearestMatchIndex(matches, 1)).toBe(0);
  });

  test("wraps to the first match when none follow", () => {
    expect(nearestMatchIndex(matches, 10)).toBe(0);
  });

  test("returns -1 with no matches", () => {
    expect(nearestMatchIndex([], 1)).toBe(-1);
  });
});

describe("matchStepFromLine", () => {
  const matches = [
    { line: 2, startCol: 0, endCol: 1 },
    { line: 5, startCol: 0, endCol: 1 },
    { line: 9, startCol: 0, endCol: 1 },
  ];

  test("n (delta +1): the first match strictly after the line", () => {
    expect(matchStepFromLine(matches, 3, 1)).toBe(1); // 5 is the next
    expect(matchStepFromLine(matches, 5, 1)).toBe(2); // on a match → step to 9
    expect(matchStepFromLine(matches, 1, 1)).toBe(0);
  });

  test("n wraps to the first match when none follow", () => {
    expect(matchStepFromLine(matches, 9, 1)).toBe(0);
    expect(matchStepFromLine(matches, 10, 1)).toBe(0);
  });

  test("N (delta -1): the last match strictly before the line", () => {
    expect(matchStepFromLine(matches, 6, -1)).toBe(1); // 5 is the previous
    expect(matchStepFromLine(matches, 5, -1)).toBe(0); // on a match → step to 2
    expect(matchStepFromLine(matches, 10, -1)).toBe(2);
  });

  test("N wraps to the last match when none precede", () => {
    expect(matchStepFromLine(matches, 2, -1)).toBe(2);
    expect(matchStepFromLine(matches, 1, -1)).toBe(2);
  });

  test("returns -1 with no matches", () => {
    expect(matchStepFromLine([], 1, 1)).toBe(-1);
    expect(matchStepFromLine([], 1, -1)).toBe(-1);
  });
});

describe("stepIndex", () => {
  test("n steps forward with wrap", () => {
    expect(stepIndex(3, 0, 1)).toBe(1);
    expect(stepIndex(3, 2, 1)).toBe(0); // wrap past the end
  });

  test("N steps backward with wrap", () => {
    expect(stepIndex(3, 1, -1)).toBe(0);
    expect(stepIndex(3, 0, -1)).toBe(2); // wrap past the start
  });

  test("returns -1 with no matches", () => {
    expect(stepIndex(0, -1, 1)).toBe(-1);
  });
});
