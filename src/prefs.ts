// Machine-global UI preferences, persisted as a single JSON file under stateDir.
// Today it holds just the last-used approve mode — a last-write-wins value the
// web UI reads on load to default the primary Approve button. Reads fail safe to
// "default"; writes are fire-and-forget (never on the hook's decision path).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { prefsFile } from "./paths.ts";
import { type AcceptMode, isAcceptMode } from "./types.ts";

/** Remembered approve mode, falling back to "default" on a missing, unreadable,
 * or unrecognized value (same fail-safe as the review store's persisted()). */
export async function readApproveMode(file = prefsFile()): Promise<AcceptMode> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as { approveMode?: unknown };
    return isAcceptMode(parsed.approveMode) ? parsed.approveMode : "default";
  } catch {
    return "default";
  }
}

/** Persist the remembered approve mode (last-write-wins; no per-id locking, per
 * the issue's constraint). An invalid token is ignored so a malformed request
 * can't corrupt the stored value. */
export async function writeApproveMode(mode: AcceptMode, file = prefsFile()): Promise<void> {
  if (!isAcceptMode(mode)) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ approveMode: mode }, null, 2));
}
