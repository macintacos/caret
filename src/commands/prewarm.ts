// `caret prewarm`: warm-start the daemon ahead of the first review. A PostToolUse
// hook — best-effort, it never blocks or denies.

import { prodService } from "@/commands/install/service.ts";
import { loadSettings } from "@/config/settings.ts";
import { ensureDaemon, prodEnsureDeps } from "@/daemon/lifecycle.ts";
import { logDebug } from "@/lib/log.ts";
import { errorMessage } from "@/lib/types.ts";

export async function runPrewarm(): Promise<void> {
  try {
    await ensureDaemon(await prodEnsureDeps(loadSettings(), () => prodService().manager));
  } catch (e) {
    logDebug("prewarm", `prewarm failed: ${errorMessage(e)}`);
    process.stderr.write(`caret prewarm: ${e}\n`);
  }
  process.exit(0);
}
