// `caret serve`: run the daemon resident in the foreground — the alternative to the service.

import { runDaemon } from "@/commands/daemon.ts";
import { exposureWarning, publicUrl } from "@/commands/login-link.ts";
import { daemonTokenFile, stateDir } from "@/config/paths.ts";
import { settings } from "@/config/settings.ts";
import { authEnabled, daemonBaseUrl, loginLink } from "@/daemon/address.ts";
import { httpHealth } from "@/daemon/client.ts";
import { readDaemonLock, retireDaemon, vacatePort } from "@/daemon/lifecycle.ts";
import { DRAIN_DEADLINE_MS } from "@/daemon/server.ts";
import { readToken } from "@/daemon/token.ts";

export async function runServe(): Promise<void> {
  const world = stateDir();
  const refusal = await vacatePort({
    baseUrl: daemonBaseUrl(settings().current()),
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
  const { port, settings: booted } = await runDaemon({ ephemeral: false, resident: true });
  const url = publicUrl(booted, port);
  process.stdout.write(`caret is serving the review UI at ${url} — Ctrl+C stops it.\n`);
  const token = authEnabled(booted.daemon) ? readToken(daemonTokenFile()) : null;
  if (token !== null) {
    process.stdout.write(
      `Open this link once on each device to log it in: ${loginLink(`${url}/`, token)}\n`,
    );
  }
  const warning = exposureWarning(booted.daemon, port);
  if (warning !== null) process.stderr.write(`${warning}\n`);
}
