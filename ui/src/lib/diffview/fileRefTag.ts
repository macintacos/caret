// Marks the token that begins each resolved file reference so the override sheet
// (coreStyles.ts) can render the file icon before it (EXC-687). shiki emits the
// line as inline token spans with no classes, so — mirroring codeBlocks.ts's
// tagLanguageToken — the tokens are walked by accumulated text length to find
// the one covering a reference's start column, and that span is tagged
// data-file-ref. The library repaints rows (async highlight, content-key
// recreate), so the caller re-runs this via a MutationObserver.

import type { FileRefSpanMap } from "$lib/diffview/fileRefs.ts";

const FILE_REF_ATTR = "data-file-ref";

/** Tags the token span starting each file reference in `spanMap` with
 * data-file-ref, clearing any prior tags first. `root` is the source view's
 * shadow root (or any container holding the `[data-content] > [data-line]`
 * rows). Idempotent and safe to call on every repaint. */
export function tagFileRefTokens(root: ParentNode, spanMap: FileRefSpanMap): void {
  for (const stale of root.querySelectorAll(`[${FILE_REF_ATTR}]`)) {
    stale.removeAttribute(FILE_REF_ATTR);
  }
  for (const [line, spans] of spanMap) {
    const rowEl = root.querySelector(`[data-content] > [data-line="${line}"]`);
    if (rowEl === null) continue;
    for (const span of spans) {
      tagTokenAt(rowEl, span.startCol);
    }
  }
}

// Tags the direct-child token that BEGINS at `startCol`. Tokens partition the
// line, so a running length locates the boundary. Requiring the token to start
// exactly at the reference (not merely contain it) keeps the icon off a coarse
// token that spans more than the path — the icon then sits immediately left of
// the filename, or is omitted rather than misplaced when no token starts there.
function tagTokenAt(rowEl: Element, startCol: number): void {
  let col = 0;
  for (const token of rowEl.children) {
    if (col === startCol) {
      token.setAttribute(FILE_REF_ATTR, "");
      return;
    }
    if (col > startCol) return;
    col += token.textContent?.length ?? 0;
  }
}
