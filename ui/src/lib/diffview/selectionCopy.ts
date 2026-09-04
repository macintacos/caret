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
// Every character is already in the DOM in source order; the only thing wrong is
// where the browser decides a line ends. So the rebuild changes nothing but that:
// it concatenates the selection's own text and breaks where the enclosing ROW
// changes, which is exactly where a line ends in the source (EXC-855).

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
 * A blank source line carries no text at all — the library renders it as a row whose
 * only child is a `<br>` — so a walk over text alone would never reach it and the
 * blank line would drop out of the copy, the exact fusing this module exists to
 * prevent. The `<br>` the walk therefore also visits is a sound proxy for "blank
 * line" rather than a convenient one: the library emits one only for a token whose
 * text is empty, or for a line node with no children at all, and never anywhere else
 * inside a row.
 *
 * Nothing else in the fragment may open a row. A range that stops at the very start of
 * a row still encloses it, so `cloneContents()` brings that row back carrying only
 * whatever ancestor chain the endpoint sat in — an empty row, an empty token span, or
 * an empty text node. None of those stands for a line anyone selected, and all three
 * fall out for free: a span is not a `<br>`, and an empty text node is skipped
 * explicitly.
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
      if ((node as Element).tagName !== "BR") continue;
    } else if (node.nodeValue === "") {
      continue;
    }
    const row = node.parentElement?.closest(ROW) ?? null;
    if (previous !== undefined && row !== previous) text += "\n";
    previous = row;
    text += node.nodeValue ?? "";
  }
  return text;
}
