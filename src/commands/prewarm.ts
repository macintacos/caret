// `caret prewarm`: warm-start the daemon ahead of the first review. A PostToolUse
// hook — best-effort, it never blocks or denies.

import { prodService } from "@/commands/service-target.ts";
import { loadSettings, type Settings } from "@/config/settings.ts";
import { type EnsureDeps, ensureDaemon, prodEnsureDeps } from "@/daemon/lifecycle.ts";
import { logDebug } from "@/lib/log.ts";
import { errorMessage } from "@/lib/types.ts";

/** The fallback spawn's time past the supervisor window. Keep `SUPERVISOR_WINDOW_MS`
 * (src/daemon/lifecycle.ts), this, and one overrunning attempt under this hook's `timeout`
 * in hooks/hooks.json (coupling test: test/adapters/claude/hooks-timeout). */
const PREWARM_RESERVE_MS = 5_000;

/** The deps `runPrewarm` ensures with, exported so the coupling test reads the deadline
 * production actually builds. */
export function prewarmEnsureDeps(s: Settings): Promise<EnsureDeps> {
  return prodEnsureDeps(s, () => prodService().manager, PREWARM_RESERVE_MS);
}

export async function runPrewarm(): Promise<void> {
  try {
    await ensureDaemon(await prewarmEnsureDeps(loadSettings()));
  } catch (e) {
    logDebug("prewarm", `prewarm failed: ${errorMessage(e)}`);
    process.stderr.write(`caret prewarm: ${e}\n`);
  }
  process.exit(0);
}
