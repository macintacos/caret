// The approve-variant id this browser last used, remembered per origin (EXC-1354).
//
// The ids are opaque and reach the UI from the adapter over the wire, so neither
// definePref (a fixed allow-list) nor defineFlagPref fits; it takes the bespoke
// read/write plus registerPrefKey that definePref.ts documents for exactly this case,
// so it still joins the `--fresh` reset and prefKeys.test.ts's scan. Gating a stored id
// against the live variant set is pickApproveMode's job (approve.ts).

import type { ApproveVariantId } from "@core/lib/types";
import { registerPrefKey } from "$lib/definePref.ts";

/** localStorage key holding the approve-variant id this browser last used. */
export const APPROVE_MODE_KEY = "caret.approveMode";

registerPrefKey(APPROVE_MODE_KEY);

/** The remembered approve-variant id, or null when this browser has none. Never
 * throws: an unreadable store degrades to null, which costs at most a forgotten
 * default. */
export function readApproveMode(): ApproveVariantId | null {
  try {
    return localStorage.getItem(APPROVE_MODE_KEY);
  } catch {
    return null;
  }
}

/** Remember the chosen variant so the next plan defaults to it. A storage failure is
 * swallowed — the memory is a convenience and must not surface. */
export function writeApproveMode(id: ApproveVariantId): void {
  try {
    localStorage.setItem(APPROVE_MODE_KEY, id);
  } catch {
    // Storage unavailable (private mode, quota, disabled) — drop silently.
  }
}
