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
  /** 1-based display line, kept so the token can be re-resolved after a repaint. */
  line: number;
  span: FileRefSpan;
  token: HTMLElement;
  /** Top-right of the token's FIRST client rect, in `.diff-plan` content coords. */
  top: number;
  left: number;
}

// Descendant, not child: an over-wide fenced block is re-parented into a card
// (codeBlockScroll.ts), the same shape tagFileRefTokens reads rows with.
const rowAt = (root: ShadowRoot, line: number): Element | null =>
  root.querySelector(`[data-content] [data-line="${line}"]`);

/**
 * The hint's token as it exists NOW, re-resolved against the live shadow DOM.
 *
 * The anchor holds the element it was measured against, and the library replaces
 * its rows on every repaint — a comment arriving, a theme switch, a fence
 * resolving its grammar all rewrite them without changing the container or the
 * content key. A detached element measures all zeros, which is what would park
 * the folder card in the viewport's corner (DiffPlanView guards the file
 * preview's stored token the same way). The measured element is the fallback,
 * for the case where the row is genuinely gone rather than replaced.
 */
export function refHintToken(host: HTMLElement | undefined, hint: RefHintAnchor): HTMLElement {
  const root = host?.shadowRoot;
  const row = root == null ? null : rowAt(root, hint.line);
  const live = row == null ? null : refTokenAt(row, hint.span.startCol, hint.span.endCol);
  return live ?? hint.token;
}

// A wrapped path has several client rects and one union bounding box spanning
// both fragments, whose top-right corner is a point the text never occupies —
// so the badge reads the FIRST rect and lands where the reference visibly
// begins. getBoundingClientRect is the fallback for an unrendered token, which
// has no client rects at all.
const firstRectReader: RectReader = (el) => {
  const r = el.getClientRects()[0] ?? el.getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
};

/**
 * Bring `current` up to date and pick anchors for any requested kind that has
 * none yet. The one entry point the view drives.
 *
 * Two jobs, and both have to keep happening rather than being done once:
 *
 * Coordinates are RE-DERIVED, never stored and trusted. They are content
 * coordinates, so scrolling alone cannot invalidate them — but anything above the
 * token changing height does, and plenty does after first paint: a web font
 * arriving, shiki repainting a row, an over-wide fenced block being re-parented
 * into its own card. A badge placed once then left alone drifts off its token by
 * however much the content above it settled.
 *
 * And a kind with no anchor yet keeps being looked for. The pick only ever
 * anchors to a reference ON SCREEN, so the file and the directory reference are
 * rarely both in view at the same moment — placing whichever arrives first and
 * stopping would leave the other kind untaught for the whole session.
 *
 * What is decided once and never revisited is WHICH reference a kind teaches on:
 * a hint already in `current` keeps its line and span, so scrolling past a later
 * reference never moves a badge onto it.
 */
export function syncRefHints(
  host: HTMLElement,
  scroller: HTMLElement,
  refs: FileRefSpanMap,
  kinds: readonly FileRefKind[],
  current: readonly RefHintAnchor[],
  read: RectReader = firstRectReader,
): RefHintAnchor[] {
  const kept: RefHintAnchor[] = [];
  for (const hint of current) {
    // A kind absent from `kinds` has been retired since the last sync; its badge
    // goes with it rather than being re-anchored.
    if (!kinds.includes(hint.kind)) continue;
    const token = refHintToken(host, hint);
    // The row is gone entirely (a plan switch mid-flight); drop rather than
    // freeze the badge over whatever now occupies those coordinates.
    if (!token.isConnected) continue;
    const at = anchorFor(token, scroller, read);
    kept.push({ ...hint, token, top: at.top, left: at.left });
  }
  const missing = kinds.filter((k) => !kept.some((h) => h.kind === k));
  if (missing.length === 0) return kept;
  return [...kept, ...pickRefHintAnchors(host, scroller, refs, missing, read)];
}

/**
 * The last token of the pill the reference is drawn as.
 *
 * A reference INSIDE a codespan — a backticked path, the repo's commonest
 * citation — gives up its own fill, inline padding and radius to the group
 * (coreStyles.ts § the citation carve-out): what the reader sees as one chip is
 * the opening backtick, the path, and the closing backtick, and only the group's
 * LAST member reaches the pill's right edge. Anchoring to the path token alone
 * parks the badge INSIDE the pill, short of the corner it means to mark.
 *
 * A standalone reference is its own pill — it keeps the chip's padding and
 * radius and carries no cite member — so this walks zero steps and returns it.
 */
function pillEnd(token: HTMLElement): HTMLElement {
  if (!token.hasAttribute("data-md-cite")) return token;
  let end = token;
  let next = end.nextElementSibling;
  while (next?.hasAttribute("data-md-cite") === true) {
    end = next as HTMLElement;
    next = next.nextElementSibling;
  }
  return end;
}

// The pill's top-right in the scroll container's content coordinates. The
// conversion mirrors copyAnchor: a row's content offset is its viewport edge
// minus the scroller's viewport edge, plus how far the content is scrolled.
function anchorFor(
  token: HTMLElement,
  scroller: HTMLElement,
  read: RectReader,
): { top: number; left: number } {
  const r = read(token);
  const end = pillEnd(token);
  const e = end === token ? r : read(end);
  // A pill that WRAPPED leaves its closing token on the next row, whose right
  // edge is a corner the path itself never reaches. The badge stays on the
  // fragment the path occupies rather than jumping a line.
  const right = Math.abs(e.top - r.top) < 1 ? e.right : r.right;
  const s = read(scroller);
  return {
    top: r.top - (s.top - scroller.scrollTop),
    left: right - (s.left - scroller.scrollLeft),
  };
}

/**
 * The first on-screen reference of each requested kind, in reading order, with
 * its top-right in the scroll container's content coordinates. At most one anchor
 * per kind: the hint teaches the affordance once, not once per path. Callers go
 * through syncRefHints; this is the choosing half on its own.
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
    const row = rowAt(root, line);
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
      anchors.push({ kind, line, span, token, ...anchorFor(token, scroller, read) });
      wanted.delete(kind);
      if (wanted.size === 0) return anchors;
    }
  }
  return anchors;
}
