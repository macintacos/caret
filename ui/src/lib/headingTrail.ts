// Heading hierarchy for the plan's navigation surfaces. `toc.ts` models the
// plan's headings as a flat list in document order; this module reads the tree
// that list implies — the whole nesting, the ancestor chain enclosing the
// heading being read, the flat filter results the breadcrumbs bar offers over
// the plan, that same filter left nested for the ToC popup, and how much of the
// trail a row of a given width can hold. Pure and DOM-free like `toc.ts`, so the
// parenting, sibling, match, and collapse logic is directly unit-testable.

import { filterHeadings, type TocHeading } from "$lib/toc.ts";

/** A heading with the headings nested under it, in document order. */
export interface HeadingNode {
  heading: TocHeading;
  /** Headings enclosed by this one, empty for a heading with nothing under it. */
  children: HeadingNode[];
}

/** A heading in the trail, paired with the headings it can be swapped for. */
export interface HeadingCrumb {
  heading: TocHeading;
  /**
   * Headings at the same level under the same parent, in document order, each
   * carrying its own subtree. Always contains `heading` itself. The subtrees are
   * what let the bar's menus descend into a section the reader is not in.
   */
  siblings: HeadingNode[];
}

/** A heading in a filtered tree, and whether it is a match or context for one. */
export interface FilteredHeadingNode {
  heading: TocHeading;
  /** False for a heading kept only to place a match nested under it. */
  matched: boolean;
  /** Matches and context nested under this one, in document order. */
  children: FilteredHeadingNode[];
}

/** A heading the bar's filter matched, paired with the heading enclosing it. */
export interface HeadingMatch {
  heading: TocHeading;
  /** The enclosing heading's text, or null for a heading with no ancestor. */
  parent: string | null;
}

// The parent of each heading, by index, or -1 for a heading with no ancestor.
// Walks a stack of the enclosing headings at strictly increasing levels: a
// heading pops every entry at or deeper than its own level, then belongs to
// whatever is left on top. Only an index already on that stack is ever handed
// back, which is what guarantees a parent's index is lower than its child's —
// the ordering every tree build here relies on. Skipped levels need no special
// case — a `###` under
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
 * The plan's headings as the tree their levels imply — the top-level headings,
 * each carrying the headings nested under it, all in document order. Built off
 * the one `parentIndices` walk every view in this module climbs, so they can
 * never disagree about what encloses what.
 */
export function headingTree(headings: TocHeading[]): HeadingNode[] {
  return treeOver(headings, parentIndices(headings));
}

// The tree, given a parent walk the caller already has. Split out so
// `headingTrail` — which needs the same walk to climb the ancestor chain — pays
// for it once rather than twice on every scroll tick.
function treeOver(headings: TocHeading[], parents: number[]): HeadingNode[] {
  const nodes: HeadingNode[] = headings.map((heading) => ({ heading, children: [] }));
  const roots: HeadingNode[] = [];
  for (const [index, node] of nodes.entries()) {
    (nodes[parents[index] ?? -1]?.children ?? roots).push(node);
  }
  return roots;
}

/**
 * The trail of headings enclosing `activeLine` — the ancestor chain from the
 * outermost heading down to the heading sitting on that line, each paired with
 * its siblings and their subtrees. `activeLine` is the line `activeHeadingLine`
 * reports, so a null one (nothing scrolled into view yet) and a line holding no
 * heading both yield an empty trail rather than throwing; a plan with no
 * headings does too.
 */
export function headingTrail(headings: TocHeading[], activeLine: number | null): HeadingCrumb[] {
  const active = headings.findIndex((h) => h.line === activeLine);
  if (active === -1) return [];
  const parents = parentIndices(headings);
  // The ancestor indices, outermost first. Every parent sits at a lower index
  // than its child, so the climb terminates.
  const chain: number[] = [];
  for (let index = active; index !== -1; index = parents[index] ?? -1) chain.unshift(index);
  const trail: HeadingCrumb[] = [];
  let siblings = treeOver(headings, parents);
  for (const index of chain) {
    const heading = headings[index];
    if (heading === undefined) break;
    trail.push({ heading, siblings });
    siblings = siblings.find((n) => n.heading.line === heading.line)?.children ?? [];
  }
  return trail;
}

