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
 * Descendant, not child: an over-wide fenced block is re-parented into a card
 * (codeBlockScroll.ts), so its rows are no longer direct children of
 * [data-content]. Same shape as tagCodeBlockRows. */
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

/** The row's token that BEGINS at `startCol` and stays within `endCol`, or null
 * when none does. Tokens partition the line, so a running length locates the
 * boundary — and tokenChildren is what makes that partition the same sequence
 * whether the row is ordinary or has been split into table cells.
 *
 * Both bounds are required so a decoration never lands on a coarse token that
 * spans more than the path: one merely CONTAINING the reference starts too
 * early, and a collapsed link's prose token starts exactly at it but runs to the
 * end of the line, which would stretch the decoration across the whole sentence.
 * Nothing is returned rather than something misplaced when no token fits.
 *
 * The one definition of "the token that begins this reference": the tag pass
 * below places the glyph on it, and the hint badge anchors to it (refHint.ts,
 * EXC-1061), so the two can never point at different halves of a line. shiki
 * emits every token as a span element, hence the HTMLElement result. */
export function refTokenAt(rowEl: Element, startCol: number, endCol: number): HTMLElement | null {
  let col = 0;
  for (const token of tokenChildren(rowEl)) {
    const len = token.textContent?.length ?? 0;
    if (col === startCol) return col + len <= endCol ? (token as HTMLElement) : null;
    if (col > startCol) return null;
    col += len;
  }
  return null;
}

// Tags the reference's opening token so the override sheet draws the glyph
// immediately left of the filename; a reference whose token cannot be resolved
// gets no glyph rather than a misplaced one.
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
  refTokenAt(rowEl, startCol, endCol)?.setAttribute(
    FILE_REF_ATTR,
    kind === "directory" ? "directory" : "",
  );
}
