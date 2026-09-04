// Deterministic feedback formatting. The result is sent verbatim as the
// `deny.message` the model reads when changes are requested, so the shape must
// be stable and readable: an optional general comment, then a numbered list of
// inline comments. Both shapes cite an abbreviated quote — the selection's first
// and last few words around an ellipsis — so the agent can locate the feedback by
// content without the full selection's token cost. A legacy annotation cites it
// inline; a line-anchored annotation pairs it with the annotation's 1-based line
// reference. A feedback line reference indexes the plan version caret stored, and the
// abbreviated quote paired with it is what the agent matches against its own text. So it
// finds the feedback even when its own line numbering differs.
// (Pinned across its three surfaces by test/structure/line-anchor-claim.test.ts.)

import {
  type Annotation,
  isLegacyAnnotation,
  isLineAnnotation,
  type PlanVersion,
} from "@core/lib/types";
import { type ComposerScratch, rangeLabel } from "$lib/diffview/commenting.ts";
import type { DiffSide } from "$lib/diffview/types.ts";

function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** The "Line N" / "Lines N-M" header for a line-anchored annotation. */
function lineHeader(startLine: number, endLine: number): string {
  return startLine === endLine ? `Line ${startLine}:` : `Lines ${startLine}-${endLine}:`;
}

/** The source lines a line-anchored annotation spans, sliced 1-based and
 * inclusive from the plan text. Returns [] when the range falls past the end of
 * the text (a stale anchor), so the entry degrades to its reference with no
 * quote block rather than throwing. */
function quotedLines(startLine: number, endLine: number, planLines: string[]): string[] {
  return planLines.slice(startLine - 1, endLine);
}

/** The source lines a line-anchored comment spans, sliced 1-based and inclusive
 * from the plan text — the exact code the reviewer commented against. Returns []
 * for a stale anchor past the end of the text (nothing to show). The dialog's
 * inline-comment "Context" disclosure renders these so the reviewer sees the
 * lines without leaving the modal (EXC-762). */
export function sourceLines(startLine: number, endLine: number, planText: string): string[] {
  return quotedLines(startLine, endLine, planText.split("\n"));
}

const QUOTE_HEAD_WORDS = 3;
const QUOTE_TAIL_WORDS = 3;

/** Abbreviates a quote to the line reference's companion: first and last few words
 * around an ellipsis. The agent already holds the plan, so the elided middle would
 * only add tokens — the head and tail are what it matches on. A quote short enough
 * that abbreviation would drop no words is returned whole. */
function abbreviate(text: string): string {
  const flat = flatten(text);
  const words = flat.split(" ");
  if (words.length <= QUOTE_HEAD_WORDS + QUOTE_TAIL_WORDS) return flat;
  const head = words.slice(0, QUOTE_HEAD_WORDS).join(" ");
  const tail = words.slice(-QUOTE_TAIL_WORDS).join(" ");
  return `${head} … ${tail}`;
}

/** Renders one annotation (comment already trimmed and non-blank) as a numbered
 * entry. Legacy annotations stay on one line; line-anchored ones span a header,
 * a single abbreviated quote line, and the comment, each continuation line
 * indented under the number. The quote line is omitted when the range is a stale
 * anchor with nothing to quote. */
function entry(a: Annotation, n: number, planLines: string[]): string {
  if (isLegacyAnnotation(a)) {
    return `${n}. On "${abbreviate(a.quote)}": ${a.comment.trim()}`;
  }
  const lines = [`${n}. ${lineHeader(a.startLine, a.endLine)}`];
  const quote = abbreviate(quotedLines(a.startLine, a.endLine, planLines).join(" "));
  if (quote) lines.push(`   > ${quote}`);
  lines.push(`   ${a.comment.trim()}`);
  return lines.join("\n");
}

/** The annotations that carry a non-blank comment — the inline feedback that
 * actually reaches the agent. The one predicate every surface counts pending
 * inline comments by, so the approve guard, the request-changes summary, and the
 * formatted feedback never disagree about which comments are "pending". */
export function pendingInline(annotations: Annotation[]): Annotation[] {
  return annotations.filter((a) => a.comment.trim().length > 0);
}

/** How many inline comments are pending (non-blank), for the surfaces that show
 * the count without formatting the feedback. */
export function pendingInlineCount(annotations: Annotation[]): number {
  return pendingInline(annotations).length;
}

/** One line in the approve/reject guard's preview of unsent feedback: a short
 * anchor label and the comment/draft text. */
export interface PendingItem {
  /** Short anchor: "General", "Line N", "Lines N–M", or a legacy quote. */
  label: string;
  /** The comment / draft text, trimmed. */
  text: string;
}

