// `caret login-link`: print the link that logs a browser into the review UI. Reads
// config.toml and the token file only — never the daemon, and never mints a token, which
// would diverge from the one a running daemon holds.

import { daemonTokenFile } from "@/config/paths.ts";
import { getPort, loadSettings } from "@/config/settings.ts";
import { authEnabled, isExposed, loginLink, publicUrl } from "@/daemon/address.ts";
import { readToken } from "@/daemon/token.ts";

/** The warning for an exposed bind with auth turned off, else null. */
export function exposureWarning(
  daemon: { host: string; auth?: "token" | "none" | undefined },
  port: number,
): string | null {
  if (!isExposed(daemon.host) || authEnabled(daemon)) return null;
  return `caret: warning: daemon.auth = "none" on an exposed daemon (daemon.host = ${daemon.host}) — anyone on the network who can reach port ${port} can read plans, read files under a review's working directory, and approve a plan.`;
}

/** What `caret login-link` prints and exits with, given the settings and the token
 * file's contents (null when absent). */
export function loginLinkOutcome(
  daemon: { host: string; hostnames: readonly string[]; auth?: "token" | "none" | undefined },
  port: number,
  token: string | null,
  tokenFile: string,
): { stdout?: string; stderr: string[]; code: 0 | 1 } {
  const url = publicUrl(daemon, port);
  if (!authEnabled(daemon)) {
    const warning = exposureWarning(daemon, port);
    return {
      stderr: [
        `caret: daemon auth is off, so there is no login link — open ${url} instead.`,
        ...(warning === null ? [] : [warning]),
      ],
      code: 1,
    };
  }
  if (token === null) {
    return {
      stderr: [
        `caret: no daemon token at ${tokenFile} yet — start the daemon (caret serve, or the caret service) to mint one.`,
      ],
      code: 1,
    };
  }
  return { stdout: loginLink(url, token), stderr: [], code: 0 };
}

export function runLoginLink(): void {
  const s = loadSettings();
  const file = daemonTokenFile();
  const token = authEnabled(s.daemon) ? readToken(file) : null;
  const o = loginLinkOutcome(s.daemon, getPort(s), token, file);
  for (const line of o.stderr) process.stderr.write(`${line}\n`);
  if (o.stdout !== undefined) process.stdout.write(`${o.stdout}\n`);
  process.exitCode = o.code;
}
