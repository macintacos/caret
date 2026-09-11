// The periodic work a daemon that respawns per review gets for free from its own
// restart (EXC-1164): re-arming the throttled update check, dropping stale reviews
// from memory, and rotating the stderr log spawnDaemon would otherwise be the only
// one to check. Each task's throw is contained — an hourly timer reaching onFatal
// would take a resident daemon down over a housekeeping failure.

import type { CaretLogger } from "@/lib/log.ts";
import { errorMessage } from "@/lib/types.ts";

/** One hour: enough that the 24h-stamped update check gets ~24 chances a day to
 * notice its stamp expiring, and ample for a log that only receives crash output. */
const UPKEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface UpkeepTask {
  /** Named so a failure says which task failed. */
  name: string;
  run: () => void;
}

export interface UpkeepDeps {
  tasks: readonly UpkeepTask[];
  log: CaretLogger;
  everyMs?: number;
  /** Schedules the repeating tick. The default unrefs, so an armed timer never
   * holds a stopped daemon's loop open. */
  schedule?: (fn: () => void, ms: number) => void;
}

/** Arm the upkeep tick and return the names of the tasks it armed. A no-op
 * returning [] when there is nothing to run. */
export function startUpkeep({ tasks, log, everyMs, schedule }: UpkeepDeps): string[] {
  if (tasks.length === 0) return [];
  const ms = everyMs ?? UPKEEP_INTERVAL_MS;
  const arm =
    schedule ??
    ((fn: () => void, every: number) => {
      setInterval(fn, every).unref();
    });
  arm(() => {
    for (const task of tasks) {
      try {
        task.run();
      } catch (e) {
        log.warn("upkeep", `${task.name} failed`, { detail: errorMessage(e) });
      }
    }
  }, ms);
  const names = tasks.map((task) => task.name);
  log.info("upkeep", "upkeep armed", { everyMs: ms, tasks: names });
  return names;
}
