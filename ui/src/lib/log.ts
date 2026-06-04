// Browser-side logger facade. Buffers UI log events and POSTs them in batches
// to the daemon's POST /api/logs (fire-and-forget). The daemon merges them into
// the same NDJSON timeline as the hook/daemon sinks (see src/log.ts) so a human
// or /caret:debug can reconstruct what the UI did alongside the backend.
//
// Two invariants carried from src/log.ts's wrap(), adapted for the browser:
// transport is non-essential and NEVER throws into the UI (every public entry
// is wrapped and swallows; a failed POST drops the batch silently), and call
// sites must NOT put load-bearing side effects in log arguments — an emit can
// no-op, so the expression you pass may never run.
//
// This module starts nothing at import time: startLogBridge() installs the
// flush timer and pagehide handler, and returns a stop function.

// Mirror of src/log.ts's LogLevel — the wire contract's level field.
type LogLevel = "debug" | "info" | "warn" | "error";

// Coherent with the endpoint's caps: BUFFER_MAX == the endpoint's MAX_EVENTS so
// one flush can never 413 on event count; FLUSH_THRESHOLD flushes early.
const BUFFER_MAX = 100;
const FLUSH_THRESHOLD = 20;
const FLUSH_INTERVAL_MS = 5000;

// Hand-mirror of DENY_KEYS in src/redact.ts — keep in sync. Values under these
// keys are censored client-side before buffering AND before the dev console
// mirror, so the mirror structurally cannot print what the daemon would scrub.
const DENY_KEYS = new Set(["plan", "prompt", "feedback"]);

// Hand-mirrors of the endpoint's wire constraints (src/daemon.ts) — keep in
// sync. The endpoint rejects a WHOLE batch (400) on one invalid event, so the
// facade normalizes each event at construction rather than letting one sloppy
// call site silently drop its co-batched neighbors.
const STEP_RE = /^[a-z][a-z0-9-]{0,31}$/;
const MAX_MSG_LEN = 256;

// Cause/extra graphs are shallow; anything deeper is pathological (mirrors
// src/redact.ts MAX_DEPTH).
const MAX_DEPTH = 6;
const CENSOR = "<redacted>";

interface LogEvent {
  level: LogLevel;
  step: string;
  msg: string;
  extra?: object;
}

/** Censor DENY_KEYS values in a value graph, building NEW structures so the
 * caller's object is never mutated. Runs at construction — before buffering AND
 * before the dev console mirror — so the mirror structurally cannot print what
 * the daemon would scrub. Depth-capped and cycle-tolerant like src/redact.ts's
 * walk (`seen` tracks the current path only, so shared references are walked
 * normally while true cycles cut off). The daemon re-censors authoritatively on
 * write; this is the mirror constraint + defense in depth, not the only line
 * of defense. */
function censor(v: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (v === null || typeof v !== "object") return v;
  if (seen.has(v)) return "<cyclic>";
  // Replace (not pass through) at the cap, like src/redact.ts's walk — a
  // DENY_KEYS body nested past the cap must not reach the wire or the mirror.
  if (depth >= MAX_DEPTH) return "<depth-capped>";
  seen.add(v);
  let out: unknown;
  if (Array.isArray(v)) {
    out = v.map((el) => censor(el, depth + 1, seen));
  } else {
    const obj: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v)) {
      obj[k] = DENY_KEYS.has(k) ? CENSOR : censor(val, depth + 1, seen);
    }
    out = obj;
  }
  seen.delete(v);
  return out;
}

let buffer: LogEvent[] = [];

function push(event: LogEvent): void {
  buffer.push(event);
  // Drop-oldest ring: recency wins. A pure backstop — FLUSH_THRESHOLD drains
  // first under normal flow, so this only engages if a drain ever stalls (keeps
  // one flush's batch from exceeding the endpoint's MAX_EVENTS / blowing memory).
  if (buffer.length > BUFFER_MAX) buffer.shift();
  if (buffer.length >= FLUSH_THRESHOLD) flush();
}

/** Send buffered events as one batch, or nothing if the buffer is empty (an
 * idle backgrounded tab must not generate traffic). Swaps the buffer out before
 * the request, so a failed transport DROPS the batch — no requeue, no retry. */
export function flush(opts?: { keepalive?: boolean }): void {
  try {
    if (buffer.length === 0) return;
    const events = buffer;
    buffer = [];
    void fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: opts?.keepalive ?? false,
    }).catch(() => {});
  } catch {
    // Transport is non-essential and must never destabilize the UI.
  }
}

function emit(level: LogLevel, step: string, msg: string, extra?: object): void {
  try {
    // Normalize to the wire contract: invalid step falls back to "ui", msg is
    // truncated like the server would truncate it, and an array extra (a valid
    // `object` to TS) is wrapped into the plain object the endpoint requires.
    const safeStep = STEP_RE.test(step) ? step : "ui";
    const safeMsg = msg.slice(0, MAX_MSG_LEN);
    const obj = Array.isArray(extra) ? { value: extra } : extra;
    const clean = obj === undefined ? undefined : (censor(obj, 0, new WeakSet()) as object);
    const event: LogEvent = {
      level,
      step: safeStep,
      msg: safeMsg,
      ...(clean === undefined ? {} : { extra: clean }),
    };
    // Buffer BEFORE the mirror: a throwing (monkeypatched) console must only
    // cost the mirror, never the wire event.
    push(event);
    // Dev-only console mirror, on the ALREADY-censored event so it can't print a
    // DENY_KEYS body. `import.meta.env.DEV` is referenced directly so Vite's
    // static replacement strips this branch from the production single-file
    // bundle; under bun test it resolves via process.env (undefined) → off.
    if (import.meta.env.DEV) console[level](`[${safeStep}] ${safeMsg}`, clean ?? "");
  } catch {
    // Logging is non-essential and must never destabilize the UI.
  }
}

export const uiLog = {
  debug: (step: string, msg: string, extra?: object) => emit("debug", step, msg, extra),
  info: (step: string, msg: string, extra?: object) => emit("info", step, msg, extra),
  warn: (step: string, msg: string, extra?: object) => emit("warn", step, msg, extra),
  error(step: string, err: unknown, extra?: object) {
    emit("error", step, err instanceof Error ? err.message : String(err), extra);
  },
};

/** Install the flush timer and a pagehide flush (keepalive, so the final batch
 * survives the tab unloading). Returns a stop function that clears both.
 * Nothing runs until this is called. */
export function startLogBridge(): () => void {
  const timer = setInterval(() => flush(), FLUSH_INTERVAL_MS);
  const onHide = () => flush({ keepalive: true });
  window.addEventListener("pagehide", onHide);
  return () => {
    clearInterval(timer);
    window.removeEventListener("pagehide", onHide);
  };
}
