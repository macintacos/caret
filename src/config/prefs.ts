// Machine-global UI preferences, persisted as a single JSON file under stateDir.
// Today it holds just the last-used approve-variant id — a last-write-wins value
// the web UI reads on load to default the primary Approve button. The id is an
// opaque token (ApproveVariantId): prefs never interpret it, they only gate it
// against the adapter-declared set the caller passes in. Reads fail safe to the
// default id; writes are fire-and-forget (never on the hook's decision path).

import { readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ensureStateDir, prefsFile } from "@/config/paths.ts";
import { type CaretLogger, noopLogger } from "@/lib/log.ts";
import type { ApproveVariantId } from "@/lib/types.ts";

/** The recognized approve-variant ids and the one to fall back to. The daemon
 * derives both from the active adapter's declared variants (the default is the
 * first declared id); prefs treats the ids as opaque and only checks membership.
 * Defaults to a lone "default" so a caller with no declared variants still reads
 * and writes a sensible value. */
export interface ApproveModeSet {
  valid: readonly ApproveVariantId[];
  fallback: ApproveVariantId;
}

const DEFAULT_SET: ApproveModeSet = { valid: ["default"], fallback: "default" };

/** Remembered approve-variant id, falling back to the set's default on a missing,
 * unreadable, or unrecognized value (same fail-safe as the review store's
 * persisted()). An id outside the declared set — including a legacy token from a
 * pre-epic prefs file — degrades to the default exactly as any other unrecognized
 * value. Fallbacks log at debug — a missing file is a normal first run. */
export async function readApproveMode(
  file = prefsFile(),
  log: CaretLogger = noopLogger,
  set: ApproveModeSet = DEFAULT_SET,
): Promise<ApproveVariantId> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf-8")) as { approveMode?: unknown };
    if (typeof parsed.approveMode === "string" && set.valid.includes(parsed.approveMode)) {
      return parsed.approveMode;
    }
    log.debug("prefs", "unrecognized approve mode; using default");
    return set.fallback;
  } catch (err) {
    // ENOENT is the normal first run (and every `mise run dev`, which wipes
    // the state dir) — don't make it read like a failure.
    const absent = (err as NodeJS.ErrnoException)?.code === "ENOENT";
    log.debug(
      "prefs",
      absent
        ? "no prefs file; using default approve mode"
        : "prefs unreadable; using default approve mode",
    );
    return set.fallback;
  }
}

/** Persist the remembered approve-variant id (last-write-wins; no per-id locking,
 * per the issue's constraint). An id outside the declared set is ignored so a
 * malformed request can't corrupt the stored value. */
export async function writeApproveMode(
  mode: ApproveVariantId,
  file = prefsFile(),
  log: CaretLogger = noopLogger,
  set: ApproveModeSet = DEFAULT_SET,
): Promise<void> {
  if (!set.valid.includes(mode)) {
    // A malformed request reached us — ignored, but worth attention.
    log.warn("prefs", "ignoring invalid approve mode");
    return;
  }
  ensureStateDir(dirname(file));
  // 0600: prefs.json shares the state dir with plan bodies; keep it private too.
  await writeFile(file, JSON.stringify({ approveMode: mode }, null, 2), { mode: 0o600 });
  log.debug("prefs", `approve mode saved: ${mode}`);
}
