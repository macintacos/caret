// What is left of prefs.json (EXC-1354): a one-time move of the `updates.check`
// opt-out into config.toml, run at daemon boot before the server binds. Everything
// else the file used to hold now lives in config.toml or in the browser.

import { readFile, rm } from "node:fs/promises";

import type { ConfigWriter } from "@/config/config-write.ts";
import type { CaretLogger } from "@/lib/log.ts";

/** Carry a legacy `updates.check === false` into config.toml, then delete the file.
 * Only the opt-out migrates — a default-on check needs nothing written, and the
 * remembered approve mode is browser state a daemon cannot write, so it resets once.
 *
 * A refused config edit keeps prefs.json, so the next boot tries again rather than
 * silently re-enabling a daily third-party call the user turned off. */
export async function migratePrefsFile(opts: {
  prefs: string;
  config: string;
  writer: ConfigWriter;
  log: CaretLogger;
}): Promise<void> {
  const { prefs, config, writer, log } = opts;
  let text: string;
  try {
    text = await readFile(prefs, "utf-8");
  } catch (err) {
    // Absence is the ordinary case and carries nothing. Any other read failure may still
    // be hiding an opt-out, so the file stays for the next boot rather than the delete
    // below taking the answer with it.
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      log.warn("settings", "cannot read prefs.json", { prefs });
    }
    return;
  }
  if (optedOut(text)) {
    const wrote = await writer.setUpdatesCheck(false);
    if (!wrote.ok) {
      // daemon.log is the only channel this has: the reviewer is never told, and every
      // boot retries, so the record has to be enough to act on by itself.
      log.warn("settings", "cannot move updates.check into config.toml", {
        config,
        reason: wrote.reason,
        fix: "edit it by hand: check = false under an [updates] table header",
      });
      return;
    }
    // The settings watcher's baseline predates this write, so without a record of our
    // own the only trace is a `settings changed` line that reads as the user's own edit.
    log.info("settings", "moved updates.check into config.toml");
  }
  // Gone either way — carried over, nothing to carry, or unparseable; a file left behind
  // would be probed on every boot forever.
  await rm(prefs, { force: true }).catch(() => {});
}

/** Whether the legacy file carried the opt-out; text caret cannot parse carried nothing. */
function optedOut(text: string): boolean {
  try {
    return (JSON.parse(text) as { updates?: { check?: unknown } } | null)?.updates?.check === false;
  } catch {
    return false;
  }
}
