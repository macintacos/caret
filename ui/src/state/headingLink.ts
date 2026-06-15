// Per-heading deep-linking: the active heading's slug is mirrored into the
// `?heading=` query param alongside `?review=` so a shared URL reopens the review
// (deepLink.ts) and scrolls to that heading. Keyed to the slug toc.ts derives from
// the heading text — readable and stable across reflows, unlike a raw source line.
// Pure `location`/`history` helpers, no runes — wired by DiffPlanView.

/** Normalize a raw param to a non-empty slug, or null when missing or blank. */
function parseSlug(raw: string | null): string | null {
  if (raw == null) return null;
  const slug = raw.trim();
  return slug === "" ? null : slug;
}

/** The heading slug requested by the current URL, or null when none is set. */
export function headingSlug(): string | null {
  return parseSlug(new URLSearchParams(location.search).get("heading"));
}

/** Reflect the active heading slug into the URL without a navigation
 * (replaceState), preserving the other params (notably `review`). A null or blank
 * slug clears the param. */
export function setHeadingSlug(slug: string | null): void {
  const url = new URL(location.href);
  const trimmed = slug?.trim();
  if (trimmed) url.searchParams.set("heading", trimmed);
  else url.searchParams.delete("heading");
  history.replaceState(null, "", url);
}

/** Read the deep-linked heading slug once and clear it, so a one-shot restore
 * scrolls on first load without re-firing on later polls or version switches.
 * Leaves `review` and other params intact. */
export function takeHeadingSlug(): string | null {
  const slug = headingSlug();
  if (slug != null) setHeadingSlug(null);
  return slug;
}
