// The active review id is mirrored into the `?review=` query param so a reload
// (or a shared URL) reopens the same review.

/** The review id requested by the current URL, or null when none is set. */
export function deepLinkId(): string | null {
  return new URLSearchParams(location.search).get("review");
}

/** Reflect the active id into the URL without a navigation (replaceState). */
export function setUrl(id: string | null): void {
  const url = new URL(location.href);
  if (id) url.searchParams.set("review", id);
  else url.searchParams.delete("review");
  history.replaceState(null, "", url);
}
