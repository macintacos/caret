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
import { dirname } from "node:path";
import pino from "pino";
import { logFile, stateDir } from "./paths.ts";
import { scrubString, scrubValue } from "./redact.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

// Package root, computed once: src/log.ts lives in <root>/src, so the root is
// the parent of this module's dir. callerLocation() strips a leading
// "<root>/" off captured frames to yield repo-relative paths (src/cli.ts,
// test/log.test.ts) — see EXC-451. import.meta.dir is the directory of THIS
// file, resolved through Bun's sourcemap remap so the compiled binary agrees.
const PKG_ROOT = dirname(import.meta.dir);

// A Bun stack frame, either named or anonymous (verified shapes):
//   `    at fnName (/abs/path.ts:12:34)`  and  `    at /abs/path.ts:12:34`
// Capture the file path (up to the line:col suffix) and the line number; the
// column is matched but discarded. A leading `file://` is allowed and stripped.
const FRAME = /^\s*at (?:.* \()?(?:file:\/\/)?(.+):(\d+):\d+\)?$/;

/** Repo-relative `path:line` of the call site that invoked a log method, for
 * the record's `caller` field (EXC-451) — e.g. `src/daemon.ts:295`. Parses the
 * stack STRING rather than the V8 CallSite API because Bun remaps the string
 * through sourcemaps, which is what the compiled binary needs. Skips the Error
 * header and every frame inside src/log.ts (the emit→arrow→log* wrappers; depth
 * varies by entry path, so suffix-match beats a fixed skip count), then takes
 * the first external frame. Returns undefined — never throws — on any parse
 * miss, so the field is simply omitted. */
function callerLocation(): string | undefined {
  try {
    const stack = new Error().stack;
    if (!stack) return undefined;
    for (const line of stack.split("\n")) {
      const m = FRAME.exec(line);
      if (!m?.[1] || !m[2]) continue; // no frame match (e.g. the `Error` header line)
      const path = m[1];
      if (path.endsWith("src/log.ts")) continue; // our own wrapper frames
      // Runtime-internal frames — pathless (`native:7:39`, `[eval]:1:30`) or
      // node:-scheme (`node:internal/...`) — are never the caller.
      if (!path.includes("/") || path.startsWith("node:")) continue;
      // Normalize: a relative path is already repo-relative (the compiled
      // binary's sourcemapped frames come out that way); an absolute one under
      // the package root loses that prefix; any other absolute path falls back
      // to its last two segments so the field stays compact.
      const rel = !path.startsWith("/")
        ? path
        : path.startsWith(`${PKG_ROOT}/`)
          ? path.slice(PKG_ROOT.length + 1)
          : path.split("/").slice(-2).join("/");
      return `${rel}:${m[2]}`;
    }
    return undefined;
  } catch {
    return undefined; // parsing must never destabilize a log emit
  }
}

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

/** Review-id prefix (the first UUID segment) for log MESSAGES: keeps lines
 * scannable without restating the full id, which rides in the structured
 * `reviewId` extra field for stitching/queries (EXC-444). */
export function shortId(id: string): string {
  return id.slice(0, 8);
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

// Module-level current level + redact toggle for the hook logger. setLogLevel/
// setRedact update them; wrap's thunks re-read on every emit, so the live
// instance follows along. Redact defaults off to match the schema default —
// raw logs day-to-day; `caret redact` produces shareable copies on demand.
let currentLevel: LogLevel = "info";
let currentRedact = false;

// The hook's logger is a lazy singleton, but tests swap XDG_STATE_HOME per
// case, so cache it keyed by the resolved logFile() path and rebuild (closing
// the previous destination so its fd doesn't leak) when that path changes — a
// stale destination would silently write to the previous temp dir.
let hookDest: ReturnType<typeof pino.destination> | null = null;
let hookView: CaretLogger | null = null;
let hookPath: string | null = null;

function hook(): CaretLogger {
  const path = logFile();
  if (hookView && hookPath === path) return hookView;
  hookPath = path;
  try {
    mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    const dest = pino.destination({ dest: path, sync: true, mode: 0o600 });
    try {
      hookDest?.destroy(); // sync mode has nothing buffered; just release the fd
    } catch {
      // already closed — nothing to release.
    }
    hookDest = dest;
    hookView = wrap(
      pino(pinoOpts, dest),
      () => currentLevel,
      () => currentRedact,
      "hook",
    );
  } catch {
    // Degrade silently but do NOT latch the failure: the next emit retries the
    // mkdir/open (the old logger's per-call semantics), so a transient failure
    // doesn't permanently silence a long-running daemon's logError path.
    hookView = null;
  }
  return hookView ?? noopLogger;
}

/** Set the hook logger's level (the hook injects loadSettings().logging.level).
 * Takes effect on the next emit, including for an already-built instance. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/** Set the hook logger's redact toggle (the hook injects
 * loadSettings().logging.redact). Takes effect on the next emit. */
export function setRedact(on: boolean): void {
  currentRedact = on;
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
    const target = pino.destination({ ...(dest === undefined ? { fd: 2 } : { dest }), sync: true });
    const logger = pino({ ...pinoOpts, base: { pid: process.pid } }, target);
    return wrap(logger, level, redact, "daemon");
  } catch {
    return noopLogger;
  }
}
