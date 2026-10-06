// `caret login-link`: print the link that logs a browser into the review UI. Reads
// config.toml and the token file only — never the daemon, and never mints a token, which
// would diverge from the one a running daemon holds.

import { daemonTokenFile } from "@/config/paths.ts";
import { getPort, loadSettings, type Settings } from "@/config/settings.ts";
import { authEnabled, isExposed, loginLink, publicHostname } from "@/daemon/address.ts";
import { readToken } from "@/daemon/token.ts";

/** The warning for an exposed bind with auth turned off, else null. */
export function exposureWarning(
  daemon: { host: string; auth?: "token" | "none" | undefined },
  port: number,
): string | null {
  if (!isExposed(daemon.host) || authEnabled(daemon)) return null;
  return `caret: warning: daemon.auth = "none" on an exposed daemon (daemon.host = ${daemon.host}) — anyone on the network who can reach port ${port} can read plans, read files under a review's working directory, and approve a plan.`;
}

/** The review UI's URL as humans elsewhere are sent to it. */
export function publicUrl(s: Settings, port: number): string {
  return `http://${publicHostname(s.daemon)}:${port}`;
}

export function runLoginLink(): void {
  const s = loadSettings();
  const port = getPort(s);
  if (!authEnabled(s.daemon)) {
    process.stderr.write(
      `caret: daemon auth is off, so there is no login link — open ${publicUrl(s, port)} instead.\n`,
    );
    const warning = exposureWarning(s.daemon, port);
    if (warning !== null) process.stderr.write(`${warning}\n`);
    process.exitCode = 1;
    return;
  }
  const file = daemonTokenFile();
  const token = readToken(file);
  if (token === null) {
    process.stderr.write(
      `caret: no daemon token at ${file} yet — start the daemon (caret serve, or the caret service) to mint one.\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`${loginLink(`${publicUrl(s, port)}/`, token)}\n`);
}
