import { describe, expect, test } from "bun:test";

import { headingMatches, headingTrail } from "$lib/headingTrail.ts";
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

  test("stops at the active heading rather than descending into its children", () => {
    // "## B" (line 3) encloses "### C" — the most common reading position, and
    // the one shape where a walk that ran past the active heading still looks
    // right in every other fixture.
    const headings = extractHeadings("# A\n\n## B\n\n### C\n");
    expect(headingTrail(headings, 3).map((c) => c.heading.text)).toEqual(["A", "B"]);
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

// The flat side of the same tree: where headingTrail answers "what encloses the
// heading I am reading", these answer "which headings match, and what encloses
// each of them" — the bar's filter, which spans the whole plan rather than one
// level's siblings.
describe("headingMatches", () => {
  test("returns every heading in document order for an empty query", () => {
    const headings = extractHeadings("# A\n\n## B\n\n### C\n");
    expect(headingMatches(headings, "").map((m) => m.heading.text)).toEqual(["A", "B", "C"]);
  });

  test("matches across levels rather than one level's siblings", () => {
    // "Setup" sits at level 1 and "Setup notes" at level 3 under a different
    // branch: a filter scoped to one level could never return both.
    const headings = extractHeadings("# Setup\n\n## Build\n\n### Setup notes\n");
    expect(headingMatches(headings, "setup").map((m) => m.heading.text)).toEqual([
      "Setup",
      "Setup notes",
    ]);
  });

  test("names each match's enclosing heading", () => {
    const headings = extractHeadings("# A\n\n## B\n\n### C\n");
    expect(headingMatches(headings, "c")).toEqual([
      { heading: { level: 3, text: "C", line: 5 }, parent: "B" },
    ]);
  });

  test("distinguishes identically titled headings by their parent", () => {
    // The case the bar exists to survive: two "Details" sections that a flat
    // list would otherwise render as the same row twice.
    const headings = extractHeadings("# A\n\n## Details\n\n# B\n\n## Details\n");
    expect(headingMatches(headings, "details").map((m) => m.parent)).toEqual(["A", "B"]);
  });

  test("reports no parent for a heading with no ancestor", () => {
    expect(headingMatches(extractHeadings("# A\n\n## B\n"), "a")[0]?.parent).toBeNull();
  });

  test("matches case-insensitively on a substring", () => {
    const headings = extractHeadings("# Verification\n");
    expect(headingMatches(headings, "RIFICA").map((m) => m.heading.text)).toEqual(["Verification"]);
  });

  test("returns nothing when no heading matches", () => {
    expect(headingMatches(extractHeadings("# A\n\n## B\n"), "zzz")).toEqual([]);
  });

  test("returns nothing for a plan with no headings", () => {
    expect(headingMatches([], "")).toEqual([]);
  });
});
