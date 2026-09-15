// Machine-global preferences, persisted as a single JSON file under stateDir. It
// holds the `updates.check` kill switch for the daemon's daily update check. Every
// read fails safe — to a check that stays on.
//
// Writes go through one PrefsWriter, which merges rather than replaces and
// serializes its read-modify-writes, so no write drops another's key.

import { dirname } from "node:path";

import { ensureStateDir, prefsFile } from "@/config/paths.ts";
import { writeFileAtomic } from "@/lib/atomic-write.ts";
import { readJsonFile } from "@/lib/json-file.ts";
import { createKeyedQueue } from "@/lib/keyed-queue.ts";

/** Whether the daemon's daily update check is on (EXC-1205). Default-on: only an
 * explicit `updates.check === false` turns it off, so a missing file, a missing key,
 * and a junk value all read as `true` — a corrupt prefs.json must not silently
 * disable the check. Every failure means the same thing, so it rides the shared
 * readJsonFile collapse rather than a bespoke try/catch. */
export async function readUpdatesCheck(file = prefsFile()): Promise<boolean> {
  const parsed = (await readJsonFile(file)) as { updates?: { check?: unknown } } | null;
  return parsed?.updates?.check !== false;
}

/** A serialized read-modify-write over prefs.json. Every merge on one writer queues
 * behind the last, so two concurrent writes cannot both read the pre-write file and
 * lose one another's key. In-process serialization is sufficient because the daemon
 * is the only process that writes this file — there is no cross-process lock. */
export interface PrefsWriter {
  /** The top-level prefs keys to write, shallow-merged over what is on disk.
   * `object` rather than `Record<string, unknown>` so a declared wire type
   * (PrefsPatch) passes: an interface carries no implicit index signature. */
  merge(patch: object): Promise<void>;
}

/** Build the writer the prefs write path uses. The queue is closure state rather than
 * a module global so a test can drive a fresh chain — and so the daemon can hold
 * exactly one, over its own prefs path. */
export function createPrefsWriter(file = prefsFile()): PrefsWriter {
  const writes = createKeyedQueue();
  return {
    merge(patch) {
      return writes.run(file, async () => {
        ensureStateDir(dirname(file));
        // Merge rather than replace, so a patch naming one key leaves the rest of the
        // file alone.
        //
        // ponytail: one level deep, so a patch supplying `updates` replaces the whole
        // object. `updates.check` is its only key today; a second key under `updates`
        // is when a deep merge earns its keep.
        const existing = ((await readJsonFile(file)) as Record<string, unknown> | null) ?? {};
        // 0600: prefs.json shares the state dir with plan bodies; keep it private too.
        await writeFileAtomic(file, JSON.stringify({ ...existing, ...patch }, null, 2), {
          mode: 0o600,
        });
      });
    },
  };
}