/** Everything a plain Approve would silently leave behind, as a flat preview
 * list: the general-comment draft first, then the non-blank committed inline
 * comments, then the retained-but-unsent composer scratches. The guard renders
 * this so the reviewer sees what is at stake, and App.svelte's pendingCount is
 * this list's length — so the count and the preview can never disagree about
 * what's pending. Scratch text arrives already trimmed (the controller keeps a
 * scratch only when its trimmed text is non-empty). */
export function pendingItems(
  annotations: Annotation[],
  generalComment: string,
  scratches: ComposerScratch[],
): PendingItem[] {
  const items: PendingItem[] = [];
  const general = generalComment.trim();
  if (general) items.push({ label: "General", text: general });
  for (const a of pendingInline(annotations)) {
    const label = isLineAnnotation(a)
      ? rangeLabel(a.startLine, a.endLine)
      : abbreviate(a.quote) || "Comment";
    items.push({ label, text: a.comment.trim() });
  }
  for (const s of scratches) {
    items.push({ label: rangeLabel(s.startLine, s.endLine), text: s.text });
  }
  return items;
}

/** A comment as a navigable index entry for the comment navigator: the id to
 * focus, the source line to scroll to (its endLine, where the annotation thread
 * or scratch marker renders), a short range label, and the trimmed text. */
export interface CommentIndexEntry {
  /** The annotation id (a committed comment) or the scratch key (a draft) —
   * focusing it highlights the card in the source view; a scratch key focuses
   * nothing, so a draft reveal just scrolls to its marker. */
  id: string;
  /** 1-based source line the entry anchors to (its endLine). Absent on a general
   * entry, which is feedback about the version as a whole and anchors nowhere. */
  line?: number;
  /** "Line N" / "Lines N–M", or "" for a general entry, which spans no range. */
  label: string;
  /** The comment/draft text, trimmed. */
  text: string;
  /** True for an unsent composer scratch — a draft the reviewer typed but never
   * committed as a comment. The navigator marks these distinctly. */
  draft: boolean;
  /** Whether this entry addresses a document the view is currently rendering.
   * Always true in the single-version index; in the compare index, true only for
   * the two versions actually rendered, so a comment from a version in the range
   * but off screen lists as a non-interactive row. A linkable entry can still
   * fail to scroll — see scrollToDiffLine's collapsed-band ceiling. */
  linkable: boolean;
  /** Which of the compared diff's two documents this entry's version renders as.
   * Compare index only, and only on the two endpoints — a line number alone is
   * ambiguous across two documents, so the reveal needs the side to disambiguate. */
  side?: DiffSide;
  /** True for the version's general comment — unanchored feedback the reviewer
   * submitted with the deny that closed it. The navigator tags these distinctly. */
  general?: boolean;
  /** The plan version this comment was left on. Present only for the
   * cross-version compare index; absent in the single-version index, where
   * every comment belongs to the version on screen. */
  version?: number;
}

/** The navigable list of the plan's inline comments + unsent drafts, in document
 * order. Committed comments come from the line-anchored, non-blank annotations
 * (sharing the pendingInline predicate the status strip tallies); drafts come from
 * the unsent composer scratches, flagged `draft: true`. Legacy (selection-anchored)
 * annotations are excluded — they carry no source line, so there is nowhere to jump. */
export function commentIndex(
  annotations: Annotation[],
  scratches: ComposerScratch[] = [],
): CommentIndexEntry[] {
  const entries: CommentIndexEntry[] = [];
  for (const a of pendingInline(annotations)) {
    if (!isLineAnnotation(a)) continue;
    entries.push({
      id: a.id,
      line: a.endLine,
      label: rangeLabel(a.startLine, a.endLine),
      text: a.comment.trim(),
      draft: false,
      linkable: true,
    });
  }
  for (const s of scratches) {
    entries.push({
      id: s.key,
      line: s.endLine,
      label: rangeLabel(s.startLine, s.endLine),
      text: s.text.trim(),
      draft: true,
      linkable: true,
    });
  }
  return entries.sort(byLine);
}

/** Orders entries by anchor line ascending. A general entry has no line and so
 * sorts to the head of its group — lines are 1-based, so nothing can precede it. */
function byLine(x: CommentIndexEntry, y: CommentIndexEntry): number {
  return (x.line ?? 0) - (y.line ?? 0);
}

/** Every non-blank comment on the versions between the compared `before` and
 * `after` versions inclusive — each version's general comment, then its
 * line-anchored ones — ordered by version, so the list groups by version.
 * Comments are never merged across versions: two comments on the same line from
 * different versions are two entries, each carrying its own version. Ids are
 * prefixed with the version so they stay unique as {#each} keys.
 *
 * `before` and `after` name the two documents the diff renders, so their order
 * is meaningful even though the range they bound is not: an entry from either
 * one is stamped with the side it appears on and marked linkable, while a
 * version in between renders nowhere and lists non-interactively. */