/**
 * The trail depths a row `avail` px wide can show, ascending. Every depth when
 * the whole trail fits; otherwise the outermost depth, then as many of the
 * innermost depths as the room left holds once the elision marker is placed —
 * never fewer than the innermost, which is where the reader is.
 *
 * Widths are the natural width of each depth's crumb; `separator` is one
 * separator plus the gaps around it, and `marker` is what inserting the elision
 * marker costs, its own separator included. All in CSS px, measured by the bar.
 */
export function visibleDepths(
  widths: number[],
  separator: number,
  marker: number,
  avail: number,
): number[] {
  const every = widths.map((_, index) => index);
  // Two levels have no middle to give up, so they only ever truncate.
  if (widths.length < 3) return every;
  const whole = widths.reduce((sum, w) => sum + w, 0) + separator * (widths.length - 1);
  if (whole <= avail) return every;
  const last = widths.length - 1;
  let used = (widths[0] ?? 0) + marker + separator + (widths[last] ?? 0);
  const tail = [last];
  for (let depth = last - 1; depth >= 1; depth--) {
    const cost = separator + (widths[depth] ?? 0);
    if (used + cost > avail) break;
    used += cost;
    tail.unshift(depth);
  }
  return [0, ...tail];
}

/**
 * Headings matching `query`, in document order, each carrying the text of the
 * heading enclosing it. Matching is `filterHeadings`' — case-insensitive
 * substring over the whole plan, so an empty query returns every heading — and
 * the parent comes from the same walk `headingTrail` climbs, so the two views
 * of the hierarchy can never disagree. The parent is what keeps two identically
 * titled sections apart in a flat list.
 */
export function headingMatches(headings: TocHeading[], query: string): HeadingMatch[] {
  const parents = parentIndices(headings);
  // Keyed on the source line, the handle the rest of this module and toc.ts
  // already identify a heading by.
  const parentText = new Map(
    headings.map((h, index) => [h.line, headings[parents[index] ?? -1]?.text ?? null]),
  );
  return filterHeadings(headings, query).map((heading) => ({
    heading,
    parent: parentText.get(heading.line) ?? null,
  }));
}

/**
 * The headings matching `query`, left in the hierarchy rather than flattened:
 * every match at its own depth, and above it the unmatched headings needed to
 * place it, marked as context so the surface can dim them. A match brings none
 * of its own non-matching descendants, and a heading that both matches and
 * encloses a match comes back a match. Matching is `filterHeadings`', so an
 * empty query returns the whole tree with everything matched, and the parenting
 * is the one `parentIndices` walk every view in this module climbs.
 */
export function filteredHeadingTree(headings: TocHeading[], query: string): FilteredHeadingNode[] {
  const parents = parentIndices(headings);
  // Membership by reference: `filterHeadings` filters this very array, so it
  // hands back the same objects rather than copies. Deliberately not the source
  // line `headingMatches` keys on — these exports take any `TocHeading[]`, and
  // two headings sharing a line would collapse into one entry of a line-keyed
  // set.
  const matches = new Set(filterHeadings(headings, query));
  // A heading survives if it matched, or if a match sits somewhere beneath it.
  // Climbing from each match stops at the first ancestor already kept — every
  // ancestor above that one was kept on the same pass that added it.
  const kept = new Set<number>();
  for (const [index, heading] of headings.entries()) {
    if (!matches.has(heading)) continue;
    for (let i = index; i !== -1 && !kept.has(i); i = parents[i] ?? -1) kept.add(i);
  }
  // Every kept heading's ancestors are kept too, and a parent sits at a lower
  // index than its child as `parentIndices` guarantees, so each node's parent is
  // already built by the time the node reaches it.
  const nodes = new Map<number, FilteredHeadingNode>();
  const roots: FilteredHeadingNode[] = [];
  for (const [index, heading] of headings.entries()) {
    if (!kept.has(index)) continue;
    const node: FilteredHeadingNode = { heading, matched: matches.has(heading), children: [] };
    nodes.set(index, node);
    (nodes.get(parents[index] ?? -1)?.children ?? roots).push(node);
  }
  return roots;
}
