// Marks the token that begins each resolved path reference so the override sheet
// (coreStyles.ts) can render a glyph before it — a file or a folder, per the kind
// the span carries (EXC-687, kinds since EXC-918). shiki emits the
// line as inline token spans with no classes, so — mirroring codeBlocks.ts's
// tagLanguageToken — the tokens are walked by accumulated text length to find
// the one covering a reference's start column, and that span is tagged
// data-file-ref. The library repaints rows (async highlight, content-key
// recreate), so the caller re-runs this via a MutationObserver.

import type { FileRefKind } from "@core/lib/types";
import type { FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import { tokenChildren } from "$lib/diffview/rowTokens.ts";

const FILE_REF_ATTR = "data-file-ref";

/** Tags the token span starting each file reference in `spanMap` with
 * data-file-ref, clearing any prior tags first. `root` is the source view's
 * shadow root (or any container holding the `[data-content] [data-line]`
 * rows). Idempotent and safe to call on every repaint.
 *
 * Descendant, not child: an over-wide fenced block or a table is re-parented into
 * a card (codeBlockScroll.ts, tables.ts), so its rows are no longer direct
 * children of [data-content]. Same shape as tagCodeBlockRows. */
export function tagFileRefTokens(root: ParentNode, spanMap: FileRefSpanMap): void {
  for (const stale of root.querySelectorAll(`[${FILE_REF_ATTR}]`)) {
    stale.removeAttribute(FILE_REF_ATTR);
  }
  for (const [line, spans] of spanMap) {
    const rowEl = root.querySelector(`[data-content] [data-line="${line}"]`);
    if (rowEl === null) continue;
    for (const span of spans) {
      tagTokenAt(rowEl, span.startCol, span.endCol, span.kind);
    }
  }
}

// Tags the row's token that BEGINS at `startCol` and stays within `endCol`.
// Tokens partition the line, so a running length locates the boundary — and
// tokenChildren is what makes that partition the same sequence whether the row is
// ordinary or has been split into table cells.
// Both bounds are required so the icon never lands on a coarse token that spans
// more than the path: one merely CONTAINING the reference starts too early, and
// a collapsed link's prose token starts exactly at it but runs to the end of the
// line — tagging that would draw the glyph and the hover chip around the whole
// sentence. The icon sits immediately left of the filename, or is omitted rather
// than misplaced when no token fits.
//
// The kind rides on the attribute's VALUE rather than a second attribute, so
// `[data-file-ref]` — which every selector, hit-test and e2e probe already uses
// — keeps matching both kinds, and only the one rule that swaps the glyph names
// a value (coreStyles.ts). A file keeps the valueless attribute it has always
// had, so its markup is byte-identical to before kinds existed. The mapping
// lives here, in one place, rather than at the call site.
function tagTokenAt(
  rowEl: Element,
  startCol: number,
  endCol: number,
  kind: FileRefKind | undefined,
): void {
  const value = kind === "directory" ? "directory" : "";
  let col = 0;
  for (const token of tokenChildren(rowEl)) {
    const len = token.textContent?.length ?? 0;
    if (col === startCol) {
      if (col + len <= endCol) token.setAttribute(FILE_REF_ATTR, value);
      return;
    }
    if (col > startCol) return;
    col += len;
  }
}
