// The one-time move to the preview default: a browser that used caret before is moved to
// preview once and owed a notice; a new browser starts on preview and is owed nothing.

import { defineFlagPref } from "$lib/definePref.ts";
import { PLAN_VIEW_KEY } from "$lib/planView.ts";

/** Set once this browser has been through the one-time decision. */
const MOVED_KEY = "caret.previewDefault.moved";
/** Set once the notice is done for good. */
const NOTICE_SEEN_KEY = "caret.previewDefault.noticeSeen";

defineFlagPref(MOVED_KEY);
// onError: true — blocked storage reads as seen, so the notice never nags.
const noticePref = defineFlagPref(NOTICE_SEEN_KEY, { onError: true });

/** Whether the preview-default notice is done for good. */
export const isPreviewNoticeSeen = noticePref.read;

/** Records that the reader has seen the preview-default notice. */
export const markPreviewNoticeSeen = (): void => noticePref.write(true);

// Any caret key means this browser used caret before. A prefix scan, so a key a past
// release wrote and this one no longer registers still counts.
function holdsCaretKey(storage: Storage): boolean {
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key?.startsWith("caret.") || key?.startsWith("caret:")) return true;
  }
  return false;
}

/** Acts once per browser: moves a browser that used caret before to preview, and marks a
 * new one as needing no notice. Call it while storage holds no key this session wrote:
 * before mount at boot, and straight after clearKnownPrefs() on --fresh. A throwing
 * storage makes it a no-op. Takes a getter because reading `localStorage` itself
 * throws where the store is blocked. */
export function applyPreviewDefault(getStorage: () => Storage): void {
  try {
    const storage = getStorage();
    if (storage.getItem(MOVED_KEY) !== null) return;
    if (holdsCaretKey(storage)) storage.setItem(PLAN_VIEW_KEY, "preview");
    else storage.setItem(NOTICE_SEEN_KEY, "1");
    storage.setItem(MOVED_KEY, "1");
  } catch {
    // Blocked storage: nothing to move, and the notice reads as seen.
  }
}
