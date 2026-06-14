// One-time discoverability for the drag-to-comment gesture. The gutter `+` and a
// plain line click both open the composer, but the *drag down the line-number
// column to comment on a span* is not self-evident — so the source view surfaces
// a hint the first time the reviewer hovers the gutter, then remembers the
// dismissal so it never nags again. This is the persistence seam, kept pure so it
// is unit-testable without mounting the view; the component owns when to show it.

const STORAGE_KEY = "caret:diffview:drag-hint-dismissed";

/** Whether the drag-to-comment hint has already been dismissed. Reads localStorage
 * defensively: a storage-disabled or private-mode browser throws on access, in
 * which case we treat the hint as dismissed rather than nagging on every load. */
export function isDragHintDismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

/** Records that the reviewer has seen the hint so it never shows again. A storage
 * failure is swallowed — the hint simply re-appears next session, never errors. */
export function dismissDragHint(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Storage unavailable (private mode, quota): the hint is non-essential, so a
    // failed persist is not worth surfacing.
  }
}
