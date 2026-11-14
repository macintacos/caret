// The docs site's Changelog page: every published GitHub Release's notes, newest first.
// `release prepare` regenerates it from the Releases plus the new release's notes file,
// so the page lands on main before the tag push that deploys the site.

import type { PublishedRelease } from "@/tasks/release/github.ts";
import { newestFirst, versionFromTag } from "@/tasks/release/version.ts";

/** The generated page. The docs gate never counts it as documenting a change. */
export const CHANGELOG_PAGE = "docs/changelog.md";

/** Where a release's shallowest heading lands: one level under its `## <tag>` heading. */
const NOTES_HEADING_LEVEL = 3;

/** The whole page: a preamble, then one `## <tag>` section per release, newest first. */
export function renderChangelog(repoSlug: string, releases: readonly PublishedRelease[]): string {
  const sections = [...releases]
    .sort((a, b) => newestFirst(versionFromTag(a.tag), versionFromTag(b.tag)))
    .map((release) => releaseSection(repoSlug, release));
  return `${[preamble(repoSlug), ...sections].join("\n\n")}\n`;
}

function preamble(repoSlug: string): string {
  return [
    "# Changelog",
    "",
    `Every caret release, newest first, as its [GitHub Release](https://github.com/${repoSlug}/releases) describes it.`,
  ].join("\n");
}

function releaseSection(repoSlug: string, { tag, publishedAt, notes }: PublishedRelease): string {
  const day = publishedAt.toISOString().slice(0, 10);
  const url = `https://github.com/${repoSlug}/releases/tag/${tag}`;
  const lines = notes.replace(/\r\n/g, "\n").trim().split("\n");
  const fenced = fencedLines(lines);
  const body = nestListBlocks(demoteHeadings(lines, fenced), fenced).join("\n");
  return [`## ${tag}`, `Released ${day} · [GitHub release](${url})`, body]
    .filter((part) => part !== "")
    .join("\n\n");
}

/** `lines` with their headings shifted so the shallowest sits at NOTES_HEADING_LEVEL. */
// ponytail: reads only unindented ATX headings, the only kind release notes use; teach it
// setext headings if a release ever carries one.
function demoteHeadings(lines: readonly string[], fenced: readonly boolean[]): string[] {
  const levels = lines.map((line, i) =>
    fenced[i] ? null : (/^(#{1,6})(?:\s|$)/.exec(line)?.[1]?.length ?? null),
  );
  const shallowest = Math.min(...levels.filter((level) => level !== null));
  const shift = Number.isFinite(shallowest) ? Math.max(0, NOTES_HEADING_LEVEL - shallowest) : 0;
  return lines.map((line, i) => {
    const level = levels[i] ?? null;
    return level === null ? line : `${"#".repeat(Math.min(6, level + shift))}${line.slice(level)}`;
  });
}

/** Python-Markdown nests a block under a `- ` item only at 4 spaces, where GitHub takes the
 * item's 2-space text column, so every indented line under an item moves 2 spaces right. */
function nestListBlocks(lines: readonly string[], fenced: readonly boolean[]): string[] {
  let inList = false;
  return lines.map((line, i) => {
    if (!fenced[i] && /^\S/.test(line)) inList = /^[-*+] /.test(line);
    return inList && line.startsWith("  ") ? `  ${line}` : line;
  });
}

/** Whether each line sits inside fenced code, its closing fence included. */
function fencedLines(lines: readonly string[]): boolean[] {
  let fence: string | null = null;
  return lines.map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null) {
      if (marker !== undefined) fence = marker;
      return false;
    }
    const closes =
      marker !== undefined &&
      marker[0] === fence[0] &&
      marker.length >= fence.length &&
      line.trim() === marker;
    if (closes) fence = null;
    return true;
  });
}
