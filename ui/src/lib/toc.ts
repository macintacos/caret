// Source-line table-of-contents model for the diff-view plan surface. The plan
// is shown as formatted markdown source, so navigation is line-based: headings
// are scanned out of the raw lines (fence-aware) and carry their 1-based source
// line, which matches the @pierre/diffs `data-line` numbering used to scroll.
// Pure and DOM-free, so the extractor, active-line, and filter logic are all
// directly unit-testable.

/** A heading found in the plan source. */
export interface TocHeading {
  /** ATX level 1–6. */
  level: number;
  /** Heading text, trimmed and stripped of any trailing closing hashes. */
  text: string;
  /** 1-based source line number (matches the rendered row's data-line). */
  line: number;
}

// An ATX heading: optional leading whitespace, 1–6 hashes, then required
// whitespace before the text. The trailing-hash group is stripped separately.
const ATX = /^\s*(#{1,6})\s+(.*)$/;
// A fence opener/closer: three or more backticks or tildes (optionally indented).
const FENCE = /^\s*(`{3,}|~{3,})/;

/**
 * Scans plan source for ATX headings outside fenced code blocks, in document
 * order. A `#` line inside a ``` or ~~~ fence is code, not a heading; an
 * unterminated fence swallows everything to the end of input.
 */
export function extractHeadings(source: string): TocHeading[] {
  const headings: TocHeading[] = [];
  let inFence = false;
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = ATX.exec(line);
    if (!match) continue;
    const level = match[1]?.length ?? 0;
    // Strip trailing closing hashes (and the space before them) per ATX rules.
    const text = (match[2] ?? "").replace(/\s+#+\s*$/, "").trim();
    headings.push({ level, text, line: i + 1 });
  }
  return headings;
}

/**
 * The line of the heading that should read as active given the top visible
 * source line: the last heading at or above `topLine`, falling back to the
 * first heading when scrolled above it (so the document top shows heading one).
 * Returns null when there are no headings.
 */
export function activeHeadingLine(headings: TocHeading[], topLine: number): number | null {
  if (headings.length === 0) return null;
  let active = headings[0]?.line ?? null;
  for (const h of headings) {
    if (h.line <= topLine) active = h.line;
    else break;
  }
  return active;
}

/**
 * Headings whose text contains `query` (case-insensitive). An empty or
 * whitespace-only query returns every heading, so the pane's hide-non-matches
 * default falls out of rendering only this filtered list.
 */
export function filterHeadings(headings: TocHeading[], query: string): TocHeading[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return headings;
  return headings.filter((h) => h.text.toLowerCase().includes(needle));
}

// Lowercase the text and collapse runs of non-alphanumerics (unicode-aware) to a
// single hyphen, trimming hyphens off the ends. A heading with no alphanumerics
// (e.g. a rule of dashes) yields the empty string, which falls back to "section"
// so the slug — and the URL it lands in — is never blank.
function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "section" : slug;
}

// Slugs for every heading, in document order and aligned by index. Repeated text
// (and symbol-only fallbacks) collide on the same base slug, so the Nth occurrence
// after the first earns a `-N` suffix — GitHub-style — keeping every slug unique
// and stable for a given heading set. The single owner of the slug↔heading mapping
// the two resolvers below share.
function headingSlugs(headings: TocHeading[]): string[] {
  const seen = new Map<string, number>();
  return headings.map((h) => {
    const base = slugify(h.text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base}-${n}`;
  });
}

/** The slug of the heading on 1-based source `line`, or null when no heading sits
 * there. Used to mirror the active heading into the URL. */
export function slugForLine(headings: TocHeading[], line: number): string | null {
  const i = headings.findIndex((h) => h.line === line);
  return i === -1 ? null : (headingSlugs(headings)[i] ?? null);
}

/** The 1-based source line of the heading whose slug is `slug`, or null when no
 * heading matches (an unknown or stale deep-link). Inverse of slugForLine. */
export function lineForSlug(headings: TocHeading[], slug: string): number | null {
  const i = headingSlugs(headings).indexOf(slug);
  return i === -1 ? null : (headings[i]?.line ?? null);
}
