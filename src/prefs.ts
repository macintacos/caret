// Machine-global UI preferences, persisted as a single JSON file under stateDir.
// Today it holds just the last-used approve mode — a last-write-wins value the
// web UI reads on load to default the primary Approve button. Reads fail safe to
// "default"; writes are fire-and-forget (never on the hook's decision path).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { type CaretLogger, noopLogger } from "./log.ts";
import { prefsFile } from "./paths.ts";
import { type AcceptMode, isAcceptMode } from "./types.ts";

/** Remembered approve mode, falling back to "default" on a missing, unreadable,
 * or unrecognized value (same fail-safe as the review store's persisted()).
 * Fallbacks log at debug — a missing file is a normal first run. */
export async function readApproveMode(
  file = prefsFile(),
  log: CaretLogger = noopLogger,
): Promise<AcceptMode> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as { approveMode?: unknown };
    if (isAcceptMode(parsed.approveMode)) return parsed.approveMode;
    log.debug("prefs", "unrecognized approve mode; using default");
    return "default";
  } catch {
    log.debug("prefs", "prefs unreadable; using default approve mode");
    return "default";
  }
}

/** Persist the remembered approve mode (last-write-wins; no per-id locking, per
 * the issue's constraint). An invalid token is ignored so a malformed request
 * can't corrupt the stored value. */
export async function writeApproveMode(
  mode: AcceptMode,
  file = prefsFile(),
  log: CaretLogger = noopLogger,
): Promise<void> {
  if (!isAcceptMode(mode)) {
    // A malformed request reached us — ignored, but worth attention.
    log.warn("prefs", "ignoring invalid approve mode");
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify({ approveMode: mode }, null, 2));
  log.debug("prefs", `approve mode saved: ${mode}`);
}
