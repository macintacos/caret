// `caret serve`: run the daemon resident in the foreground — the alternative to the service.

import { runDaemon } from "@/commands/daemon.ts";
import { VANITY_HOST } from "@/config/constants.ts";

export async function runServe(): Promise<void> {
  const port = await runDaemon({ ephemeral: false, resident: true });
  process.stdout.write(
    `caret is serving the review UI at http://${VANITY_HOST}:${port} — Ctrl+C stops it.\n`,
  );
}
