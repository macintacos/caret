// Cross-cutting constants with no behavior. Pure TS, no node imports — so the
// browser bundle and config files (ui/vite.config.ts) can import these
// without dragging in the daemon's node-only dependency chain.

/** Default daemon port — the [daemon].port schema default (EXC-430). */
export const DEFAULT_PORT = 42718;

/**
 * Sent verbatim as the deny feedback when the reviewer clicks Reject (EXC-685):
 * a concise signal that the plan was rejected and the agent should wait for the
 * user's next message rather than revising and re-presenting the plan. Unlike
 * Request changes, Reject carries no inline comments — only this message. Lives
 * in @core (not the UI) so both the browser (which sends it) and the dev driver
 * (which recognizes it to simulate the agent waiting) share one source of truth.
 */
export const PLAN_REJECTED_MESSAGE =
  "The user rejected the plan. Wait for the user's next message to decide how to proceed; do not present a plan for review again unless they ask.";

/** The PermissionRequest hook's `timeout` budget (seconds) declared in
 * `hooks/hooks.json` (EXC-531). The review-timeout ceiling (`TimeoutS` in
 * settings.ts) is a strict `.lt(...)` of this, so caret's own fail-safe deny
 * always emits before Claude Code can kill the hook. Named once here — the
 * single source the schema bound and the coupling test
 * (test/adapters/claude/hooks-timeout) both reference — so the two numbers can't
 * drift into the dangerous direction
 * (hook killed before the deny ships). */
export const HOOK_TIMEOUT_S = 3900;

/** "Never idle out" sentinel for the idle-shutdown delay (ms): the max
 * setTimeout delay (2^31-1). A larger value overflows the 32-bit timer and
 * clamps to ~1ms, firing the idle shutdown immediately — the trap this guards
 * against. Used where a daemon must stay up for a whole dev/test session
 * regardless of inactivity (the dev task, the e2e daemon, the dev review
 * timeout cap). */
export const NEVER_IDLE_MS = 2147483647;

// --- Decision long-poll socket timing (EXC-533) ---
//
// caret's transport stays polling: the daemon long-polls the hook's /decision
// request and returns a 204 heartbeat after `heartbeatMs`, well before any
// socket idle timeout can close the connection mid-wait. The invariant the
// connection depends on is `idleTimeout > heartbeat`. The WebSocket/SSE
// migration is deliberately DEFERRED (EXC-527 §2): Bun's WebSocket idle is
// hard-capped at 255s and `sendPings` does not reliably reset idle (a WS still
// needs app-level heartbeats), so a rewrite relocates rather than removes this
// timing — for a marginal latency win on a single-user laptop tool and the
// highest regression risk in the audit. Instead the invariant holds by
// construction: idleTimeout is derived from the heartbeat, and the heartbeat is
// bounded so the derivation can never breach Bun's cap.

/** Bun's hard cap on a server socket's `idleTimeout` (seconds). A larger value
 * passed to `Bun.serve` is silently clamped to this, so the derived idleTimeout
 * must never exceed it. */
export const BUN_SOCKET_IDLE_CAP_S = 255;

/** Headroom (seconds) the derived idleTimeout adds above the heartbeat window,
 * so a 204 heartbeat always ships before the socket can idle out. */
export const IDLE_TIMEOUT_HEADROOM_S = 5;

/** Upper bound on `heartbeat_ms` / `CARET_HEARTBEAT_MS` (the schema's exclusive
 * `.lt`): the largest heartbeat for which the derived idleTimeout stays at or
 * below Bun's cap while keeping the full headroom. At this ceiling
 * `ceil(ms/1000) + headroom` equals the cap exactly, so the derivation never
 * clamps within the allowed range and `idleTimeout > heartbeat` holds for every
 * accepted value. */
export const MAX_HEARTBEAT_MS = (BUN_SOCKET_IDLE_CAP_S - IDLE_TIMEOUT_HEADROOM_S) * 1000;

/** Derive the `Bun.serve` socket `idleTimeout` (seconds) from the resolved
 * heartbeat window (ms): the heartbeat in whole seconds plus a fixed headroom,
 * clamped to Bun's hard cap. Pure so the `idleTimeout > heartbeat` invariant is
 * unit-testable across the configurable heartbeat range without standing up a
 * server. With the heartbeat bounded to below `MAX_HEARTBEAT_MS` the clamp stays
 * inert in range, so the result is always strictly greater than `heartbeatMs`. */
export function deriveIdleTimeoutSec(heartbeatMs: number): number {
  return Math.min(Math.ceil(heartbeatMs / 1000) + IDLE_TIMEOUT_HEADROOM_S, BUN_SOCKET_IDLE_CAP_S);
}
