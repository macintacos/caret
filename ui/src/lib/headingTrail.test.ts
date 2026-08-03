import { describe, expect, test } from "bun:test";

import { headingTrail } from "$lib/headingTrail.ts";
import { extractHeadings, type TocHeading } from "$lib/toc.ts";

// Fixtures deliberately space their headings apart, so a heading's source line
// never equals its index — the module keys on the line `activeHeadingLine`
// reports, and an index-keyed regression has to fail these.
describe("headingTrail", () => {
  test("returns the ancestor chain from the outermost heading down to the active one", () => {
    // "# A" line 1, "## B" line 4, "### C" line 6.
    const headings = extractHeadings("# A\n\nprose\n## B\n\n### C\n");
    expect(headingTrail(headings, 6).map((c) => c.heading.text)).toEqual(["A", "B", "C"]);
  });

  test("carries the active heading's own line on the last crumb", () => {
    const headings = extractHeadings("# A\n\nprose\n## B\n\n### C\n");
    expect(headingTrail(headings, 6).at(-1)?.heading).toEqual({ level: 3, text: "C", line: 6 });
  });

  test("gives each crumb its same-level siblings under the same parent, in document order", () => {
    // "# A" 1, "## B" 3, "### C" 5, "### D" 7, "## E" 9 — active is "### C".
    const headings = extractHeadings("# A\n\n## B\n\n### C\n\n### D\n\n## E\n");
    expect(headingTrail(headings, 5).map((c) => c.siblings.map((s) => s.text))).toEqual([
      ["A"],
      ["B", "E"],
      ["C", "D"],
    ]);
  });

  test("scopes siblings to one parent, so a same-level heading under another parent is excluded", () => {
    // "# A" 1, "## B" 3, "# C" 5, "## D" 7 — active is "## B", so "## D" is no sibling.
    const headings = extractHeadings("# A\n\n## B\n\n# C\n\n## D\n");
    expect(headingTrail(headings, 3).map((c) => c.siblings.map((s) => s.text))).toEqual([
      ["A", "C"],
      ["B"],
    ]);
  });

  test("parents a skipped level under the nearest shallower heading", () => {
    // "### C" (line 3) has no "##" above it, so "# A" is its parent — and the
    // later "## D" is a sibling of neither.
    const headings = extractHeadings("# A\n\n### C\n\n## D\n");
    const trail = headingTrail(headings, 3);
    expect(trail.map((c) => c.heading.text)).toEqual(["A", "C"]);
    expect(trail.at(-1)?.siblings.map((s) => s.text)).toEqual(["C"]);
  });

  test("roots the trail at the first heading when the plan does not start at level 1", () => {
    // "## A" 1, "### B" 3 — active is "### B".
    const headings = extractHeadings("## A\n\n### B\n");
    expect(headingTrail(headings, 3).map((c) => c.heading.text)).toEqual(["A", "B"]);
  });

  test("treats a flat plan as one level of siblings", () => {
    // "## A" 1, "## B" 3, "## C" 5 — active is "## B".
    const headings = extractHeadings("## A\n\n## B\n\n## C\n");
    const trail = headingTrail(headings, 3);
    expect(trail.map((c) => c.heading.text)).toEqual(["B"]);
    expect(trail[0]?.siblings.map((s) => s.text)).toEqual(["A", "B", "C"]);
  });

  test("terminates on a heading below level 1 rather than spinning", () => {
    // extractHeadings only ever emits levels 1-6, but the export accepts any
    // TocHeading[]: an unguarded pop loop hangs the UI thread on level 0 —
    // a frozen plan view rather than a wrong trail — so the guard is pinned here.
    const headings: TocHeading[] = [
      { level: 0, text: "A", line: 1 },
      { level: 2, text: "B", line: 3 },
    ];
    expect(headingTrail(headings, 3).map((c) => c.heading.text)).toEqual(["A", "B"]);
  });

  test("returns an empty trail for a plan with no headings", () => {
    expect(headingTrail([], 1)).toEqual([]);
  });

  test("returns an empty trail when no heading is active", () => {
    expect(headingTrail(extractHeadings("# A\n\n## B\n"), null)).toEqual([]);
  });

  test("returns an empty trail when the active line holds no heading", () => {
    expect(headingTrail(extractHeadings("# A\n\n## B\n"), 99)).toEqual([]);
  });
});
