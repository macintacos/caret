// Browser-side logger facade. Buffers UI log events and POSTs them in batches
// to the daemon's POST /api/logs (fire-and-forget). The daemon merges them into
// the same NDJSON timeline as the hook/daemon sinks (see src/log.ts) so a human
// or /caret:debug can reconstruct what the UI did alongside the backend.
//
// Two invariants carried from src/log.ts's wrap(), adapted for the browser:
// transport is non-essential and NEVER throws into the UI (every public entry
// is wrapped by safe() and swallows; a failed POST drops the batch silently),
// and call sites must NOT put load-bearing side effects in log arguments — an
// emit can no-op, so the expression you pass may never run.
//
// This module starts nothing at import time: startLogBridge() installs the
// flush timer and pagehide handler, and returns a stop function.

import { scrubGraph, shortId } from "@core/redact/core";
import { MAX_EVENTS, MAX_MSG_LEN, STEP_RE } from "@core/ui/log-bridge";

export { shortId };

// Mirror of src/log.ts's LogLevel — the wire contract's level field.
type LogLevel = "debug" | "info" | "warn" | "error";

// Coherent with the endpoint's caps: BUFFER_MAX == the endpoint's MAX_EVENTS so
// one flush can never 413 on event count; FLUSH_THRESHOLD flushes early.
const BUFFER_MAX = MAX_EVENTS;
const FLUSH_THRESHOLD = 20;
const FLUSH_INTERVAL_MS = 5000;

/** Run `fn`, swallowing any throw — the browser-side "logging never throws"
 * guarantee in one place. Transport and censoring are non-essential, so a
 * failure here must degrade to a silent no-op rather than destabilize the UI.
 * Every public entry point routes through this. */
function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is non-essential and must never destabilize the UI.
  }
}

interface LogEvent {
  level: LogLevel;
  step: string;
  msg: string;
  extra?: object;
}

/** Censor DENY_KEYS values in a value graph (the shared scrubGraph walk with no
 * string transform, so only DENY_KEYS bodies are replaced). Runs at
 * construction — before buffering AND before the dev console mirror — so the
 * mirror structurally cannot print what the daemon would scrub. The daemon
 * re-censors authoritatively on write; this is the mirror constraint + defense
 * in depth, not the only line of defense. */
function censor(v: unknown): unknown {
  return scrubGraph(v);
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
  safe(() => {
    if (buffer.length === 0) return;
    const events = buffer;
    buffer = [];
    void fetch("/api/logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: opts?.keepalive ?? false,
    }).catch(() => {});
  });
}

function emit(level: LogLevel, step: string, msg: string, extra?: object): void {
  safe(() => {
    // Normalize to the wire contract: invalid step falls back to "ui", msg is
    // truncated like the server would truncate it, and an array extra (a valid
    // `object` to TS) is wrapped into the plain object the endpoint requires.
    const safeStep = STEP_RE.test(step) ? step : "ui";
    const safeMsg = msg.slice(0, MAX_MSG_LEN);
    const obj = Array.isArray(extra) ? { value: extra } : extra;
    const clean = obj === undefined ? undefined : (censor(obj) as object);
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
    // static replacement strips this branch from the production browser
    // bundle; under bun test it resolves via process.env (undefined) → off.
    if (import.meta.env.DEV) console[level](`[${safeStep}] ${safeMsg}`, clean ?? "");
  });
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
