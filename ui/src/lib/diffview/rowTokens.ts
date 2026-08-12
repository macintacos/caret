// The token walk every decoration pass over a rendered row shares. shiki paints a
// source line as a sequence of classless token spans whose text concatenates to the
// line, and inlineDecorate.ts, fileRefTag.ts and tables.ts all locate a token by
// walking that sequence and accumulating text length. This module owns what "that
// sequence" means and how it is refined.
//
// It exists because a table row (EXC-864) groups its tokens into cell elements, so
// the sequence sits one level down for those rows and at the top level for every
// other. Both halves live here so no pass has to know which kind of row it is
// looking at, and so tables.ts can refine a row without importing the pass that
// decorates it — the import that would otherwise be a cycle.

/** Marks a table cell. Declared here rather than in tables.ts because it is what
 * `tokenChildren` reads: a pass recognises a celled row without depending on the
 * module that built it. */
export const CELL_ATTR = "data-table-cell";

/**
 * A row's token elements in column order: its own children, or — when the row has
 * been split into table cells — the cells' children concatenated. Their text
 * concatenates to the row's text either way, which is the invariant every caller's
 * running-length arithmetic rests on.
 */
export function tokenChildren(row: Element): Element[] {
  const cells = row.querySelectorAll(`:scope > [${CELL_ATTR}]`);
  if (cells.length === 0) return [...row.children];
  return [...cells].flatMap((cell) => [...cell.children]);
}

/**
 * Replaces every token a cut falls strictly inside with one clone per piece, so no
 * token straddles a boundary. A token with no interior cut is left as-is — the
 * idempotency guarantee, and not a nicety: SourceView.svelte runs these passes from
 * a `MutationObserver` watching childList over the whole subtree, so a pass that
 * re-split a settled row would loop forever.
 *
 * It SPLITS ONLY, and never merges. Merging would be the obvious way to make one
 * element out of one run, and it is wrong twice over: shiki colours the markers and
 * the content of an emphasis span as different tokens, so fusing them throws away
 * the marker ink the theme deliberately dims; and every walk built on this locates a
 * token by accumulating text length, so a coarser partition can hide a boundary one
 * of them needs. Splitting only ever refines, so every boundary shiki drew survives.
 *
 * A token holding elements of its own is skipped defensively; a shiki token holds a
 * single text node, so there is no known trigger. The landing if one ever appears is
 * silence rather than breakage: the token keeps straddling a boundary and the
 * caller's covering-run lookup simply finds none.
 */
export function splitTokens(row: Element, cuts: number[]): void {
  let col = 0;
  for (const child of tokenChildren(row)) {
    const text = child.textContent ?? "";
    const end = col + text.length;
    const inside = cuts.filter((cut) => cut > col && cut < end);
    if (inside.length > 0 && child.childElementCount === 0) {
      const bounds = [col, ...inside, end];
      child.replaceWith(
        ...bounds.slice(0, -1).map((from, i) => {
          // cloneNode(false) carries the token's inline style and attributes, so
          // the pieces are indistinguishable from the token they replace.
          const piece = child.cloneNode(false) as Element;
          piece.textContent = text.slice(from - col, (bounds[i + 1] ?? end) - col);
          return piece;
        }),
      );
    }
    col = end;
  }
}