export function versionCommentIndex(
  versions: PlanVersion[],
  before: number,
  after: number,
): CommentIndexEntry[] {
  const lo = Math.min(before, after);
  const hi = Math.max(before, after);
  return versions
    .filter((v) => v.version >= lo && v.version <= hi)
    .sort((a, b) => a.version - b.version)
    .flatMap((v) => {
      const side: DiffSide | undefined =
        v.version === before ? "before" : v.version === after ? "after" : undefined;
      const entries: CommentIndexEntry[] = pendingInline(v.annotations)
        .filter(isLineAnnotation)
        .map((a) => ({
          id: `v${v.version}:${a.id}`,
          line: a.endLine,
          label: rangeLabel(a.startLine, a.endLine),
          text: a.comment.trim(),
          draft: false,
          linkable: side != null,
          ...(side != null && { side }),
          version: v.version,
        }));
      const general = v.generalComment?.trim();
      if (general) {
        entries.push({
          id: `v${v.version}:general`,
          label: "",
          text: general,
          draft: false,
          general: true,
          linkable: false,
          version: v.version,
        });
      }
      return entries.sort(byLine);
    });
}

/** Narrows the comment index to entries whose text matches a search query
 * (case-insensitive substring). A blank query returns every entry. Matches the
 * comment text only — never the line label — so the navigator search filters on
 * what the reviewer wrote, not on the plan. */
export function filterComments(entries: CommentIndexEntry[], query: string): CommentIndexEntry[] {
  const q = query.trim().toLowerCase();
  if (q === "") return entries;
  return entries.filter((e) => e.text.toLowerCase().includes(q));
}

/** One run of comment text, flagged whether it matches the active search query —
 * so the navigator can underline the matched substring live as the reviewer types. */
export interface TextSegment {
  text: string;
  match: boolean;
}

/** Splits `text` into matched/unmatched runs against `query` (case-insensitive,
 * every occurrence), preserving the text's original case in the matched slices. A
 * blank query yields the whole text as one unmatched run. Trims the query to mirror
 * filterComments, so the underlined substring is exactly what filtered the list. */
export function highlightMatches(text: string, query: string): TextSegment[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [{ text, match: false }];
  const hay = text.toLowerCase();
  const segments: TextSegment[] = [];
  let i = 0;
  while (i < text.length) {
    const at = hay.indexOf(needle, i);
    if (at === -1) {
      segments.push({ text: text.slice(i), match: false });
      break;
    }
    if (at > i) segments.push({ text: text.slice(i, at), match: false });
    segments.push({ text: text.slice(at, at + needle.length), match: true });
    i = at + needle.length;
  }
  return segments;
}

/** How many distinct source locations the pending inline comments anchor to. A
 * line-anchored annotation's location is its `startLine-endLine` span, so several
 * comments on the same line (or the same range) collapse to one location; a
 * legacy annotation has no line anchor, so each counts as its own location. Lets
 * the dialog say "N comments on M lines" honestly — M < N only when comments
 * share a location. */
export function pendingLineCount(annotations: Annotation[]): number {
  const locations = new Set<string>();
  pendingInline(annotations).forEach((a, i) => {
    locations.add(isLineAnnotation(a) ? `line:${a.startLine}-${a.endLine}` : `legacy:${i}`);
  });
  return locations.size;
}

/** How many distinct source lines the pending line-anchored comments cover — the
 * size of the UNION of their `[startLine, endLine]` ranges, so a line touched by
 * two overlapping comments counts once (not the sum of range lengths). Only
 * line-anchored annotations have a source-line anchor; legacy (selection-anchored)
 * annotations carry no line range and so contribute to the comment count but not
 * to coverage. */
export function coveredLineCount(annotations: Annotation[]): number {
  const covered = new Set<number>();
  for (const a of pendingInline(annotations)) {
    if (!isLineAnnotation(a)) continue;
    for (let line = a.startLine; line <= a.endLine; line++) covered.add(line);
  }
  return covered.size;
}

/**
 * Formats annotations + a general comment into a single feedback string.
 * `planText` is the stored plan version the annotations anchor into, used to
 * quote a line-anchored annotation's source lines. Annotations with blank
 * comments are skipped; numbering follows array order. Returns "" when there is
 * nothing to say.
 */
export function formatFeedback(
  annotations: Annotation[],
  generalComment: string,
  planText: string,
): string {
  const general = generalComment.trim();
  const planLines = planText.split("\n");

  const inline = pendingInline(annotations);

  const sections: string[] = [];
  if (general) sections.push(general);

  if (inline.length > 0) {
    const entries = inline.map((a, i) => entry(a, i + 1, planLines));
    sections.push(["Inline comments:", "", ...entries].join("\n"));
  }

  return sections.join("\n\n");
}
