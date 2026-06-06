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
import { callerLocation } from "./caller-location.ts";
import { logFile, stateDir } from "./paths.ts";
import { shortId } from "./redact-core.ts";
import { scrubString, scrubValue } from "./redact.ts";

// Re-exported so the daemon/hook/store/discovery call sites import their
// message helper from the logging module alongside the loggers themselves.
export { shortId };

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ErrorContext {
  sessionId?: string;
  cwd?: string;
  /** Set once the daemon has assigned the review an id — stitches caret.log
   * records against the daemon's review/resolve records (EXC-444). */
  reviewId?: string;
}

/** The leveled surface both sinks expose. debug/info/warn take a human message
 * plus optional structured `extra`; error takes the raw thrown value (an
 * Error's `cause` chain is serialized; msg derives from it) plus optional
 * `extra` fields (e.g. sessionId/cwd). `extra` keys must not collide with the
 * record's own fields (level/time/msg/step/pid/err/caller). (source is absent
 * here on purpose: an explicit extra.source is a sanctioned override — the
 * bridged-UI signal — not a collision.) */
export interface CaretLogger {
  debug(step: string, msg: string, extra?: object): void;
  info(step: string, msg: string, extra?: object): void;
  warn(step: string, msg: string, extra?: object): void;
  error(step: string, err: unknown, extra?: object): void;
}

const pinoOpts = {
  base: undefined, // suppress pino's default {pid, hostname}; the daemon opts pid back in
  // ISO 8601 UTC time ("2026-06-04T21:25:40.038Z") instead of pino's default
  // epoch ms, so a human can read a record's date/time without converting.
  timestamp: pino.stdTimeFunctions.isoTime,
  // wrap() owns error serialization (errWithCause + scrub). The identity
  // override disables pino's DEFAULT err serializer, which would re-serialize
  // the already-plain object and roll cause messages up into `message`.
  serializers: { err: (v: unknown) => v },
} as const;

/** Build a CaretLogger over the given pino instance, with never-throw wrapping
 * on every emit. `liveLevel` is re-applied before each gated call so config
 * edits and setLogLevel hot-reload; pino's level setter re-binds every level
 * method, so skip the assignment when the level is unchanged. `liveRedact`
 * (the [logging].redact switch, EXC-399) gates the redact.ts scrub of every
 * outgoing msg/extra/err — re-read per emit so it hot-reloads too. The walk
 * runs even with the switch off (plan/prompt/feedback censoring is
 * unconditional);
 * `step` is attached after it, raw: structural fields always win and a fixed
 * step token is never PII. `source` names the emitting process ("hook" or
 * "daemon", EXC-445) so every record carries its provenance; an explicit
 * extra.source wins — that's how the daemon tags bridged browser events "ui".
 * Errors are serialized here (errWithCause) rather
 * than via a pino serializer so the scrub can cover message/stack/cause —
 * pino's own `redact` option can't rewrite substrings inside those strings,
 * walk an unbounded cause chain, or hot-toggle (see src/redact.ts). */
