// Per-heading deep-linking: the active heading's source line is mirrored into
// the `?line=` query param alongside `?review=` so a shared URL reopens the
// review (deepLink.ts) and scrolls to that heading. Keyed to the 1-based source
// line that scroll.ts resolves via the library's `data-line` rows — not a slug.
// Pure `location`/`history` helpers, no runes — wired by DiffPlanView.

/** Parse a positive whole 1-based source line from `raw`, or null when it isn't
 * a usable line (missing, non-finite, fractional source, or <= 0). */
function parseLine(raw: string | null): number | null {
  if (raw == null) return null;
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The heading line requested by the current URL, or null when none is set. */
export function headingLine(): number | null {
  return parseLine(new URLSearchParams(location.search).get("line"));
}

/** Reflect the active heading line into the URL without a navigation
 * (replaceState), preserving the other params (notably `review`). A non-positive
 * or null line clears the param. */
export function setHeadingLine(line: number | null): void {
  const url = new URL(location.href);
  if (line != null && line > 0) url.searchParams.set("line", String(line));
  else url.searchParams.delete("line");
  history.replaceState(null, "", url);
}

/** Read the deep-linked heading line once and clear it, so a one-shot restore
 * scrolls on first load without re-firing on later polls or version switches.
 * Leaves `review` and other params intact. */
export function takeHeadingLine(): number | null {
  const line = headingLine();
  if (line != null) setHeadingLine(null);
  return line;
}
