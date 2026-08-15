import { describe, expect, test } from "bun:test";

import {
  type FilteredHeadingNode,
  filteredHeadingTree,
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

// The filter the ToC popup renders (EXC-1094): the same matches `headingMatches`
// finds, but left in the hierarchy, with the unmatched headings above them kept
// as the context that places them.
describe("filteredHeadingTree", () => {
  // A filtered tree written as nested text: a match is its own text, a heading
  // kept only to place a match below it is parenthesised — what the popup dims —
  // and children follow in brackets.
  const shape = (nodes: FilteredHeadingNode[]): string[] =>
    nodes.map((node) => {
      const text = node.matched ? node.heading.text : `(${node.heading.text})`;
      return node.children.length === 0 ? text : `${text} [${shape(node.children).join(", ")}]`;
    });

  test("keeps a match at its own depth, under its unmatched ancestors as context", () => {
    const headings = extractHeadings("# A\n\n## B\n\n### Target\n");
    expect(shape(filteredHeadingTree(headings, "target"))).toEqual(["(A) [(B) [Target]]"]);
  });

  test("does not pull a match's non-matching descendants in with it", () => {
    // The whole point of filtering: matching "Setup" must not re-admit the
    // section under it, which is what makes a filtered list shorter than the tree.
    const headings = extractHeadings("# Setup\n\n## Details\n");
    expect(shape(filteredHeadingTree(headings, "setup"))).toEqual(["Setup"]);
  });

  test("returns a heading that both matches and encloses a match as a match", () => {
    const headings = extractHeadings("# Setup\n\n## Setup notes\n");
    expect(shape(filteredHeadingTree(headings, "setup"))).toEqual(["Setup [Setup notes]"]);
  });

  test("leaves a context node's non-matching siblings out rather than dimming them", () => {
    // "## B" neither matches nor encloses a match, so it is absent — dimming it
    // would make the filtered list as long as the tree.
    const headings = extractHeadings("# A\n\n## B\n\n## Target\n");
    expect(shape(filteredHeadingTree(headings, "target"))).toEqual(["(A) [Target]"]);
  });

  test("keeps every branch that holds a match, in document order", () => {
    const headings = extractHeadings("# A\n\n## Target\n\n# B\n\n## C\n\n# Target too\n");
    expect(shape(filteredHeadingTree(headings, "target"))).toEqual(["(A) [Target]", "Target too"]);
  });

  test("parents a skipped level under the nearest shallower heading", () => {
    // "### Target" has no "##" above it, so its context is "# A" — the same
    // parent walk `headingTree` and `headingTrail` climb.
    const headings = extractHeadings("# A\n\n### Target\n");
    expect(shape(filteredHeadingTree(headings, "target"))).toEqual(["(A) [Target]"]);
  });

  test("returns the whole tree, every node matched, for an empty query", () => {
    const headings = extractHeadings("# A\n\n## B\n\n### C\n");
    expect(shape(filteredHeadingTree(headings, ""))).toEqual(["A [B [C]]"]);
  });

  test("returns the whole tree, every node matched, for a whitespace-only query", () => {
    // `filterHeadings` trims before matching; the popup's search field must not
    // empty the list on a stray space.
    const headings = extractHeadings("# A\n\n## B\n");
    expect(shape(filteredHeadingTree(headings, "   "))).toEqual(["A [B]"]);
  });

  test("matches case-insensitively on a substring, as the breadcrumbs filter does", () => {
    const headings = extractHeadings("# Verification\n");
    expect(shape(filteredHeadingTree(headings, "RIFICA"))).toEqual(["Verification"]);
  });

  test("returns nothing when no heading matches", () => {
    expect(filteredHeadingTree(extractHeadings("# A\n\n## B\n"), "zzz")).toEqual([]);
  });

  test("returns nothing for a plan with no headings", () => {
    expect(filteredHeadingTree([], "")).toEqual([]);
  });
});
