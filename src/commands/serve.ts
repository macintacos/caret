// `caret serve`: run the daemon resident in the foreground — the alternative to the service.

import { runDaemon } from "@/commands/daemon.ts";
import { VANITY_HOST } from "@/config/constants.ts";
import { stateDir } from "@/config/paths.ts";
import { getPort } from "@/config/settings.ts";
import { httpHealth } from "@/daemon/client.ts";
import { readDaemonLock, retireDaemon, vacatePort } from "@/daemon/lifecycle.ts";
import { DRAIN_DEADLINE_MS } from "@/daemon/server.ts";

export async function runServe(): Promise<void> {
  const world = stateDir();
  const refusal = await vacatePort({
    baseUrl: `http://localhost:${getPort()}`,
    currentStateDir: world,
    // The retired daemon drains first, then needs a moment to exit.
    deadlineMs: DRAIN_DEADLINE_MS + 5_000,
    health: httpHealth,
    retire: (baseUrl) => retireDaemon(baseUrl, readDaemonLock(), world),
    now: Date.now,
    sleep: Bun.sleep,
  });
  if (refusal !== null) {
    process.stderr.write(`caret: ${refusal}.\n`);
    process.exitCode = 1;
    return;
  }
  // ponytail: a hook can still spawn into the gap before the bind, and serve then exits as a
  // lost port race; loop vacate-and-bind if that shows up in practice.
  const port = await runDaemon({ ephemeral: false, resident: true });
  process.stdout.write(
    `caret is serving the review UI at http://${VANITY_HOST}:${port} — Ctrl+C stops it.\n`,
  );
}
