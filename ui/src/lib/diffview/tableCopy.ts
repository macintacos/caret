// Keeps the clipboard honest over a rendered table (EXC-864).
//
// A table's cells are grid items, and grid items are blockified — so Chromium's
// clipboard serializer emits a newline at every cell boundary and a copied table
// comes back shattered, one fragment per cell. Nothing in CSS turns that off: the
// serializer reads the layout tree, and a cell has to be a grid item for the
// columns to align at all. So the text is rebuilt here instead.
//
// The whole epic rests on the source characters surviving the render, and this is
// the one place where making that true takes code rather than restraint. Every
// character is already in the DOM in source order; the only thing wrong is where
// the browser decides a line ends. So the rebuild changes nothing but that: it
// concatenates the selection's own text and breaks only where the enclosing ROW
// changes, which is exactly where a line ends in the source.
//
// It stands down (returns null) whenever the selection touches no table cell, and
// that is deliberate rather than an optimization. Copy everywhere else in the view
// already works, so the browser keeps it — this can only affect a selection that
// crosses a cell boundary, which is the only selection it can fix.

import { CELL_ATTR } from "$lib/diffview/rowTokens.ts";

// What counts as one line of output: a content row, or a gutter number cell. The
// gutter is in the list because a drag can cross into it and its cells are not
// [data-line] rows — without them here, consecutive line numbers would run together.
const ROW = `[data-line], [data-column-number]`;

/** `ShadowRoot.getSelection()` is a Chromium extension — caret renders in Chromium,
 * but the DOM lib does not declare it — so it is reached through a narrow structural
 * type rather than a cast at the call site. It has to be the shadow root's own
 * selection: the document-level one is RETARGETED to the host, so its range spans
 * the whole view and cloning it would return the entire plan. The fallback is for an
 * engine without the extension, where the document selection is the real one. */
type SelectionRoot = ShadowRoot & { getSelection?: () => Selection | null };

/** The live selection inside `root`, or the document's when `root` is absent. */
export function selectionIn(root: ShadowRoot | null | undefined): Selection | null {
  return (root as SelectionRoot | null | undefined)?.getSelection?.() ?? document.getSelection();
}

/**
 * The text `selection` should place on the clipboard, or `null` to leave the
 * browser's own serialization alone.
 *
 * Returns a string only when the selection spans a table cell boundary, which is
 * the only case the browser gets wrong. Reads the selection through
 * `cloneContents()`, so the fragment is already clipped to the range's endpoints
 * and partially-selected rows keep the ancestors the row lookup needs.
 */
export function tableSelectionText(selection: Selection | null): string | null {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const fragment = selection.getRangeAt(0).cloneContents();
  // No cell element in the fragment means the selection sits inside a single cell
  // (or outside any table): no boundary was crossed, so no newline was invented.
  if (fragment.querySelector(`[${CELL_ATTR}]`) === null) return null;

  const walker = document.createTreeWalker(fragment, NodeFilter.SHOW_TEXT);
  let text = "";
  let previous: Element | null | undefined;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const row = node.parentElement?.closest(ROW) ?? null;
    if (previous !== undefined && row !== previous) text += "\n";
    previous = row;
    text += node.textContent ?? "";
  }
  return text;
}
