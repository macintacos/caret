// HTTP request guards for the daemon: the Host check that gates every request,
// the safe-method and cross-origin (CSRF) checks that gate state-changing ones,
// plus the client-liveness window the create path reads to decide whether the
// hook should foreground a browser tab. Split out of server.ts so the pure guard
// logic stays unit-testable on its own.

import { VANITY_HOST } from "@/config/constants.ts";

/** How recently a UI tab must have polled GET /api/reviews to count as a live
 * client (EXC-559, EXC-562). It must comfortably exceed the browser's
 * background-tab throttle floor — Chrome caps a hidden tab's timers to roughly
 * one run per minute — because a backgrounded-but-open tab polls that slowly; a
 * shorter window would read such a tab as gone and let the hook open a redundant
 * browser tab. The long window is safe because a closed tab retracts its
 * presence at once via the close beacon (POST /api/ui/gone, handleUiGone), so
 * the window only ever has to outlast a throttled poll, never a closed tab. The
 * hook reads the resulting hasLiveClient flag (on the create response) to decide
 * whether to foreground the browser — see isClientLive. */
export const LIVE_CLIENT_WINDOW_MS = 120_000;

/** Whether a UI client polled the reviews list recently enough to count as live
 * (EXC-559). Pure so the load-bearing window is unit-testable by passing the
 * clock in. `lastPollAt === 0` means no client has ever polled this daemon. */
export function isClientLive(lastPollAt: number, now: number, windowMs: number): boolean {
  return lastPollAt !== 0 && now - lastPollAt < windowMs;
}

// Threat model (EXC-540, EXC-1203). The daemon binds loopback only and runs with
// no auth, for a single-user laptop: the only adversary it defends against is a
// *browser* on another origin that the user happens to have open. Read-
// confidentiality (a foreign page must not read plan bodies) rests on two things,
// neither of them the CSRF guard: the loopback bind keeps off-host callers out,
// and the daemon emits no `Access-Control-*` headers, so the browser's same-origin
// policy blocks a foreign page from reading any response — even a GET that reaches
// a handler.
//
// The two guards below split that adversary by which header still names it:
//
//   - `isForeignHost` gates EVERY method, safe ones included. Under DNS
//     rebinding the attacker's page *is* same-origin with the daemon — it sends a
//     loopback Origin and `Sec-Fetch-Site: same-origin` — so the SOP the read
//     posture rests on has already been defeated and the CSRF guard structurally
//     cannot see the attack. Only Host still carries `evil.com`.
//   - `isCrossOrigin` gates only state-changing (non-safe) methods, where the
//     browser *can* fire a cross-origin request whose side effect lands even
//     though the attacker can't read the reply. A safe method (GET/HEAD) is let
//     through deliberately; that asymmetry is the read-confidentiality tax.
//
// Both comparisons are authority-exact — an own hostname AND the daemon's bound
// port — so a page on some other `http://localhost:<port>` (a Vite dev server, a
// locally-hosted app, a dev server a malicious npm package started) is a foreign
// origin rather than "loopback, therefore us". `test/core/daemon/server.test.ts`
// pins every half: no CORS header is ever emitted, a cross-origin GET is allowed
// through, a foreign Host is not, and neither is a stranger's localhost port.
//
// One residual the port half does not cover: VANITY_HOST is in OWN_HOSTNAMES, and
// browsers self-resolve `*.localhost` — but glibc does not, so on a Linux desktop
// whose resolver answers `caret.localhost` (a search domain, a wildcard zone) an
// attacker who controls that answer can serve a page from the vanity origin and
// rebind it. Dropping the host would break EXC-426; Vite's dev server carries the
// same residual, so this is noted rather than closed.
//
// OUT OF SCOPE, on the record: nothing here authenticates a *local* caller. A
// same-uid process can already edit the plan files and CLAUDE.md directly; the
// cross-uid case (a shared box, a shared netns, CI) is an accepted limit — see
// doc/agents/architecture-rules.md § Daemon trust model.

/** GET and HEAD are the safe (non-mutating) HTTP methods. The CSRF guard gates
 * only non-safe methods, so a future mutating verb (DELETE/PATCH) is guarded by
 * default rather than needing an allowlist edit. */
export function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/** Hostnames the daemon answers to: the loopback literal, its name, and the
 * vanity host the hook opens the UI under (EXC-426). */
const OWN_HOSTNAMES: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", VANITY_HOST]);

/** Whether an authority ("host" or "host:port") names THIS daemon — one of its
 * hostnames AND its bound port. Parsed through URL so `localhost` and
 * `localhost:80` normalize alike ("80" is the default the `http://` parse prefix
 * implies, so the two must change together), and so a userinfo dodge
 * (`localhost:42718@evil.com`) resolves to the hostname that actually applies.
 * The href round-trip rejects a value that parses but is not an authority:
 * `localhost:<port>/api` would otherwise answer "yes, that's me" to a Host that
 * Bun then prepends to the routed path. */
function isOwnAuthority(authority: string, port: number): boolean {
  try {
    const u = new URL(`http://${authority}`);
    if (u.href !== `http://${u.host}/`) return false;
    return OWN_HOSTNAMES.has(u.hostname) && (u.port || "80") === String(port);
  } catch {
    return false;
  }
}

/** Reject any request whose Host is not this daemon's own — the DNS-rebinding
 * gate (EXC-1203), applied to safe methods too for the reason in the threat
 * model above. A missing Host is rejected: HTTP/1.1 requires one and every real
 * client sends it. */
export function isForeignHost(req: Request, port: number): boolean {
  const host = req.headers.get("host");
  return host === null || !isOwnAuthority(host, port);
}

/** Whether a serialized origin is one the daemon serves itself under — scheme,
 * hostname AND port, so `http://localhost:3000` no longer passes as loopback. */
function isOwnOrigin(origin: string, port: number): boolean {
  try {
    const u = new URL(origin);
    return u.protocol === "http:" && isOwnAuthority(u.host, port);
  } catch {
    return false;
  }
}

/** Reject non-safe (state-changing) requests that aren't same-origin (this
 * daemon's own origin). The daemon has no auth, so this is CSRF defense-in-depth:
 * a hook/CLI request carries no Origin (allowed); the same-origin browser UI
 * carries the daemon's own origin (allowed); a page on another site — or on
 * another local port — carries a foreign Origin (blocked). No preflight (OPTIONS)
 * handler exists or is needed: a same-origin request sends none, and the daemon
 * advertises no CORS headers, so a cross-origin preflight would be denied by the
 * browser before any request body is sent. */
export function isCrossOrigin(req: Request, port: number): boolean {
  const origin = req.headers.get("origin");
  if (origin && !isOwnOrigin(origin, port)) return true;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  return false;
}
