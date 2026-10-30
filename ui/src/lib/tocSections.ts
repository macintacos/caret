// What the Contents panel knows about each heading's section beyond the heading itself:
// where it ends, how it opens, the comments inside it, and whether it changed since the
// previous version. Pure and DOM-free like `toc.ts`.

import type { CommentIndexEntry } from "$lib/feedback.ts";
import { extractHeadings, FENCE, type TocHeading } from "$lib/toc.ts";

/** How a section differs from the same heading's section in the previous version. */
export type SectionChange = "edited" | "new";

/** One heading's section. "Own" lines run from the heading to the line before the next
 * heading of any level; the section's full extent also covers its subsections. */
export interface TocSection {
  /** The section's last non-blank source line, its subsections included. */
  end: number;
  /** The first lines of its own prose as one run of plain text; empty when it has none. */
  excerpt: string;
  /** The comments and drafts anchored in its own lines, in line order. */
  comments: CommentIndexEntry[];
  /** How many comments and drafts its subsections hold. */
  deeper: number;
  /** Null when its own text is unchanged, or when there is no previous version. */
  change: SectionChange | null;
}

const EXCERPT_LINES = 3;

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
    const stop = stopOf(headings, index, lines.length);
    const key = ours.keys[index] ?? "";
    sections.set(heading.line, {
      end: lastNonBlank(lines, heading.line, stop),
      excerpt: excerpt(lines.slice(heading.line, ownEnd)),
      comments: anchored(comments, heading.line, ownEnd),
      deeper: anchored(comments, ownEnd + 1, stop).length,
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

export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function ownEndOf(headings: TocHeading[], index: number, lineCount: number): number {
  return (headings[index + 1]?.line ?? lineCount + 1) - 1;
}

// The last line before the next heading at this one's level or above.
function stopOf(headings: TocHeading[], index: number, lineCount: number): number {
  const level = headings[index]?.level ?? 0;
  return (headings.slice(index + 1).find((h) => h.level <= level)?.line ?? lineCount + 1) - 1;
}

function anchored(comments: CommentIndexEntry[], lo: number, hi: number): CommentIndexEntry[] {
  return comments.filter((c) => c.line !== undefined && c.line >= lo && c.line <= hi);
}

function changeOf(previous: string | undefined, current: string | undefined): SectionChange | null {
  if (previous === undefined) return "new";
  return previous === current ? null : "edited";
}

// Each heading's own text, keyed on its title plus how many same-titled headings precede
// it, so two sections both called "Notes" pair with their counterparts in order.
function ownTexts(
  headings: TocHeading[],
  lines: string[],
): { keys: string[]; texts: Map<string, string> } {
  const seen = new Map<string, number>();
  const keys: string[] = [];
  const texts = new Map<string, string>();
  for (const [index, heading] of headings.entries()) {
    const nth = seen.get(heading.text) ?? 0;
    seen.set(heading.text, nth + 1);
    const key = `${nth}:${heading.text}`;
    keys.push(key);
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

function lastNonBlank(lines: string[], from: number, to: number): number {
  for (let n = to; n > from; n--) if ((lines[n - 1] ?? "").trim() !== "") return n;
  return from;
}

function excerpt(own: string[]): string {
  const prose: string[] = [];
  let fenced = false;
  for (const line of own) {
    if (FENCE.test(line)) {
      fenced = !fenced;
      continue;
    }
    const text = line.trim();
    if (fenced || text === "") continue;
    prose.push(text);
    if (prose.length === EXCERPT_LINES) break;
  }
  return prose
    .join(" ")
    .replace(/\*\*|__|`/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}
