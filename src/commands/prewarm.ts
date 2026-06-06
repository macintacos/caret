// `caret prewarm`: warm-start the daemon ahead of the first review. A PostToolUse
// hook — best-effort, it never blocks or denies.

import { ensureDaemon, prodEnsureDeps } from "../daemon-lifecycle.ts";
import { logDebug } from "../log.ts";
import { loadSettings } from "../settings.ts";

export async function runPrewarm(): Promise<void> {
  // Best-effort warm start; never blocks or denies (it's a PostToolUse hook).
  try {
    await ensureDaemon(await prodEnsureDeps(loadSettings()));
  } catch (e) {
    logDebug("prewarm", `prewarm failed: ${e instanceof Error ? e.message : e}`);
    process.stderr.write(`caret prewarm: ${e}\n`);
  }
  process.exit(0);
}
