// Keeps the clipboard honest over a copied selection.
//
// Chromium's clipboard serializer reads the LAYOUT tree, and it decides where a
// line ends from the boxes it finds rather than from the source. On the plan
// surface it gets that wrong in one direction that matters: a blank source line
// renders as a row with no text in it, which generates no line box, so the
// serializer emits nothing at all for it — a copied selection spanning two
// paragraphs comes back with them fused, and the markdown a reviewer pastes back
// to the agent has lost every block boundary it was written with.
//
// The whole markdown epic (EXC-855) rests on the source characters surviving the
// render, and this is the one place where making that true takes code rather than
// restraint. Every character is already in the DOM in source order; the only thing
// wrong is where the browser decides a line ends. So the rebuild changes nothing
// but that: it concatenates the selection's own text and breaks where the
// enclosing ROW changes, which is exactly where a line ends in the source.
//
// This shipped first as EXC-864's tableCopy.ts, scoped to selections crossing a
// table cell (grid items are blockified, so the serializer broke a copied table at
// every cell). The tables came back out, and what remained was the half that was
// never about tables — so the cell condition went with them and the rebuild now
// runs for any selection, which is also what fixes the blank-line case above for
// the plans that never had a table in them.

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
 * browser's own serialization alone — which is the answer for an empty or collapsed
 * selection, and only for those.
 *
 * Reads the selection through `cloneContents()`, so the fragment is already clipped
 * to the range's endpoints and a partially-selected row keeps the ancestors the row
 * lookup needs.
 *
 * The walk visits ROWS as well as text, because a blank source line is rendered as a
 * row holding a single `<br>` and NO text node at all. Walking text alone would never
 * reach it, so it could neither contribute characters nor register as a row change —
 * and the blank line it stands for would drop out of the copy, which is the exact
 * fusing this module exists to prevent. A row that does carry text is unaffected: its
 * element is visited first and sets the boundary, and its text nodes then resolve to
 * that same row and add none.
 *
 * A row the clone brought back EMPTY is skipped, and the distinction is the whole
 * reason the check is on child nodes rather than on text. A range ending at the very
 * start of a row still encloses that row, so `cloneContents()` returns it with no
 * children at all — an artifact of where the drag stopped, not a line anyone selected.
 * A blank source line always brings its `<br>` along, so the two never look alike.
 */
export function selectionText(selection: Selection | null): string | null {
  if (selection === null || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const fragment = selection.getRangeAt(0).cloneContents();
  const walker = document.createTreeWalker(
    fragment,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  );
  let text = "";
  let previous: Element | null | undefined;
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      if (!element.matches(ROW) || element.childNodes.length === 0) continue;
      if (previous !== undefined && element !== previous) text += "\n";
      previous = element;
      continue;
    }
    const row = node.parentElement?.closest(ROW) ?? null;
    if (previous !== undefined && row !== previous) text += "\n";
    previous = row;
    text += node.textContent ?? "";
  }
  return text;
}
