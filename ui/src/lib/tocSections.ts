// What the outline knows about each heading's section beyond the heading itself: the
// comments inside it, whether it changed since the previous version, and, while comparing,
// what it gained and lost against the other version. Pure and DOM-free like `toc.ts`.

import { lineCountOf } from "$lib/diffview/lineCursor.ts";
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
