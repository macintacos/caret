// Heading hierarchy for the plan's breadcrumbs bar. `toc.ts` models the plan's
// headings as a flat list in document order; this module reads the tree that
// list implies — the ancestor chain enclosing the heading being read, and the
// headings each of those can be swapped for. Pure and DOM-free like `toc.ts`,
// so the parenting and sibling logic is directly unit-testable.

import type { TocHeading } from "$lib/toc.ts";

/** A heading in the trail, alongside the headings its menu can swap it for. */
export interface HeadingCrumb {
  heading: TocHeading;
  /**
   * Headings at the same level under the same parent, in document order.
   * Always contains `heading` itself.
   */
  siblings: TocHeading[];
}

// The parent of each heading, by index, or -1 for a heading with no ancestor.
// Walks a stack of the enclosing headings at strictly increasing levels: a
// heading pops every entry at or deeper than its own level, then belongs to
// whatever is left on top. Skipped levels need no special case — a `###` under
// a `#` finds the `#` because no `##` was ever pushed — and a plan that opens
// at `##` roots there because the stack is empty. The stack's own emptiness is
// what ends the pop loop: without that clause a heading below level 1 pops an
// already-empty stack forever, and `pop()` reports no error to break on.
function parentIndices(headings: TocHeading[]): number[] {
  const parents: number[] = [];
  const ancestors: { index: number; level: number }[] = [];
  for (const [index, heading] of headings.entries()) {
    while (ancestors.length > 0 && (ancestors.at(-1)?.level ?? 0) >= heading.level) ancestors.pop();
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
  let index = headings.findIndex((h) => h.line === activeLine);
  if (index === -1) return [];
  const parents = parentIndices(headings);
  const trail: HeadingCrumb[] = [];
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
