// Port, state directory, and identity-signature resolution.
//
// Phase-0 spike outcome (the contract the rest of the code relies on): plan
// approval is gated via a `PermissionRequest` hook matching `ExitPlanMode` — NOT
// `PreToolUse` (which only permits the tool to run, so the native dialog still
// shows). See src/feedback.ts for the decision JSON this produces.

import { homedir } from "node:os";

export const VERSION = "0.0.1";
export const DEFAULT_PORT = 42718;

/** Identity signature returned by GET /api/health, used to detect a foreign
 * process squatting on the port. */
export const IDENTITY = { service: "caret", version: VERSION } as const;

/** Resolve the daemon port: CARET_PORT (positive integer) or the default. */
export function getPort(): number {
  const raw = process.env.CARET_PORT;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return DEFAULT_PORT;
}

/** Root state dir: $XDG_STATE_HOME/caret or ~/.local/state/caret. Read lazily
 * so tests can override XDG_STATE_HOME per-case. */
export function stateDir(): string {
  const base = process.env.XDG_STATE_HOME || `${homedir()}/.local/state`;
  return `${base}/caret`;
}

/** Directory holding one <id>.json per persisted review. */
export function reviewsDir(): string {
  return `${stateDir()}/reviews`;
}

/** Idle auto-shutdown delay (ms). Overridable via CARET_IDLE_MS for tests. */
export function idleMs(): number {
  const raw = process.env.CARET_IDLE_MS;
  if (raw) {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 0) return n;
  }
  return 60_000;
}

/** Review timeout (ms): CARET_TIMEOUT seconds, default 3600s / 1h (< the 3900s
 * hook budget in hooks.json). After this, the hook fail-safe denies. */
export function reviewTimeoutMs(): number {
  const raw = process.env.CARET_TIMEOUT;
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.round(n * 1000);
  }
  return 3_600_000;
}
