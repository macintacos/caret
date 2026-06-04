// Leveled NDJSON logging via pino. Two sinks share one record shape
// ({"level":30,"time":...,"step":"x","msg":"...",...}): the short-lived
// `caret review` hook appends to caret.log (see paths.logFile); the daemon
// logs to stderr, which spawnDaemon redirects into daemon.log. /caret:debug
// reads both.
//
// Two hard rules carried over from the old sentinel logger: writes are
// SYNCHRONOUS (pino.destination({ sync: true }), so a deny logged just before
// process.exit in the fail-safe/signal paths is durable), and logging NEVER
// throws — construction and every emit are wrapped, degrading to a silent
// no-op on failure (a logging failure must not turn an allow into a deny or
// crash a hook). Error records sit at pino's highest level (50) in our set, so
// they emit regardless of the configured level for free.

import { mkdirSync } from "node:fs";
import pino from "pino";
import { logFile, stateDir } from "./paths.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ErrorContext {
  sessionId?: string;
  cwd?: string;
}

/** The leveled surface both sinks expose. debug/info/warn take a human message
 * plus optional structured `extra`; error takes the raw thrown value (an
 * Error's `cause` chain is serialized) with an optional override message. */
export interface CaretLogger {
  debug(step: string, msg: string, extra?: object): void;
  info(step: string, msg: string, extra?: object): void;
  warn(step: string, msg: string, extra?: object): void;
  error(step: string, err: unknown, msg?: string): void;
}

const pinoOpts = {
  base: undefined,
  serializers: { err: pino.stdSerializers.errWithCause },
} as const;

/** Build a CaretLogger over the given pino instance, with never-throw wrapping
 * on every emit. `liveLevel` is re-applied before each call so config edits and
 * setLogLevel hot-reload. */
function wrap(logger: pino.Logger, liveLevel: () => LogLevel): CaretLogger {
  function emit(method: "debug" | "info" | "warn", step: string, msg: string, extra?: object) {
    try {
      logger.level = liveLevel();
      logger[method]({ step, ...extra }, msg);
    } catch {
      // Logging is non-essential and must never destabilize the caller.
    }
  }
  return {
    debug: (step, msg, extra) => emit("debug", step, msg, extra),
    info: (step, msg, extra) => emit("info", step, msg, extra),
    warn: (step, msg, extra) => emit("warn", step, msg, extra),
    error(step, err, msg) {
      try {
        logger.level = liveLevel();
        const fields: Record<string, unknown> = { step };
        if (err instanceof Error) fields.err = err;
        logger.error(fields, msg ?? (err instanceof Error ? err.message : String(err)));
      } catch {
        // Same swallow: a failed error write still must not propagate.
      }
    },
  };
}

/** A logger that drops everything — the degraded mode when a destination can't
 * be opened (e.g. the state dir's parent is a regular file), and the daemon's
 * default when no logger is injected (tests stay quiet). */
export const noopLogger: CaretLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// Module-level current level for the hook logger. setLogLevel updates it; wrap's
// liveLevel thunk re-reads it on every emit, so the live instance follows along.
let currentLevel: LogLevel = "info";

// The hook's pino instance is a lazy singleton, but tests swap XDG_STATE_HOME
// per case, so cache it keyed by the resolved logFile() path and rebuild when
// that path changes — a stale destination would silently write to the previous
// temp dir. Construction failure caches null and the module functions no-op.
let hookPino: pino.Logger | null = null;
let hookPath: string | null = null;

function hookRaw(): pino.Logger | null {
  const path = logFile();
  if (hookPino && hookPath === path) return hookPino;
  hookPath = path;
  try {
    mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    hookPino = pino(pinoOpts, pino.destination({ dest: path, sync: true, mode: 0o600 }));
  } catch {
    // Degrade silently but do NOT latch the failure: the next emit retries the
    // mkdir/open (the old logger's per-call semantics), so a transient failure
    // doesn't permanently silence a long-running daemon's logError path.
    hookPino = null;
  }
  return hookPino;
}

function hook(): CaretLogger {
  const logger = hookRaw();
  return logger ? wrap(logger, () => currentLevel) : noopLogger;
}

/** Set the hook logger's level (the hook injects loadSettings().logging.level).
 * Takes effect on the next emit, including for an already-built instance. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function logDebug(step: string, msg: string, extra?: object): void {
  hook().debug(step, msg, extra);
}

export function logInfo(step: string, msg: string, extra?: object): void {
  hook().info(step, msg, extra);
}

export function logWarn(step: string, msg: string, extra?: object): void {
  hook().warn(step, msg, extra);
}

/** Append an error record to caret.log. msg is the Error's message (or the
 * stringified value for a non-Error); the `err` field — with its serialized
 * cause chain — is included only for real Errors; sessionId/cwd ride along from
 * ctx. Best-effort: never throws. */
export function logError(step: string, err: unknown, ctx?: ErrorContext): void {
  // CaretLogger.error has no slot for ctx fields, so go straight to the shared
  // pino instance and fold step + ctx + err into one record before the write.
  try {
    const logger = hookRaw();
    if (!logger) return;
    logger.level = currentLevel;
    const fields: Record<string, unknown> = { step };
    if (ctx?.sessionId) fields.sessionId = ctx.sessionId;
    if (ctx?.cwd) fields.cwd = ctx.cwd;
    if (err instanceof Error) fields.err = err;
    logger.error(fields, err instanceof Error ? err.message : String(err));
  } catch {
    // Logging is non-essential and must never destabilize the hook.
  }
}

/** A leveled logger for the long-running daemon. Writes NDJSON to stderr (fd 2,
 * which spawnDaemon redirects into daemon.log) by default; `dest` overrides the
 * sink (a file path) so tests don't spew to the real stderr. `base.pid` tags
 * every record; the `level()` thunk is re-read before each emit so config.toml
 * edits hot-reload. Never throws. */
export function createDaemonLogger(level: () => LogLevel, dest?: string | number): CaretLogger {
  try {
    const target =
      dest === undefined
        ? pino.destination({ fd: 2, sync: true })
        : pino.destination({ dest, sync: true });
    const logger = pino({ ...pinoOpts, base: { pid: process.pid } }, target);
    return wrap(logger, level);
  } catch {
    return noopLogger;
  }
}
