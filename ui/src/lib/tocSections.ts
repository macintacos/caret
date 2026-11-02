// What the outline knows about each heading's section beyond the heading itself: the
// comments inside it, whether it changed since the previous version, and, while comparing,
// what it gained and lost against the other version. Pure and DOM-free like `toc.ts`.

import { lineCountOf } from "$lib/diffview/lineCursor.ts";
import type { DiffSide } from "$lib/diffview/types.ts";
import type { CommentIndexEntry } from "$lib/feedback.ts";
import { extractHeadings, type TocHeading } from "$lib/toc.ts";

/** How a section differs from the same heading's section in the previous version. */
export type SectionChange = "edited" | "new";

/** One heading's section: its "own" lines, from the heading to the line before the next
 * heading of any level. */
export interface TocSection {
  /** The comments and drafts anchored in its own lines, in line order. */
  comments: CommentIndexEntry[];
  /** Null when its own text is unchanged, or when there is no previous version. */
  change: SectionChange | null;
}

/** Every heading's section, keyed on the heading's source line. `comments` must anchor to
 * `plan`'s lines; `previousPlan` is null when the plan has no earlier version. */
export function tocSections(
  headings: TocHeading[],
  plan: string,
  comments: CommentIndexEntry[],
  previousPlan: string | null,
): Map<number, TocSection> {
  const lines = plan.split("\n");
  const before =
    previousPlan === null
      ? null
      : ownTexts(extractHeadings(previousPlan), previousPlan.split("\n"));
  const ours = ownTexts(headings, lines);
  const sections = new Map<number, TocSection>();
  for (const [index, heading] of headings.entries()) {
    const ownEnd = ownEndOf(headings, index, lines.length);
    const key = ours.keys[index] ?? "";
    sections.set(heading.line, {
      comments: anchored(comments, heading.line, ownEnd),
      change: before === null ? null : changeOf(before.texts.get(key), ours.texts.get(key)),
    });
  }
  return sections;
}

/** What a base section gained and lost against the target version, and where its
 * first change sits: the first gained line on the base ("after") side, or, for a
 * section that only lost lines, the first lost line on the target ("before") side. */
export interface SectionDelta {
  added: number;
  removed: number;
  line: number;
  side: DiffSide;
}

/** Every base section whose own lines differ from its counterpart in `target`, keyed on
 * the heading's source line in `base`. A section the target lacks counts as wholly
 * gained. Lines pair as a multiset, so a line moved within its section counts as no
 * change. */
export function sectionDeltas(
  headings: TocHeading[],
  base: string,
  target: string,
): Map<number, SectionDelta> {
  const baseLines = base.split("\n");
  const targetLines = target.split("\n");
  const theirs = new Map(
    ownRanges(extractHeadings(target), targetLines.length).map((r) => [r.key, r] as const),
  );
  const ours = ownRanges(headings, baseLines.length);
  const deltas = new Map<number, SectionDelta>();
  for (const [index, heading] of headings.entries()) {
    const mine = ours[index];
    if (mine === undefined) continue;
    const other = theirs.get(mine.key);
    const gained = unmatched(baseLines, mine, other === undefined ? [] : slice(targetLines, other));
    const lost = other === undefined ? [] : unmatched(targetLines, other, slice(baseLines, mine));
    const first = gained[0] ?? lost[0];
    if (first === undefined) continue;
    deltas.set(heading.line, {
      added: gained.length,
      removed: lost.length,
      line: first,
      side: gained.length > 0 ? "after" : "before",
    });
  }
  return deltas;
}

/** The section's committed comments and unsent drafts, counted apart. */
export function sectionCounts(section: TocSection): { comments: number; drafts: number } {
  const drafts = section.comments.filter((c) => c.draft).length;
  return { comments: section.comments.length - drafts, drafts };
}

/** What a row says about its section beyond its heading, for `aria-describedby`: "2
 * comments, 1 unsent, edited since v3". Empty when there is nothing to say. `since` is the
 * previous version's number. */
