// The token refinement every decoration pass over a rendered row shares. shiki paints
// a source line as a sequence of classless token spans whose text concatenates to the
// line, and inlineDecorate.ts and fileRefTag.ts both locate a token by walking the
// row's children and accumulating text length. This module owns how that sequence is
// refined so a pass can rely on the boundaries it needs being real element edges.

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
  for (const child of [...row.children]) {
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
