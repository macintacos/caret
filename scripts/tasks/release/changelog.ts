// Read-only parsing of the keepachangelog CHANGELOG.md. The agent *authors* the
// changelog prose (including each release's theme); the script only reads it
// back out — to recover the themed title for the commit/PR/GitHub-Release assets
// and to extract a version's notes for the GitHub Release body. Keeping these as
// pure string functions lets the parsing be unit-tested without any I/O.

/** The parsed parts of a release heading `## [X.Y.Z] - DATE - The <Theme> Release`. */
export interface ReleaseHeading {
  version: string;
  date: string;
  /** The themed portion after the date, e.g. "The Foundations Release", or null. */
  title: string | null;
}

/** A release heading paired with its notes body (everything up to the next section). */
export interface ChangelogSection {
  heading: ReleaseHeading;
  notes: string;
}

const RELEASE_HEADING = /^##\s+\[(\d+\.\d+\.\d+)\]\s+-\s+(\d{4}-\d{2}-\d{2})(?:\s+-\s+(.+?))?\s*$/;
const SECTION_START = /^##\s/;
const LINK_REF = /^\[[^\]]+\]:\s/;

/**
 * Parses a single line as a release heading. Returns null for non-headings and
 * for the `## [Unreleased]` heading (which has no date), so callers can iterate
 * headings and see only dated releases.
 */
export function parseHeading(line: string): ReleaseHeading | null {
  const m = RELEASE_HEADING.exec(line);
  if (m === null) return null;
  const [, version, date, title] = m;
  if (version === undefined || date === undefined) return null;
  return { version, date, title: title ?? null };
}

/**
 * The section for `version`: its heading plus the notes body, which runs from
 * just after the heading to the next `## ` section or the link-reference footer
 * block — so the link definitions never leak into a release's notes.
 */
export function findSection(changelog: string, version: string): ChangelogSection | null {
  const lines = changelog.split("\n");
  let start = -1;
  let heading: ReleaseHeading | null = null;
  for (let i = 0; i < lines.length; i++) {
    const h = parseHeading(lines[i] ?? "");
    if (h !== null && h.version === version) {
      start = i;
      heading = h;
      break;
    }
  }
  if (start === -1 || heading === null) return null;

  const body: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (SECTION_START.test(line) || LINK_REF.test(line)) break;
    body.push(line);
  }
  return { heading, notes: body.join("\n").trim() };
}

/** The first dated release version below `[Unreleased]`, or null if none. */
export function findTopReleasedVersion(changelog: string): string | null {
  for (const line of changelog.split("\n")) {
    const h = parseHeading(line);
    if (h !== null) return h.version;
  }
  return null;
}
