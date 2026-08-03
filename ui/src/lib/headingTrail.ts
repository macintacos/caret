// Heading hierarchy for the plan's breadcrumbs bar. `toc.ts` models the plan's
// headings as a flat list in document order; this module reads the tree that
// list implies — the ancestor chain enclosing the heading being read, and the
// headings each of those can be swapped for. Pure and DOM-free like `toc.ts`,
// so the parenting and sibling logic is directly unit-testable.

import type { TocHeading } from "$lib/toc.ts";

/** A heading in the trail, alongside the headings its menu can swap it for. */
export interface HeadingCrumb {
  /** The heading this crumb names. */
  heading: TocHeading;
  /**
   * Headings at the same level under the same parent, in document order.
   * Always contains `heading` itself.
   */
  siblings: TocHeading[];
}

// The parent of each heading, by index, or -1 for a heading with no ancestor.
// Walks a stack of the enclosing headings at strictly increasing levels: a
// heading pops every entry at or below its own level, then belongs to whatever
// is left on top. Skipped levels need no special case — a `###` under a `#`
// finds the `#` because no `##` was ever pushed — and a plan that opens at `##`
// roots there because the stack is empty. Every ATX level is >= 1, so the empty
// stack's 0 also ends the pop loop.
function parentIndices(headings: TocHeading[]): number[] {
  const parents: number[] = [];
  const ancestors: { index: number; level: number }[] = [];
  for (const [index, heading] of headings.entries()) {
    while ((ancestors.at(-1)?.level ?? 0) >= heading.level) ancestors.pop();
    parents.push(ancestors.at(-1)?.index ?? -1);
    ancestors.push({ index, level: heading.level });
  }
  return parents;
}

/**
 * The trail of headings enclosing `activeLine` — the ancestor chain from the
 * outermost heading down to the heading sitting on that line, each paired with
 * its siblings. `activeLine` is the line `activeHeadingLine` reports, so a null
 * one (nothing scrolled into view yet) and a line holding no heading both yield
 * an empty trail rather than throwing; a plan with no headings does too.
 */
export function headingTrail(headings: TocHeading[], activeLine: number | null): HeadingCrumb[] {
  const parents = parentIndices(headings);
  const trail: HeadingCrumb[] = [];
  let index = headings.findIndex((h) => h.line === activeLine);
  while (index !== -1) {
    const heading = headings[index];
    if (heading === undefined) break;
    const parent = parents[index] ?? -1;
    trail.unshift({
      heading,
      siblings: headings.filter(
        (h, i) => h.level === heading.level && (parents[i] ?? -1) === parent,
      ),
    });
    index = parent;
  }
  return trail;
}
