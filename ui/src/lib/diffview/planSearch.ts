// Pure full-text search over the plan source for the vim-style `/` search
// (EXC-832). Node- and DOM-free (directly unit-testable), mirroring lineCursor.ts's
// shape: this module only computes the match spans, the "nearest" match to commit
// to, and index stepping for n/N. The painting (searchHighlight.ts) and the search
// pill consume these results. Search is vim smartcase and literal (no regex).

/** A match span on a single source line. `line` is 1-based (matching the
 * @pierre/diffs `data-line` numbering the source view paints); `startCol`/`endCol`
 * are 0-based, half-open `[startCol, endCol)` into that line's text. */
export interface SearchMatch {
  line: number;
  startCol: number;
  endCol: number;
}

/** vim smartcase: the query is case-insensitive until it contains an uppercase
 * letter, at which point it becomes case-sensitive. */
function isCaseSensitive(query: string): boolean {
  return /[A-Z]/.test(query);
}

/**
 * Every literal (non-regex) occurrence of `query` across `lines`, in document
 * order, applying vim smartcase. An empty query yields no matches. Occurrences do
 * not overlap — the scan advances past each match by the query length.
 */
export function findMatches(lines: string[], query: string): SearchMatch[] {
  if (query === "") return [];
  const sensitive = isCaseSensitive(query);
  const needle = sensitive ? query : query.toLowerCase();
  const matches: SearchMatch[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const hay = sensitive ? raw : raw.toLowerCase();
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at === -1) break;
      matches.push({ line: i + 1, startCol: at, endCol: at + query.length });
      from = at + query.length;
    }
  }
  return matches;
}

/**
 * The index of the first match at or after `fromLine` (1-based), wrapping to 0
 * when none follow — the "nearest" match Enter commits to and the counter's
 * current-of-total tracks while typing. Returns -1 when there are no matches.
 */
export function nearestMatchIndex(matches: SearchMatch[], fromLine: number): number {
  if (matches.length === 0) return -1;
  const at = matches.findIndex((m) => m.line >= fromLine);
  return at === -1 ? 0 : at;
}

/**
 * Step `index` by `delta` (n = +1, N = -1) with wraparound over `count` items.
 * Returns -1 for an empty set.
 */
export function stepIndex(count: number, index: number, delta: number): number {
  if (count === 0) return -1;
  return (((index + delta) % count) + count) % count;
}
