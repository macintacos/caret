// One-time discoverability for path references in the plan (EXC-1061). A tagged
// path token opens a preview on click — an excerpt for a file, the folder tree
// for a directory (EXC-918) — but the glyph alone doesn't say so, so the view
// badges ONE reference of each kind until the reviewer opens one, then never
// again. Dismissal is per kind: learning that a filename opens an excerpt does
// not teach that a directory opens the tree.
//
// Both halves live here because they are the same concern: which reference to
// teach on (the pick), and whether that kind still needs teaching (the flags).
// Kept pure so it unit-tests without mounting the view; the component owns the
// $effect scheduling and the badge itself.

import type { FileRefKind } from "@core/lib/types";
import { defineFlagPref, type Pref } from "$lib/definePref.ts";
import type { RectReader } from "$lib/diffview/codeCopy.ts";
import type { FileRefSpan, FileRefSpanMap } from "$lib/diffview/fileRefs.ts";
import { refTokenAt } from "$lib/diffview/fileRefTag.ts";

const FILE_KEY = "caret:diffview:file-ref-hint-dismissed";
const DIR_KEY = "caret:diffview:dir-ref-hint-dismissed";

// defineFlagPref registers each key for the `--fresh` reset (prefs.ts) and owns
// the never-throw fail-safe. onError: true means an unreadable store
// (storage-disabled or private mode) reports dismissed, so a hint is never
// re-nagged on every load. One flag per kind, so opening a file preview leaves
// the directory hint standing.
const prefs = {
  file: defineFlagPref(FILE_KEY, { onError: true }),
  directory: defineFlagPref(DIR_KEY, { onError: true }),
} satisfies Record<FileRefKind, Pref<boolean>>;

/** Whether the hint for this reference kind has already been dismissed.
 * Fail-safe: an unreadable store reports dismissed rather than nagging. */
export const isRefHintDismissed = (kind: FileRefKind): boolean => prefs[kind].read();

/** Records that the reviewer has opened a reference of this kind, so its hint
 * never shows again. A storage failure is swallowed — the hint simply
 * re-appears next session, never errors. */
export const dismissRefHint = (kind: FileRefKind): void => prefs[kind].write(true);

/** A reference the badge can teach on, with where to draw it. */
export interface RefHintAnchor {
  kind: FileRefKind;
  span: FileRefSpan;
  token: HTMLElement;
  /** Top-right of the token's FIRST client rect, in `.diff-plan` content coords. */
  top: number;
  left: number;
}

// A wrapped path has several client rects and one union bounding box spanning
// both fragments, whose top-right corner is a point the text never occupies —
// so the badge reads the FIRST rect and lands where the reference visibly
// begins. getBoundingClientRect is the fallback for an element with no client
// rects at all (an unrendered token, or happy-dom, which lays nothing out).
const firstRectReader: RectReader = (el) => {
  const r = el.getClientRects()[0] ?? el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
};

/**
 * The first on-screen reference of each requested kind, in reading order, with
 * its top-right in the scroll container's content coordinates — a badge placed
 * absolutely there sits at the reference's corner and scrolls with the rows.
 * At most one anchor per kind: the hint teaches the affordance once, not once
 * per path.
 *
 * Reading order is by line, so the keys are sorted numerically — the merged map
 * appends its link-emitted lines after the scanned ones (mergeFileRefSpans), so
 * insertion order is not line order. A reference whose row isn't rendered, whose
 * token can't be resolved, or which sits outside the scroller's viewport is
 * skipped: the badge only ever points at something the reviewer can see.
 */
export function pickRefHintAnchors(
  host: HTMLElement,
  scroller: HTMLElement,
  refs: FileRefSpanMap,
  kinds: readonly FileRefKind[],
  read: RectReader = firstRectReader,
): RefHintAnchor[] {
  const root = host.shadowRoot;
  if (root == null) return [];
  const wanted = new Set(kinds);
  const anchors: RefHintAnchor[] = [];
  const s = read(scroller);
  for (const line of [...refs.keys()].sort((a, b) => a - b)) {
    // Descendant, not child: an over-wide fenced block is re-parented into a
    // card (codeBlockScroll.ts), same shape as tagFileRefTokens reads.
    const row = root.querySelector(`[data-content] [data-line="${line}"]`);
    if (row == null) continue;
    for (const span of refs.get(line) ?? []) {
      const kind = span.kind;
      if (kind === undefined || !wanted.has(kind)) continue;
      const token = refTokenAt(row, span.startCol, span.endCol);
      if (token == null) continue;
      const r = read(token);
      if (r.bottom <= s.top || r.top >= s.bottom || r.right <= s.left || r.left >= s.right) {
        continue;
      }
      anchors.push({
        kind,
        span,
        token,
        top: r.top - (s.top - scroller.scrollTop),
        left: r.right - (s.left - scroller.scrollLeft),
      });
      wanted.delete(kind);
      if (wanted.size === 0) return anchors;
    }
  }
  return anchors;
}
