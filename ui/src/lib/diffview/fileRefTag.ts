// Marks the token that begins each resolved file reference so the override sheet
// (coreStyles.ts) can render the file icon before it (EXC-687). shiki emits the
// line as inline token spans with no classes, so — mirroring codeBlocks.ts's
// tagLanguageToken — the tokens are walked by accumulated text length to find
// the one covering a reference's start column, and that span is tagged
// data-file-ref. The library repaints rows (async highlight, content-key
// recreate), so the caller re-runs this via a MutationObserver.

import type { FileRefSpanMap } from "./fileRefs.ts";

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

// Tags the direct-child token whose display columns cover `startCol`. Tokens
// partition the line, so a running length locates the one that owns the column.
function tagTokenAt(rowEl: Element, startCol: number): void {
  let col = 0;
  for (const token of rowEl.children) {
    const next = col + (token.textContent?.length ?? 0);
    if (startCol >= col && startCol < next) {
      token.setAttribute(FILE_REF_ATTR, "");
      return;
    }
    col = next;
  }
}
