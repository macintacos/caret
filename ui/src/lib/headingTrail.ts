// Heading hierarchy for the plan's navigation surfaces. `toc.ts` models the plan's
// headings as a flat list in document order; this module reads the tree that list
// implies — the whole nesting, the ancestor chain enclosing the heading being read, the
// filter results flat and gathered under their ancestor paths, and how much of the trail
// a row of a given width can hold. Pure and DOM-free like `toc.ts`.

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

/**
 * Every match sharing one ancestor path — however far apart in the document they
 * sit. A path gets exactly one group, so a group is a SET rather than a run: two
 * matches under the same path join it even when other matches fall between them.
 */
export interface HeadingGroup {
  /**
   * The headings enclosing every match here, root-most first. Empty for a match
   * with no ancestor, which the ToC popup renders with no header above it.
   */
  trail: TocHeading[];
  /** The matches under that path, in document order. Never empty. */
  matches: TocHeading[];
}

/** A heading the bar's filter matched, paired with the heading enclosing it. */
export interface HeadingMatch {
  heading: TocHeading;
  /** The enclosing heading's text, or null for a heading with no ancestor. */
  parent: string | null;
}

// The parent of each heading, by index, or -1 for a heading with no ancestor. Only an
// index already on the ancestor stack is ever handed back, which guarantees a parent's
// index is lower than its child's — the ordering every climb and tree build here relies
// on. The stack's own emptiness is what ends the pop loop: without that clause a heading
// below level 1 pops an already-empty stack forever, and `pop()` reports no error to
// break on.
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
 * The plan's headings as the tree their levels imply — the top-level headings, each
 * carrying the headings nested under it, all in document order.
 */
export function headingTree(headings: TocHeading[]): HeadingNode[] {
  return treeOver(headings, parentIndices(headings));
}

// The tree, given a parent walk the caller already has: `headingTrail` needs the same
// walk to climb the ancestor chain, so this way it pays for it once per scroll tick.
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
 * reports, so a null one (nothing scrolled into view yet) and a line holding no heading
 * both yield an empty trail rather than throwing.
 */
export function headingTrail(headings: TocHeading[], activeLine: number | null): HeadingCrumb[] {
  const active = headings.findIndex((h) => h.line === activeLine);
  if (active === -1) return [];
  const parents = parentIndices(headings);
  // Outermost first; every parent sits at a lower index than its child, so this
  // terminates.
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
 * Headings matching `query`, in document order, each carrying the text of the heading
 * enclosing it — what keeps two identically titled sections apart in a flat list.
 * Matching is `filterHeadings`', so an empty query returns every heading.
 */
export function headingMatches(headings: TocHeading[], query: string): HeadingMatch[] {
  const parents = parentIndices(headings);
  // Keyed on the source line, the handle the rest of this module and toc.ts already
  // identify a heading by.
  const parentText = new Map(
    headings.map((h, index) => [h.line, headings[parents[index] ?? -1]?.text ?? null]),
  );
  return filterHeadings(headings, query).map((heading) => ({
    heading,
    parent: parentText.get(heading.line) ?? null,
  }));
}

/**
 * The headings matching `query`, gathered by the ancestor path they share — so a
 * surface can spend ONE breadcrumb header on a path however many matches sit
 * under it, rather than a row per unmatched ancestor per match. A match brings
 * none of its own non-matching descendants, and a heading that both matches and
 * encloses a match is a match in its own group and a trail segment of the deeper
 * one. Matching is `filterHeadings`', so an empty query groups every heading by its own
 * path.
 *
 * **Groups are ordered by their first match, and matches within a group by document
 * position — which is not the same as the flattened rows being in document order.** A
 * query hitting both a section's title and its children puts every such title in one root
 * group, so a later title is rendered above an earlier title's subsection. That is the
 * price of one header per path.
 */
export function groupedHeadingMatches(headings: TocHeading[], query: string): HeadingGroup[] {
  const parents = parentIndices(headings);
  // Membership by reference: `filterHeadings` filters this very array, so it hands back
  // the same objects rather than copies. Deliberately not the source line
  // `headingMatches` keys on — these exports take any `TocHeading[]`, and two headings
  // sharing a line would collapse into one entry of a line-keyed set.
  const matches = new Set(filterHeadings(headings, query));
  // Keyed on the ancestor INDICES rather than on their text: two identically titled
  // sections enclose different matches and must stay different groups. Walking in
  // document order, `Map` insertion order is then what puts the groups in first-match
  // order.
  const groups = new Map<string, HeadingGroup>();
  for (const [index, heading] of headings.entries()) {
    if (!matches.has(heading)) continue;
    // Root-most first; every parent sits at a lower index than its child, so this
    // terminates.
    const chain: number[] = [];
    for (let i = parents[index] ?? -1; i !== -1; i = parents[i] ?? -1) chain.unshift(i);
    const key = chain.join(",");
    const group = groups.get(key);
    if (group !== undefined) {
      group.matches.push(heading);
      continue;
    }
    // Every link indexes a real heading (`parentIndices` only reports indices it
    // pushed), so the `?? []` drops nothing.
    groups.set(key, {
      trail: chain.flatMap((i) => headings[i] ?? []),
      matches: [heading],
    });
  }
  return [...groups.values()];
}