function wrap(
  logger: pino.Logger,
  liveLevel: () => LogLevel,
  liveRedact: () => boolean,
  source: "hook" | "daemon",
): CaretLogger {
  function fields(extra: object | undefined, step: string, redact: boolean) {
    const out = scrubValue({ ...extra }, redact) as Record<string, unknown>;
    out.step = step;
    // When extra already carried a source it's a bridged record (the daemon
    // forwarding a browser event as source="ui", EXC-445): keep that tag and
    // attach NO caller — the call site here is the bridge, not the originator.
    // Otherwise tag the emitting process and stamp the real call site (EXC-451);
    // the caller is repo-relative so the redact scrub is normally a no-op, but
    // run it under the toggle for belt-and-braces. == null (not === undefined)
    // keeps the replaced ??= semantics: an explicit null source reads as unset.
    if (out.source == null) {
      out.source = source;
      const caller = callerLocation();
      if (caller !== undefined) out.caller = redact ? scrubString(caller) : caller;
    }
    return out;
  }
  function emit(method: "debug" | "info" | "warn", step: string, msg: string, extra?: object) {
    try {
      const next = liveLevel();
      if (logger.level !== next) logger.level = next;
      // Bail before fields()/callerLocation() when this record is gated out, so
      // a debug record at info level never pays for a stack capture (EXC-451).
      // error (50) needs no such gate — it clears every threshold in the set.
      if (!logger.isLevelEnabled(method)) return;
      const r = liveRedact();
      logger[method](fields(extra, step, r), r ? scrubString(msg) : msg);
    } catch {
      // Logging is non-essential and must never destabilize the caller.
    }
  }
  return {
    debug: (step, msg, extra) => emit("debug", step, msg, extra),
    info: (step, msg, extra) => emit("info", step, msg, extra),
    warn: (step, msg, extra) => emit("warn", step, msg, extra),
    error(step, err, extra) {
      try {
        // No level update here: error (50) passes every threshold in the set.
        const r = liveRedact();
        const f = fields(extra, step, r);
        if (err instanceof Error) f.err = scrubValue(pino.stdSerializers.errWithCause(err), r);
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(f, r ? scrubString(msg) : msg);
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

/** Build a hook-side CaretLogger over a fresh caret.log destination, mirroring
 * createDaemonLogger's injected-thunk shape so both sinks share one
 * construction path. Opens caret.log at the current logFile() path (creating
 * the 0700 state dir and 0600 file), and returns the logger paired with the
 * destination and the path it was opened for, so the caller can release the fd
 * and detect a path change. Degrades to noopLogger with a null dest if the
 * dir/file can't be opened — never throws. */
function createHookLogger(
  level: () => LogLevel,
  redact: () => boolean,
): { log: CaretLogger; dest: ReturnType<typeof pino.destination> | null; path: string } {
  const path = logFile();
  try {
    mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    const dest = pino.destination({ dest: path, sync: true, mode: 0o600 });
    return { log: wrap(pino(pinoOpts, dest), level, redact, "hook"), dest, path };
  } catch {
    return { log: noopLogger, dest: null, path };
  }
}

// The one hook-logger instance the log{Debug,Info,Warn,Error} wrappers ride
// over, plus the live level/redact the wrap() thunks re-read on every emit.
// Redact defaults off to match the schema default — raw logs day-to-day;
// `caret redact` produces shareable copies on demand. `instance` is lazily
// built and rebuilt when logFile() changes path (tests swap XDG_STATE_HOME per
// case, and a stale destination would silently write to the previous temp dir);
// resetHookLogger() is the explicit reset seam.
const hookState: {
  level: LogLevel;
  redact: boolean;
  instance: ReturnType<typeof createHookLogger> | null;
} = { level: "info", redact: false, instance: null };

/** The current hook logger, built on first use and rebuilt when its resolved
 * path changes (closing the previous destination so its fd doesn't leak). A
 * build failure is not latched: instance stays null so the next emit retries
 * the mkdir/open, so a transient failure doesn't permanently silence a
 * long-running process's logError path. */
function hook(): CaretLogger {
  const path = logFile();
  if (hookState.instance && hookState.instance.path === path) {
    return hookState.instance.log;
  }
  try {
    hookState.instance?.dest?.destroy(); // sync mode buffers nothing; just release the fd
  } catch {
    // already closed — nothing to release.
  }
  const next = createHookLogger(
    () => hookState.level,
    () => hookState.redact,
  );
  // Only latch a successfully-opened instance; a degraded build leaves the
  // cache null so the next emit retries.
  hookState.instance = next.dest ? next : null;
  return next.log;
}

/** Reset the hook logger for tests: close any open destination and drop the
 * cached instance and the level/redact overrides, so the next emit rebuilds
 * cleanly under the current XDG_STATE_HOME with default level/redact. Not part
 * of the runtime call-site API — the explicit seam that replaces leaning on
 * path-keyed cache invalidation to avoid cross-test bleed. */
export function resetHookLogger(): void {
  try {
    hookState.instance?.dest?.destroy();
  } catch {
    // already closed — nothing to release.
  }
  hookState.instance = null;
  hookState.level = "info";
  hookState.redact = false;
}

/** Set the hook logger's level (the hook injects loadSettings().logging.level).
 * Takes effect on the next emit, including for an already-built instance. */
export function setLogLevel(level: LogLevel): void {
  hookState.level = level;
}

/** Set the hook logger's redact toggle (the hook injects
 * loadSettings().logging.redact). Takes effect on the next emit. */
export function setRedact(on: boolean): void {
  hookState.redact = on;
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
  hook().error(step, err, ctx);
}

/** A leveled logger for the long-running daemon. Writes NDJSON to stderr (fd 2,
 * which spawnDaemon redirects into daemon.log) by default; `dest` overrides the
 * sink (a file path) so tests don't spew to the real stderr. `base.pid` tags
 * every record; the `level()` and `redact()` thunks are re-read before each
 * emit so config.toml edits hot-reload. Never throws. NB: tests always pass
 * `dest`; the fd-2 default is covered by the post-build daemon smoke, not
 * unit tests. */
export function createDaemonLogger(
  level: () => LogLevel,
  dest?: string | number,
  redact: () => boolean = () => false,
): CaretLogger {
  try {
    const target = pino.destination({
      ...(dest === undefined ? { fd: 2 } : { dest }),
      sync: true,
    });
    const logger = pino({ ...pinoOpts, base: { pid: process.pid } }, target);
    return wrap(logger, level, redact, "daemon");
  } catch {
    return noopLogger;
  }
}
