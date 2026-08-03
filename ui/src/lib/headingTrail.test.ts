import { describe, expect, test } from "bun:test";

import { headingTrail } from "$lib/headingTrail.ts";
import { extractHeadings } from "$lib/toc.ts";

describe("headingTrail", () => {
  test("returns the ancestor chain from the outermost heading down to the active one", () => {
    const headings = extractHeadings("# A\n## B\n### C\n");
    expect(headingTrail(headings, 3).map((c) => c.heading.text)).toEqual(["A", "B", "C"]);
  });

  test("carries the active heading's own line on the last crumb", () => {
    const headings = extractHeadings("# A\n## B\n### C\n");
    expect(headingTrail(headings, 3).at(-1)?.heading).toEqual({ level: 3, text: "C", line: 3 });
  });

  test("gives each crumb its same-level siblings under the same parent, in document order", () => {
    const headings = extractHeadings("# A\n## B\n### C\n### D\n## E\n");
    expect(headingTrail(headings, 3).map((c) => c.siblings.map((s) => s.text))).toEqual([
      ["A"],
      ["B", "E"],
      ["C", "D"],
    ]);
  });

  test("scopes siblings to one parent, so a same-level heading under another parent is excluded", () => {
    const headings = extractHeadings("# A\n## B\n# C\n## D\n");
    expect(headingTrail(headings, 2).map((c) => c.siblings.map((s) => s.text))).toEqual([
      ["A", "C"],
      ["B"],
    ]);
  });

  test("parents a skipped level under the nearest shallower heading", () => {
    // "### C" has no "##" above it, so "# A" is its parent — and the later
    // "## D" is a sibling of neither.
    const headings = extractHeadings("# A\n### C\n## D\n");
    const trail = headingTrail(headings, 2);
    expect(trail.map((c) => c.heading.text)).toEqual(["A", "C"]);
    expect(trail.at(-1)?.siblings.map((s) => s.text)).toEqual(["C"]);
  });

  test("roots the trail at the first heading when the plan does not start at level 1", () => {
    const headings = extractHeadings("## A\n### B\n");
    expect(headingTrail(headings, 2).map((c) => c.heading.text)).toEqual(["A", "B"]);
  });

  test("treats a flat plan as one level of siblings", () => {
    const headings = extractHeadings("## A\n## B\n## C\n");
    const trail = headingTrail(headings, 2);
    expect(trail.map((c) => c.heading.text)).toEqual(["B"]);
    expect(trail[0]?.siblings.map((s) => s.text)).toEqual(["A", "B", "C"]);
  });

  test("returns an empty trail for a plan with no headings", () => {
    expect(headingTrail([], 1)).toEqual([]);
  });

  test("returns an empty trail when no heading is active", () => {
    expect(headingTrail(extractHeadings("# A\n## B\n"), null)).toEqual([]);
  });

  test("returns an empty trail when the active line holds no heading", () => {
    expect(headingTrail(extractHeadings("# A\n## B\n"), 99)).toEqual([]);
  });
});
