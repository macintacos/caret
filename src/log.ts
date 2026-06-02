// Errors-only logging for the short-lived `caret review` hook process. Entries
// land in caret.log (see paths.logFile). The daemon logs separately to
// daemon.log; /caret:debug reads both.
//
// Two hard rules: writes are SYNCHRONOUS (so a deny logged just before
// process.exit in the fail-safe/signal paths is durable), and logError NEVER
// throws (a logging failure must not turn an allow into a deny or crash a hook).

import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import { logFile, stateDir } from "./paths.ts";

export interface ErrorContext {
  sessionId?: string;
  cwd?: string;
}

function describe(err: unknown): { message: string; stack?: string; causes: string[] } {
  if (err instanceof Error) {
    const causes: string[] = [];
    let c: unknown = err.cause;
    while (c instanceof Error) {
      causes.push(c.message);
      c = c.cause;
    }
    if (c !== undefined && !(c instanceof Error)) causes.push(String(c));
    return { message: err.message, stack: err.stack, causes };
  }
  return { message: String(err), causes: [] };
}

/** One record, opened by a single sentinel header line so `/caret:debug` can
 * isolate the most recent error. Record-delimited plain text, not JSON. */
function formatEntry(step: string, err: unknown, ctx?: ErrorContext): string {
  const { message, stack, causes } = describe(err);
  const lines = [
    `=== caret error ${new Date().toISOString()} step=${step} ===`,
    `message: ${message}`,
  ];
  if (causes.length) lines.push(`cause: ${causes.join(" <- ")}`);
  const ctxParts: string[] = [];
  if (ctx?.sessionId) ctxParts.push(`sessionId=${ctx.sessionId}`);
  if (ctx?.cwd) ctxParts.push(`cwd=${ctx.cwd}`);
  if (ctxParts.length) lines.push(`context: ${ctxParts.join(" ")}`);
  lines.push(stack ?? "(no stack)");
  return `${lines.join("\n")}\n\n`;
}

/** Append a timestamped error entry to caret.log. Best-effort: creates the
 * state dir (0700) and file (0600) if missing, writes the whole entry in one
 * atomic O_APPEND call, and swallows any failure. */
export function logError(step: string, err: unknown, ctx?: ErrorContext): void {
  try {
    mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    const fd = openSync(logFile(), "a", 0o600);
    try {
      writeSync(fd, formatEntry(step, err, ctx));
    } finally {
      closeSync(fd);
    }
  } catch {
    // Logging is non-essential and must never destabilize the hook.
  }
}
