// The selection band on a carded row (EXC-865). @pierre/diffs owns [data-selected-line]
// — the amber drag-select band, and the composer's own highlight — and applies it in
// InteractionManager.renderSelection, which walks [data-content]'s DIRECT children and
// `continue`s past anything carrying no line index. A card carries none, so the library
// skips it whole and every row inside it goes unbanded: a gutter drag entirely within an
// overflowing fenced block marks nothing at all, and one that runs from prose into it
// stops dead at the card while the range readout keeps counting. The card is what causes
// the defect, not what is inside it.
//
// This pass re-applies the library's own marks inside each card, from the range caret
// already holds. It deliberately mirrors renderSelection's algorithm rather than
// inventing one: the same first/last/single vocabulary the sheet's rounding rules read,
// and the same hand-off of the trailing marker to an open comment's annotation row.
//
// Two properties it must have, both load-bearing:
//
//   - It NEVER writes a value that is already there. SourceView drives it from a
//     MutationObserver on data-selected-line, which is the only trigger that cannot
//     race the library's rAF-queued render.
//   - It stands down on a card whose gutter mirror has a different child count. That
//     divergence is the state renderSelection throws on, and painting into it would
//     leave the two columns disagreeing about which rows are banded.
//
// This pass is replayed from SourceView's repaint pass too, the same
// non-reactive-mirror shape tagCursorRow and paintSearchHighlights already use.

import { CARD_ATTR, GUTTER_CARD_ATTR } from "$lib/diffview/codeBlockScroll.ts";
import { TABLE_CARD_ATTR, TABLE_GUTTER_CARD_ATTR } from "$lib/diffview/tables.ts";

/** The card kinds that hide rows from renderSelection, each as its content/gutter
 * attribute pair. Two kinds and not one: a card is a card to this pass whatever made
 * it, and the pairs are what tie a content card to its own mirror — matching them by
 * key across kinds would band a table's rows from a code block's range. */
const CARD_KINDS: [content: string, gutter: string][] = [
  [CARD_ATTR, GUTTER_CARD_ATTR],
  [TABLE_CARD_ATTR, TABLE_GUTTER_CARD_ATTR],
];

/** An ascending, inclusive, 1-based line range. Ascending is this module's contract,
 * not its callers' — the library reports a gutter drag in gesture order, so SourceView
 * normalizes before calling in. */
export interface SelectedLines {
  start: number;
  end: number;
}

const SELECTED = "data-selected-line";

/** Writes `value` (or clears it, for `null`) only when it differs from what is there. */
function mark(el: Element | undefined, value: string | null): void {
  if (el === undefined) return;
  const current = el.getAttribute(SELECTED);
  if (value === null) {
    if (current !== null) el.removeAttribute(SELECTED);
  } else if (current !== value) {
    el.setAttribute(SELECTED, value);
  }
}

/** The marker a card child should carry in each column — `null` for none. The two
 * differ only where an open comment follows a banded row; see `markers`. */
type Marker = [content: string | null, gutter: string | null];

/**
 * The marker each child of a card should carry, by index.
 *
 * Follows InteractionManager.renderSelection's own branch, including where that is
 * asymmetric. Its parallel data-merge-conflict-actions case is left out: a source
 * view renders no merge conflicts, so there is nothing for it to match. A row inside
 * the range takes `single` / `first` / `last` / `""` in both columns; but where the
 * next child is the library's annotation row, the trailing marker moves onto it and
 * the CONTENT row alone is demoted — the gutter cell keeps what it had. Faithful
 * rather than tidied: the point of this pass is that a carded row and an uncarded one
 * are marked identically, so an inconsistency belongs upstream, not here.
 */
function markers(children: Element[], range: SelectedLines | null): Marker[] {
  const wanted: Marker[] = children.map(() => [null, null]);
  if (range === null) return wanted;
  const single = range.start === range.end;
  for (const [i, child] of children.entries()) {
    const attr = child.getAttribute("data-line");
    if (attr === null) continue;
    const line = Number(attr);
    if (line < range.start || line > range.end) continue;
    let trailing = single
      ? "single"
      : line === range.start
        ? "first"
        : line === range.end
          ? "last"
          : "";
    wanted[i] = [trailing, trailing];
    if (children[i + 1]?.hasAttribute("data-line-annotation") !== true) continue;
    if (single) {
      trailing = "last";
      wanted[i] = ["first", "single"];
    } else if (line === range.start) {
      trailing = "";
    } else if (line === range.end) {
      wanted[i] = ["", "last"];
    }
    wanted[i + 1] = [trailing, trailing];
  }
  return wanted;
}

/**
 * Re-applies the library's selection marks to the rows every card hides from it, for
 * the range caret currently holds (`null` clears the cards' share of the band).
 *
 * `root` is the source view's shadow root. Rows outside a card are the library's own
 * and are left untouched — this pass adds the half renderSelection cannot reach, and
 * the library's clear, a subtree query, still reaches back into the cards.
 */
export function paintCardSelection(root: ParentNode | null, range: SelectedLines | null): void {
  const content = root?.querySelector("[data-content]");
  const gutter = root?.querySelector("[data-gutter]");
  if (content == null || gutter == null) return;
  for (const [cardAttr, gutterAttr] of CARD_KINDS) {
    for (const card of content.querySelectorAll(`:scope > [${cardAttr}]`)) {
      const key = card.getAttribute(cardAttr) ?? "";
      const mirror = gutter.querySelector(`:scope > [${gutterAttr}="${key}"]`);
      if (mirror === null) continue;
      const rows = [...card.children];
      const cells = [...mirror.children];
      if (rows.length !== cells.length) continue;
      for (const [i, [inContent, inGutter]] of markers(rows, range).entries()) {
        mark(rows[i], inContent);
        mark(cells[i], inGutter);
      }
    }
  }
}
