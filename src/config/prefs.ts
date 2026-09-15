// What is left of prefs.json (EXC-1354): a one-time move of the `updates.check`
// opt-out into config.toml, run at daemon boot before the server binds. Everything
// else the file used to hold now lives in config.toml or in the browser.

import { rm } from "node:fs/promises";

import type { ConfigWriter } from "@/config/config-write.ts";
import { readJsonFile } from "@/lib/json-file.ts";
import type { CaretLogger } from "@/lib/log.ts";

/** Carry a legacy `updates.check === false` into config.toml, then delete the file.
 * Only the opt-out migrates — a default-on check needs nothing written, and the
 * remembered approve mode is browser state a daemon cannot write, so it resets once.
 *
 * A refused config edit keeps prefs.json, so the next boot tries again rather than
 * silently re-enabling a daily third-party call the user turned off. */
export async function migratePrefsFile(
  file: string,
  writer: ConfigWriter,
  log: CaretLogger,
): Promise<void> {
  const parsed = (await readJsonFile(file)) as { updates?: { check?: unknown } } | null;
  if (parsed === null) {
    // Absent, unreadable, or corrupt — nothing to carry either way, and an unreadable
    // file left behind would be probed on every boot forever.
    await rm(file, { force: true }).catch(() => {});
    return;
  }
  if (parsed.updates?.check === false && !(await writer.setUpdatesCheck(false))) {
    log.warn("settings", "cannot move updates.check into config.toml");
    return;
  }
  await rm(file, { force: true }).catch(() => {});
}
