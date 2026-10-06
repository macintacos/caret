// How the daemon is reached: pure address classification and URL building over the
// [daemon] host / hostnames / auth settings (EXC-1570).

import { getPort, type Settings } from "@/config/settings.ts";

/** Loopback is 127.0.0.0/8, ::1 and localhost; the wildcards and every other address
 * are exposed. A non-canonical ::1 spelling counts as exposed, erring toward auth on. */
export function isExposed(host: string): boolean {
  return !(host === "localhost" || host === "::1" || /^127\.\d+\.\d+\.\d+$/.test(host));
}

/** daemon.auth wins when set; unset, auth is on exactly when the bind is exposed. */
export function authEnabled(daemon: {
  host: string;
  auth?: "token" | "none" | undefined;
}): boolean {
  return daemon.auth === undefined ? isExposed(daemon.host) : daemon.auth === "token";
}

/** The URL-hostname form a local client reaches a daemon bound to `host` through:
 * 0.0.0.0 → 127.0.0.1, :: → [::1], an IPv6 literal → bracketed and URL-normalized. */
export function connectHostname(host: string): string {
  if (host === "0.0.0.0") return "127.0.0.1";
  if (host === "::") return "[::1]";
  return new URL(`http://${host.includes(":") ? `[${host}]` : host}`).hostname;
}

/** The base URL every local CLI client uses. */
export function daemonBaseUrl(s: Settings): string {
  return `http://${connectHostname(s.daemon.host)}:${getPort(s)}`;
}

/** The name a browser on this machine reaches the daemon by: caret.localhost when local
 * clients connect over 127.0.0.1 or localhost (it resolves to 127.0.0.1), else the
 * connect hostname. */
export function localHostname(host: string): string {
  const name = connectHostname(host);
  return name === "127.0.0.1" || name === "localhost" ? "caret.localhost" : name;
}

/** The name humans elsewhere are sent to: the first daemon.hostnames entry, else
 * localHostname. */
export function publicHostname(daemon: { host: string; hostnames: readonly string[] }): string {
  return daemon.hostnames[0] ?? localHostname(daemon.host);
}

/** `url` with ?token=<token> added, keeping any existing query. */
export function loginLink(url: string, token: string): string {
  const u = new URL(url);
  u.searchParams.set("token", token);
  return u.href;
}
