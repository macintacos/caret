// The UI-log wire boundary (EXC-445): the browser ships log events that get
// written through the daemon's CaretLogger, so the batch is structurally
// validated and its data sanitized before emit. This module is the canonical
// home of those wire constants and the batch parser.
//
// Browser-safe pure TS — no node imports — so it can be shared with the UI side
// of the bridge (ui/src/lib/log.ts) without breaking the browser bundle.

// POST /api/logs caps and constraints.
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_EVENTS = 100;
export const MAX_MSG_LEN = 256;

export interface UiLogEvent {
  level: "debug" | "info" | "warn" | "error";
  step: string;
  msg: string;
  extra?: Record<string, unknown>;
}

export const STEP_RE = /^[a-z][a-z0-9-]{0,31}$/;
// The record's own NDJSON fields: an extra key colliding with one of these would
// shadow the structural field, so they're stripped from client extra. `caller` is
// stamped by src/lib/log.ts (file:line of the call site); bridged UI records carry
// none, so a client-sent one is a forged provenance and is dropped too (EXC-451).
export const RESERVED_KEYS = new Set(["level", "time", "msg", "step", "pid", "err", "caller"]);
// C0/C1 control chars except TAB (U+0009). Newline (U+000A) is stripped too:
// pino already JSON-escapes newlines at serialization, so this is defense in
// depth for raw-text consumers of the log (redact round-trips, crash-output
// interleaving, future sinks) — not the only thing preventing a forged record.
// Written with \u escapes (no literal control bytes in source): U+0000–U+0008,
// U+000A–U+001F, U+007F–U+009F.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the intent
export const CONTROL_RE = /[\u0000-\u0008\u000A-\u001F\u007F-\u009F]/g;

export function sanitizeString(s: string): string {
  return s.replace(CONTROL_RE, "");
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Validate the envelope/events structurally (any violation → whole-batch 400)
 * and sanitize each event's data (always applied, never a rejection). Exported
 * for direct testability. The raw-byte cap (413) stays in the route, which holds
 * the request text; here a >MAX_EVENTS count is the only 413 case. */
export function parseUiLogBatch(raw: unknown): { events: UiLogEvent[] } | { status: 400 | 413 } {
  if (!isPlainObject(raw) || !Array.isArray(raw.events)) return { status: 400 };
  if (raw.events.length > MAX_EVENTS) return { status: 413 };
  const events: UiLogEvent[] = [];
  for (const e of raw.events) {
    if (!isPlainObject(e)) return { status: 400 };
    const { level, step, msg, extra } = e;
    if (level !== "debug" && level !== "info" && level !== "warn" && level !== "error") {
      return { status: 400 };
    }
    if (typeof step !== "string" || !STEP_RE.test(step)) return { status: 400 };
    if (typeof msg !== "string") return { status: 400 };
    if (extra !== undefined && !isPlainObject(extra)) return { status: 400 };

    const safeExtra: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (RESERVED_KEYS.has(k)) continue; // drop collisions with record fields
      safeExtra[k] = typeof v === "string" ? sanitizeString(v) : v;
    }
    // Forgery defense: the server is the sole authority on provenance, so force
    // source="ui" over any client-sent value.
    safeExtra.source = "ui";
    events.push({
      level,
      step,
      msg: sanitizeString(msg).slice(0, MAX_MSG_LEN),
      extra: safeExtra,
    });
  }
  return { events };
}
