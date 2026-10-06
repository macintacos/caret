// HTTP request guards for the daemon: the Host check that gates every request,
// the safe-method and cross-origin (CSRF) checks that gate state-changing ones,
// plus the client-liveness window the create path reads to decide whether the
// hook should foreground a browser tab. Split out of server.ts so the pure guard
// logic stays unit-testable on its own.

import { VANITY_HOST } from "@/config/constants.ts";
import { isExposed } from "@/daemon/address.ts";

/** How recently a UI tab must have polled GET /api/reviews to count as a live
 * client (EXC-559, EXC-562). It must comfortably exceed the browser's
 * background-tab throttle floor — Chrome caps a hidden tab's timers to roughly
 * one run per minute — or a backgrounded-but-open tab reads as gone and the hook
 * opens a redundant browser tab. The long window is safe because a closed tab
 * retracts its presence at once via the close beacon (POST /api/ui/gone). The same window
 * holds an on-demand daemon's idle shutdown off while a tab is open. */
export const LIVE_CLIENT_WINDOW_MS = 120_000;

/** Whether a UI client polled the reviews list recently enough to count as live
 * (EXC-559). `lastPollAt === 0` means no client has ever polled this daemon. */
export function isClientLive(lastPollAt: number, now: number, windowMs: number): boolean {
  return lastPollAt !== 0 && now - lastPollAt < windowMs;
}

/** GET and HEAD are the safe (non-mutating) HTTP methods. The CSRF guard gates
 * only non-safe methods, so a future mutating verb (DELETE/PATCH) is guarded by
 * default rather than needing an allowlist edit. */
export function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/** The names the daemon answers to, in two tiers. */
export interface OwnNames {
  /** Admitted only on the bound port: the built-in names and the connect hostname. */
  exact: ReadonlySet<string>;
  /** `daemon.hostnames` — admitted on any port, over http or https, so an HTTPS
   * reverse proxy forwarding its own Host and Origin still passes. */
  anyPort: ReadonlySet<string>;
}

/** Built-in hostnames: the loopback literal, its name, and the vanity host the hook
 * opens the UI under (EXC-426).
 *
 * VANITY_HOST is a residual the authority-exact port check does not cover:
 * browsers self-resolve `*.localhost` but glibc does not, so on a Linux desktop
 * whose resolver answers `caret.localhost` (a search domain, a wildcard zone) an
 * attacker controlling that answer can serve a page from the vanity origin and
 * rebind it. Dropping the host would break EXC-426; Vite's dev server carries
 * the same residual, so this is noted rather than closed. */
const BUILT_IN_NAMES: readonly string[] = ["127.0.0.1", "localhost", VANITY_HOST];

/** The names a daemon bound to the default loopback address answers to. */
export const LOOPBACK_NAMES: OwnNames = ownNames("127.0.0.1", []);

/** Built-in and loopback names never enter `anyPort`, so listing `localhost` or
 * `[::1]` in `daemon.hostnames` cannot make `http://localhost:3000` same-origin. */
export function ownNames(connectHostname: string, hostnames: readonly string[]): OwnNames {
  const anyPortSafe = (h: string) =>
    !BUILT_IN_NAMES.includes(h) && isExposed(h.replace(/^\[(.*)\]$/, "$1"));
  return {
    exact: new Set([...BUILT_IN_NAMES, connectHostname]),
    anyPort: new Set(hostnames.filter(anyPortSafe)),
  };
}

/** Whether an authority ("host" or "host:port") names THIS daemon — an `anyPort`
 * name on any port, or an `exact` name on its bound port. Parsed through URL so
 * `localhost` and `localhost:80` normalize alike ("80" is the default the `http://`
 * parse prefix implies), hostnames compare lowercased, and a userinfo dodge
 * (`localhost:42718@evil.com`) resolves to the hostname that actually applies. The
 * href round-trip rejects a value that parses but is not an authority:
 * `localhost:<port>/api` would otherwise answer "yes, that's me" to a Host that Bun
 * then prepends to the routed path. */
function isOwnAuthority(authority: string, port: number, names: OwnNames): boolean {
  try {
    const u = new URL(`http://${authority}`);
    if (u.href !== `http://${u.host}/`) return false;
    if (names.anyPort.has(u.hostname)) return true;
    return names.exact.has(u.hostname) && (u.port || "80") === String(port);
  } catch {
    return false;
  }
}

/** Reject any request whose Host is not this daemon's own — the DNS-rebinding
 * gate (EXC-1203), applied to safe methods too because rebinding defeats the
 * same-origin policy the read posture rests on, leaving Host the only header
 * that still names the attacker (doc/agents/architecture-rules.md § Daemon trust
 * model). A missing Host is rejected: HTTP/1.1 requires one and every real
 * client sends it. */
export function isForeignHost(
  req: Request,
  port: number,
  names: OwnNames = LOOPBACK_NAMES,
): boolean {
  const host = req.headers.get("host");
  return host === null || !isOwnAuthority(host, port, names);
}

/** Whether a serialized origin is one the daemon serves itself under — an `http:`
 * origin on an own authority, or an `https:` one on an `anyPort` name. */
function isOwnOrigin(origin: string, port: number, names: OwnNames): boolean {
  try {
    const u = new URL(origin);
    if (u.protocol === "https:") return names.anyPort.has(u.hostname);
    return u.protocol === "http:" && isOwnAuthority(u.host, port, names);
  } catch {
    return false;
  }
}

/** Reject non-safe (state-changing) requests that aren't same-origin (this
 * daemon's own origin). CSRF defense that holds whether or not token auth is on
 * (a browser carries the auth cookie on a cross-site write): a hook/CLI request
 * carries no Origin (allowed); the same-origin browser UI carries the daemon's own
 * origin (allowed); a page on another site — or on another local port — carries a
 * foreign Origin (blocked). Safe methods are let through deliberately
 * (doc/agents/architecture-rules.md § Daemon trust model). */
export function isCrossOrigin(
  req: Request,
  port: number,
  names: OwnNames = LOOPBACK_NAMES,
): boolean {
  const origin = req.headers.get("origin");
  if (origin && !isOwnOrigin(origin, port, names)) return true;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  return false;
}
