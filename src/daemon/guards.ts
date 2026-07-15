// HTTP request guards for the daemon: the safe-method and cross-origin (CSRF)
// checks that gate state-changing requests, plus the client-liveness window the
// create path reads to decide whether the hook should foreground a browser tab.
// Split out of server.ts so the pure guard logic stays unit-testable on its own.

import { VANITY_HOST } from "../config/constants.ts";

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

// Threat model (EXC-540). The daemon binds loopback only and runs with no auth,
// for a single-user laptop: any local process can already reach it, so the only
// adversary the daemon defends against is a *browser* on another origin that the
// user happens to have open. Read-confidentiality (a foreign page must not read
// plan bodies) rests on two things, neither of them this guard: the loopback
// bind keeps off-host callers out, and the daemon emits no `Access-Control-*`
// headers, so the browser's same-origin policy blocks a foreign page from
// reading any response — even a GET that reaches a handler. Because the SOP
// already protects reads, the CSRF guard below only gates state-changing
// (non-safe) methods, where the browser *can* fire a cross-origin request whose
// side effect lands even though the attacker can't read the reply. A safe
// method (GET/HEAD) is let through deliberately; that asymmetry is the
// read-confidentiality tax, and `test/core/daemon.test.ts` pins both halves (no
// CORS header is ever emitted; a cross-origin GET is allowed through).

/** GET and HEAD are the safe (non-mutating) HTTP methods. The CSRF guard gates
 * only non-safe methods, so a future mutating verb (DELETE/PATCH) is guarded by
 * default rather than needing an allowlist edit. */
export function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

/** Reject non-safe (state-changing) requests that aren't same-origin (loopback).
 * The daemon has no auth, so this is CSRF defense-in-depth: a hook/CLI request
 * carries no Origin (allowed); the same-origin browser UI carries a loopback
 * Origin (allowed); a page on another site carries a foreign Origin (blocked).
 * No preflight (OPTIONS) handler exists or is needed — a same-origin request
 * sends none, and the daemon advertises no CORS headers, so a cross-origin
 * preflight would be denied by the browser before any request body is sent. */
export function isCrossOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (origin) {
    try {
      const host = new URL(origin).hostname;
      if (host !== "127.0.0.1" && host !== "localhost" && host !== VANITY_HOST) return true;
    } catch {
      return true;
    }
  }
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return true;
  return false;
}
