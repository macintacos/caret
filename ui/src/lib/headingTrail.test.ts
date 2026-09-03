import { describe, expect, test } from "bun:test";

import {
  groupedHeadingMatches,
  type HeadingGroup,
  headingMatches,
  headingTrail,
  headingTree,
  visibleDepths,
} from "$lib/headingTrail.ts";
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
    expect(headingTrail(headings, 5).map((c) => c.siblings.map((s) => s.heading.text))).toEqual([
      ["A"],
      ["B", "E"],
      ["C", "D"],
    ]);
  });

  test("scopes siblings to one parent, so a same-level heading under another parent is excluded", () => {
    // "# A" 1, "## B" 3, "# C" 5, "## D" 7 — active is "## B", so "## D" is no sibling.
    const headings = extractHeadings("# A\n\n## B\n\n# C\n\n## D\n");
    expect(headingTrail(headings, 3).map((c) => c.siblings.map((s) => s.heading.text))).toEqual([
      ["A", "C"],
      ["B"],
    ]);
  });

  // The reach the bar's menus need (EXC-957): a sibling the reader is NOT on
  // carries its own subtree, so descending into it never leaves the surface.
  test("carries each sibling's own subtree, not just the branch the reader is on", () => {
    // "# A" 1, "## B" 3, "### C" 5, "## D" 7, "### E" 9 — active is "### C", so
    // "## D" is off the trail and its child "### E" is the unreachable case.
    const headings = extractHeadings("# A\n\n## B\n\n### C\n\n## D\n\n### E\n");
    const siblings = headingTrail(headings, 5)[1]?.siblings ?? [];
    expect(siblings.map((s) => s.heading.text)).toEqual(["B", "D"]);
    expect(siblings[1]?.children.map((c) => c.heading.text)).toEqual(["E"]);
  });

  test("parents a skipped level under the nearest shallower heading", () => {
    // "### C" (line 3) has no "##" above it, so "# A" is its parent. So is the
    // later "## D": siblinghood is one parent's children, not one ATX level, so
    // a plan that skips a level leaves no heading stranded off every menu.
    const headings = extractHeadings("# A\n\n### C\n\n## D\n");
    const trail = headingTrail(headings, 3);
    expect(trail.map((c) => c.heading.text)).toEqual(["A", "C"]);
    expect(trail.at(-1)?.siblings.map((s) => s.heading.text)).toEqual(["C", "D"]);
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
    expect(trail[0]?.siblings.map((s) => s.heading.text)).toEqual(["A", "B", "C"]);
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

// The whole hierarchy rather than one path through it: what lets the bar's menus
// recurse into a section the reader never opened (EXC-957).
describe("headingTree", () => {
  test("nests each heading under the heading enclosing it", () => {
    const headings = extractHeadings("# A\n\n## B\n\n### C\n\n## D\n");
    const tree = headingTree(headings);
    expect(tree.map((n) => n.heading.text)).toEqual(["A"]);
    expect(tree[0]?.children.map((n) => n.heading.text)).toEqual(["B", "D"]);
    expect(tree[0]?.children[0]?.children.map((n) => n.heading.text)).toEqual(["C"]);
  });

  test("roots every top-level heading, in document order", () => {
    expect(headingTree(extractHeadings("# A\n\n# B\n")).map((n) => n.heading.text)).toEqual([
      "A",
      "B",
    ]);
  });

  test("parents a skipped level under the nearest shallower heading", () => {
    // "### C" has no "##" above it, so it and the later "## D" are both A's.
    const tree = headingTree(extractHeadings("# A\n\n### C\n\n## D\n"));
    expect(tree[0]?.children.map((n) => n.heading.text)).toEqual(["C", "D"]);
  });

  test("roots a plan that does not start at level 1", () => {
    const tree = headingTree(extractHeadings("## A\n\n### B\n\n## C\n"));
    expect(tree.map((n) => n.heading.text)).toEqual(["A", "C"]);
    expect(tree[0]?.children.map((n) => n.heading.text)).toEqual(["B"]);
  });

  test("gives a heading with nothing under it no children", () => {
    expect(headingTree(extractHeadings("# A\n"))[0]?.children).toEqual([]);
  });

  test("returns nothing for a plan with no headings", () => {
    expect(headingTree([])).toEqual([]);
  });
});

// How much of the trail the row can hold. Measured widths come from the bar; the
// arithmetic over them is pure, so the collapse rule is testable without layout.
describe("visibleDepths", () => {
  test("shows every depth when the whole trail fits the row", () => {
    // 4 × 50 + 3 × 10 = 230, well inside 500.
    expect(visibleDepths([50, 50, 50, 50], 10, 30, 500)).toEqual([0, 1, 2, 3]);
  });

  test("elides the middle only once the trail outgrows the row", () => {
    // 230 > 200. The outermost (50), the marker (30) and the innermost (10 + 50)
    // cost 140, which leaves room for depth 2 (10 + 50) and none for depth 1.
    expect(visibleDepths([50, 50, 50, 50], 10, 30, 200)).toEqual([0, 2, 3]);
  });

  test("gives up more of the middle as the row tightens", () => {
    expect(visibleDepths([50, 50, 50, 50], 10, 30, 150)).toEqual([0, 3]);
  });

  test("keeps where the reader is even when the row cannot hold it", () => {
    expect(visibleDepths([50, 50, 50, 50], 10, 30, 10)).toEqual([0, 3]);
  });

  test("never elides a two-level trail, which has no middle to give up", () => {
    expect(visibleDepths([500, 500], 10, 30, 100)).toEqual([0, 1]);
  });

  test("weighs each depth's own width rather than counting levels", () => {
    // The same four levels the first case shows whole, at a width one long
    // heading pushes past the row: depth is unchanged, the measurement is not.
    expect(visibleDepths([50, 220, 50, 50], 10, 30, 300)).toEqual([0, 2, 3]);
  });

  test("returns nothing for an empty trail", () => {
    expect(visibleDepths([], 10, 30, 100)).toEqual([]);
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

// The filter the ToC popup renders (EXC-1103): the same matches `headingMatches`
// finds, gathered into runs that share an ancestor path, so the popup can spend
// one breadcrumb header on a path however many matches sit under it.
describe("groupedHeadingMatches", () => {
  // A group written as one line: the trail joined by ` › `, then its matches in
  // brackets. A group with no trail opens on the bracket, which is what the popup
  // renders headerless. Fixtures therefore keep brackets, commas, and the
  // separator out of their heading text — rendered here they are ambiguous, and
  // the mismatch reads as a bug in `groupedHeadingMatches` rather than in this
  // helper.
  const shape = (groups: HeadingGroup[]): string[] =>
    groups.map((group) => {
      const trail = group.trail.map((h) => h.text).join(" › ");
      return `${trail}[${group.matches.map((m) => m.text).join(", ")}]`;
    });

  test("collapses a match's whole ancestor chain into one trail, root-most first", () => {
    const headings = extractHeadings("# A\n\n## B\n\n### Target\n");
    expect(shape(groupedHeadingMatches(headings, "target"))).toEqual(["A › B[Target]"]);
  });

  test("gathers two matching siblings under a single shared trail", () => {
    // The reason the model groups at all: one header, two rows.
    const headings = extractHeadings("# A\n\n## Target one\n\n## Target two\n");
    expect(shape(groupedHeadingMatches(headings, "target"))).toEqual(["A[Target one, Target two]"]);
  });

  test("gives a match with no ancestors an empty trail", () => {
    // What the popup renders with no header above it at all.
    const headings = extractHeadings("# Target\n");
    expect(shape(groupedHeadingMatches(headings, "target"))).toEqual(["[Target]"]);
  });

  test("splits matches under different paths into their own groups", () => {
    const headings = extractHeadings(
      "# P\n\n## Setup\n\n### Setup notes\n\n## Roll\n\n### Roll notes\n",
    );
    expect(shape(groupedHeadingMatches(headings, "notes"))).toEqual([
      "P › Setup[Setup notes]",
      "P › Roll[Roll notes]",
    ]);
  });

  test("keeps two identically titled sections as separate groups", () => {
    // Keyed on the ancestor chain's position, not on its text: a text key would
    // merge these two "Details" sections into one header holding both matches.
    const headings = extractHeadings(
      "# A\n\n## Details\n\n### Target one\n\n# B\n\n## Details\n\n### Target two\n",
    );
    expect(groupedHeadingMatches(headings, "target").length).toBe(2);
  });

  test("does not pull a match's non-matching descendants in with it", () => {
    // The whole point of filtering: matching "Setup" must not re-admit the
    // section under it, which is what makes a filtered list shorter than the tree.
    const headings = extractHeadings("# Setup\n\n## Details\n");
    expect(shape(groupedHeadingMatches(headings, "setup"))).toEqual(["[Setup]"]);
  });

  test("groups a heading that both matches and encloses a match by its own path", () => {
    // "Setup" is a match at the root and the parent of another, so the two sit in
    // different groups rather than one nesting inside the other.
    const headings = extractHeadings("# Setup\n\n## Setup notes\n");
    expect(shape(groupedHeadingMatches(headings, "setup"))).toEqual([
      "[Setup]",
      "Setup[Setup notes]",
    ]);
  });

  test("carries an unmatched heading sitting between two matches in the trail", () => {
    // The shape a real plan produces most: the middle heading places the deep
    // match without being a match itself, so it survives only as a trail segment.
    const headings = extractHeadings("# Setup\n\n## Middle\n\n### Setup deep\n");
    expect(shape(groupedHeadingMatches(headings, "setup"))).toEqual([
      "[Setup]",
      "Setup › Middle[Setup deep]",
    ]);
  });

  test("leaves a non-matching heading that encloses no match out of every trail", () => {
    const headings = extractHeadings("# A\n\n## B\n\n## Target\n");
    expect(shape(groupedHeadingMatches(headings, "target"))).toEqual(["A[Target]"]);
  });

  test("orders groups, and the matches inside them, in document order", () => {
    const headings = extractHeadings("# A\n\n## Target\n\n# B\n\n## C\n\n# Target too\n");
    expect(shape(groupedHeadingMatches(headings, "target"))).toEqual(["A[Target]", "[Target too]"]);
  });

  test("gathers matches under one path even when other matches fall between them", () => {
    // What makes a group a SET rather than a run, and the model's most surprising
    // property: a query hitting both a section's title and its children puts both
    // titles in the single root group, so the rendered rows stop being one
    // document-ordered sequence — "B x" is drawn above "A x"'s own subsection,
    // and "A x" appears twice, once as a row and once as a header. One header per
    // path is what buys that. The common shape rather than a corner: any query
    // matching a heading and something beneath it lands here.
    const headings = extractHeadings("# A x\n\n## A deep x\n\n# B x\n\n## B deep x\n");
    expect(shape(groupedHeadingMatches(headings, "x"))).toEqual([
      "[A x, B x]",
      "A x[A deep x]",
      "B x[B deep x]",
    ]);
  });

  test("parents a skipped level under the nearest shallower heading", () => {
    // "### Target" has no "##" above it, so its trail is "# A" — the same parent
    // walk `headingTree` and `headingTrail` climb.
    const headings = extractHeadings("# A\n\n### Target\n");
    expect(shape(groupedHeadingMatches(headings, "target"))).toEqual(["A[Target]"]);
  });

  test("groups every heading by its own path for an empty query", () => {
    const headings = extractHeadings("# A\n\n## B\n\n### C\n");
    expect(shape(groupedHeadingMatches(headings, ""))).toEqual(["[A]", "A[B]", "A › B[C]"]);
  });

  test("treats a whitespace-only query as empty, as filterHeadings does", () => {
    const headings = extractHeadings("# A\n\n## B\n");
    expect(shape(groupedHeadingMatches(headings, "   "))).toEqual(["[A]", "A[B]"]);
  });

  test("matches case-insensitively on a substring, as the breadcrumbs filter does", () => {
    const headings = extractHeadings("# Verification\n");
    expect(shape(groupedHeadingMatches(headings, "RIFICA"))).toEqual(["[Verification]"]);
  });

  test("returns the heading objects it was handed, not copies", () => {
    // The popup keys rows on identity-derived values and EXC-1104 will mark
    // character offsets on these very objects; a mapped copy anywhere in the path
    // would leave both reading a different array than the caller holds.
    const headings = extractHeadings("# A\n\n## Target\n");
    const group = groupedHeadingMatches(headings, "target")[0];
    expect(group?.matches[0]).toBe(headings[1]);
    expect(group?.trail[0]).toBe(headings[0]);
  });

  test("returns nothing when no heading matches", () => {
    expect(groupedHeadingMatches(extractHeadings("# A\n\n## B\n"), "zzz")).toEqual([]);
  });

  test("returns nothing for a plan with no headings", () => {
    expect(groupedHeadingMatches([], "")).toEqual([]);
  });
});