export function describeSection(section: TocSection, since: number | null): string {
  const { comments, drafts } = sectionCounts(section);
  return [
    comments > 0 ? plural(comments, "comment") : "",
    drafts > 0 ? `${drafts} unsent` : "",
    section.change !== null && since !== null ? `${section.change} since v${since}` : "",
  ]
    .filter((part) => part !== "")
    .join(", ");
}

/** The 1-based, inclusive lines of the section `line`'s heading opens, or null when no
 * heading sits on `line`. A heading with no text of its own takes its subsections too, up
 * to the next heading of its level or higher. `lines` are the plan's. */
export function sectionLines(
  headings: TocHeading[],
  line: number,
  lines: readonly string[],
): { from: number; to: number } | null {
  const index = headings.findIndex((h) => h.line === line);
  if (index === -1) return null;
  const lineCount = lineCountOf(lines);
  const ownEnd = ownEndOf(headings, index, lineCount);
  const bare = lines.slice(line, ownEnd).every((text) => text.trim() === "");
  return { from: line, to: bare ? subtreeEndOf(headings, index, lineCount) : ownEnd };
}

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function ownEndOf(headings: TocHeading[], index: number, lineCount: number): number {
  return (headings[index + 1]?.line ?? lineCount + 1) - 1;
}

function subtreeEndOf(headings: TocHeading[], index: number, lineCount: number): number {
  const level = headings[index]?.level ?? 0;
  const next = headings.slice(index + 1).find((h) => h.level <= level);
  return (next?.line ?? lineCount + 1) - 1;
}

function anchored(comments: CommentIndexEntry[], lo: number, hi: number): CommentIndexEntry[] {
  return comments.filter((c) => c.line !== undefined && c.line >= lo && c.line <= hi);
}

function changeOf(previous: string | undefined, current: string | undefined): SectionChange | null {
  if (previous === undefined) return "new";
  return previous === current ? null : "edited";
}

// A section's own lines, its heading included, as 1-based inclusive bounds.
interface OwnRange {
  key: string;
  from: number;
  to: number;
}

function ownRanges(headings: TocHeading[], lineCount: number): OwnRange[] {
  const keys = sectionKeys(headings);
  return headings.map((heading, index) => ({
    key: keys[index] ?? "",
    from: heading.line,
    to: ownEndOf(headings, index, lineCount),
  }));
}

function slice(lines: string[], range: OwnRange): string[] {
  return lines.slice(range.from - 1, range.to);
}

// The 1-based numbers of the range's lines that `others` has no copy left to pair with.
function unmatched(lines: string[], range: OwnRange, others: string[]): number[] {
  const left = new Map<string, number>();
  for (const line of others) left.set(line, (left.get(line) ?? 0) + 1);
  const missing: number[] = [];
  for (let n = range.from; n <= range.to; n++) {
    const line = lines[n - 1] ?? "";
    const count = left.get(line) ?? 0;
    if (count > 0) left.set(line, count - 1);
    else missing.push(n);
  }
  return missing;
}

// Each heading's key: its title plus how many same-titled headings precede it, so two
// sections both called "Notes" pair with their counterparts in order.
function sectionKeys(headings: TocHeading[]): string[] {
  const seen = new Map<string, number>();
  return headings.map((heading) => {
    const nth = seen.get(heading.text) ?? 0;
    seen.set(heading.text, nth + 1);
    return `${nth}:${heading.text}`;
  });
}

// Each heading's own text, keyed by sectionKeys.
function ownTexts(
  headings: TocHeading[],
  lines: string[],
): { keys: string[]; texts: Map<string, string> } {
  const keys = sectionKeys(headings);
  const texts = new Map<string, string>();
  for (const [index, heading] of headings.entries()) {
    const key = keys[index] ?? "";
    texts.set(
      key,
      lines
        .slice(heading.line, ownEndOf(headings, index, lines.length))
        .join("\n")
        .trim(),
    );
  }
  return { keys, texts };
}
