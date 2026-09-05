// The run of children a card takes from its column, shared by the two passes that move a
// range of rows into one: tables.ts and codeBlockScroll.ts.

/** A range's DIRECT children of one column, from its first keyed cell through its
 * last — the whole contiguous run, not just the keyed cells in it.
 *
 * Direct children because that is what the wrap path needs: `insertBefore` places the
 * card relative to a child of the column, and passing it a cell nested somewhere else
 * throws `NotFoundError`, which would escape the repaint pass and take every
 * decoration below this one with it. Returns `null` unless every one of `lines` is
 * present, unwrapped, and in order.
 *
 * The whole run because the library interleaves its own rows between a range's:
 * a comment on line N emits an annotation row right after N's row in the content
 * column and a `data-gutter-buffer` right after N's cell in the gutter
 * (FileRenderer.processFileResult). Moving only the keyed cells would strand those
 * behind the card, so a mid-range comment would render below the whole card. Taking
 * the run also keeps the two columns index-parallel by construction rather than by
 * two separately-derived lists happening to agree.
 *
 * Cheap: walked by sibling rather than queried per line — one query plus a walk of
 * the range's own length, where a query per row is what EXC-864 measured at ~2,800
 * selector matches per repaint. */
export function unwrappedSlice(column: Element, attr: string, lines: number[]): Element[] | null {
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (first === undefined || last === undefined) return null;
  const head = column.querySelector(`:scope > [${attr}="${first}"]`);
  if (head === null) return null;
  const slice: Element[] = [];
  const seenKeys: string[] = [];
  for (let el: Element | null = head; el !== null; el = el.nextElementSibling) {
    slice.push(el);
    const key = el.getAttribute(attr);
    if (key !== null) seenKeys.push(key);
    if (key !== String(last)) continue;
    if (seenKeys.length !== lines.length) return null;
    if (!seenKeys.every((k, i) => k === String(lines[i]))) return null;
    // Past the last row, take any comment anchored TO it: the library emits that row
    // after its own, so stopping at `last` would leave a comment on the range's final
    // row outside the card while one on any other row is inside it — two comments on
    // one card, drawn at two different widths. Nothing else can follow, since the run
    // is bounded by the range's own lines.
    while (
      el.nextElementSibling !== null &&
      !el.nextElementSibling.hasAttribute(attr) &&
      el.nextElementSibling.matches("[data-line-annotation], [data-gutter-buffer]")
    ) {
      el = el.nextElementSibling;
      slice.push(el);
    }
    return slice;
  }
  return null;
}
