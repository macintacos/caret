// Source-line table-of-contents model for the diff-view plan surface. The plan
// is shown as formatted markdown source, so navigation is line-based: headings
// are scanned out of the raw lines (fence-aware) and carry their 1-based source
// line, which matches the @pierre/diffs `data-line` numbering used to scroll.
// Pure and DOM-free.

/** A heading found in the plan source. */
export interface TocHeading {
  /** ATX level 1–6. */
  level: number;
  /** Heading text, trimmed and stripped of any trailing closing hashes. */
  text: string;
  /** 1-based source line number (matches the rendered row's data-line). */
  line: number;
}

const ATX = /^\s*(#{1,6})\s+(.*)$/;
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

/** A run of a heading's text, flagged when the query matched those characters. */
export interface MatchRun {
  text: string;
  /** Whether the query matched this run. */
  hit: boolean;
}

/**
 * A matcher for `query` — the one definition of what the ToC counts as a match, so a
 * surface that filters on it and a surface that highlights on it cannot disagree. It
 * returns a heading's text cut into runs with the matched ones flagged, or null when the
 * text does not match. Matching is case-insensitive substring, and EVERY occurrence is
 * flagged rather than only the first.
 *
 * Two texts come back as one UNFLAGGED run: any text under an empty or whitespace-only
 * query, and a text whose lowercase differs in LENGTH (`İ`), where the run offsets no
 * longer align.
 */
export function headingMatcher(query: string): (text: string) => MatchRun[] | null {
  const needle = query.trim().toLowerCase();
  return (text) => {
    if (needle === "") return [{ text, hit: false }];
    const haystack = text.toLowerCase();
    // A case fold that changes length (`İ` lowercases to two code units) shifts every
    // offset after it, so the runs below would flag the WRONG characters — worse than
    // flagging none.
    if (haystack.length !== text.length) {
      return haystack.includes(needle) ? [{ text, hit: false }] : null;
    }
    const runs: MatchRun[] = [];
    // `at` is both the start of the not-yet-emitted text and where the next search
    // resumes. An empty needle — the one value that would spin this loop — has already
    // returned above.
    let at = 0;
    for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, at)) {
      if (i > at) runs.push({ text: text.slice(at, i), hit: false });
      at = i + needle.length;
      runs.push({ text: text.slice(i, at), hit: true });
    }
    if (runs.length === 0) return null;
    if (at < text.length) runs.push({ text: text.slice(at), hit: false });
    return runs;
  };
}

/**
 * Headings whose text contains `query` (case-insensitive); an empty or whitespace-only
 * query returns every heading.
 *
 * Hands back the caller's own objects, never copies: `groupedHeadingMatches`
 * (headingTrail.ts) decides group membership by reference identity over this result, so
 * returning a `{heading, runs}` wrapper here would make every query render nothing —
 * silently, from a module that still looks correct.
 */
export function filterHeadings(headings: TocHeading[], query: string): TocHeading[] {
  const match = headingMatcher(query);
  return headings.filter((h) => match(h.text) !== null);
}

// A heading with no alphanumerics (e.g. a rule of dashes) collapses to the empty
// string; "section" keeps the slug — and the URL it lands in — from ever being blank.
function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "section" : slug;
}

// Slugs for every heading, in document order and aligned by index. Repeated text (and
// symbol-only fallbacks) collide on the same base slug, so the Nth occurrence after the
// first earns a `-N` suffix — GitHub-style — keeping every slug unique and stable for a
// given heading set.
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
