// Pure full-text search for the vim-style `/` search (EXC-832). Node- and DOM-free
// (directly unit-testable), mirroring lineCursor.ts's shape: `findMatches` is the source
// view's match space (previewSearch.ts supplies the preview's); the shared match type and
// n/N stepping serve both. The painting (searchHighlight.ts on the source view,
// previewSearch.ts on the preview) and the search pill consume these results. Search is
// vim smartcase and literal (no regex).

/** A match span. `line` is the 1-based source line the match starts on (matching the
 * @pierre/diffs `data-line` numbering the source view paints); `startCol`/`endCol` are
 * 0-based and half-open. On the source view `[startCol, endCol)` indexes that line's text.
 * On the preview it counts from that line's first rendered character
 * (`PlanSourceMap.offsetOfLine`, a TextPoint column) and may run past the line's own text,
 * across a soft break. */
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
 * The match to step to from a cursor `fromLine` when RESUMING a remembered search
 * with n/N (the pill closed, so there is no live index to step from — the current
 * reading position is the seed instead). `delta > 0` (n) picks the first match
 * strictly after `fromLine`, wrapping to the first; `delta < 0` (N) picks the last
 * match strictly before it, wrapping to the last. Strict (not "at or after") so a
 * cursor sitting on a match steps to the adjacent one, as vim's n/N do. Returns -1
 * with no matches. Line-granular: multiple matches on the cursor's own line are
 * skipped on this first step (the cursor is line-based), then n/N step within-line.
 */
export function matchStepFromLine(matches: SearchMatch[], fromLine: number, delta: number): number {
  if (matches.length === 0) return -1;
  if (delta >= 0) {
    const at = matches.findIndex((m) => m.line > fromLine);
    return at === -1 ? 0 : at;
  }
  const at = matches.findLastIndex((m) => m.line < fromLine);
  return at === -1 ? matches.length - 1 : at;
}

/**
 * Step `index` by `delta` (n = +1, N = -1) with wraparound over `count` items.
 * Returns -1 for an empty set.
 */
export function stepIndex(count: number, index: number, delta: number): number {
  if (count === 0) return -1;
  return (((index + delta) % count) + count) % count;
}
