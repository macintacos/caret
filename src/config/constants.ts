// Cross-cutting constants and the pure predicates over them. Pure TS, no node imports — so the
// browser bundle and config files (ui/vite.config.ts) can import these
// without dragging in the daemon's node-only dependency chain.

/** Default daemon port — the [daemon].port schema default (EXC-430). */
export const DEFAULT_PORT = 42718;

// --- Log rotation (EXC-1068) ---
//
// The defaults live here rather than in log.ts because settings.ts imports
// logError from log.ts, so log.ts importing the resolved settings back would
// close a cycle. Both the schema defaults and the hook logger's pre-settings
// seed read them from here.

/** Size (bytes) a live log must exceed before it is archived — the
 * [logging].max_size schema default. */
export const DEFAULT_LOG_MAX_SIZE = 5 * 1024 * 1024;

/** Gzipped archives retained per log — the [logging].keep schema default.
 * Older ones are pruned oldest-first after each rotation. */
export const DEFAULT_LOG_KEEP = 10;

/** Floor on max_size / CARET_LOG_MAX_SIZE. A near-zero threshold would rotate
 * on essentially every record, burning the archive budget on fragments and
 * turning each emit into a read-truncate-gzip cycle. */
export const MIN_LOG_MAX_SIZE = 64 * 1024;

/** Ceiling on max_size / CARET_LOG_MAX_SIZE. Rotation reads the whole file into
 * a Buffer and gzips it synchronously on the emit path, so an unbounded
 * threshold fails in the one direction that matters: past Buffer's max length
 * the read throws, the swallow catches it, and the log never rotates again —
 * the unbounded growth this exists to prevent, wearing a config knob that looks
 * like it is working. Bounded for the same reason MAX_HEARTBEAT_MS is. */
export const MAX_LOG_MAX_SIZE = 256 * 1024 * 1024;

/** The vanity host the hook opens the review UI under (EXC-426). Resolves to
 * loopback per RFC 6761 (mDNSResponder system-wide; Chrome/Firefox special-case
 * it internally), so the 127.0.0.1 bind needs no change. Shared here because the
 * daemon's Host and cross-origin guards (which allow it) and review
 * orchestration (which opens it) all reference the one host. */
export const VANITY_HOST = "caret.localhost";

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

/** Lines of context on each side of a referenced `:line` — the ± window the
 * daemon builds around a file reference (`readFileExcerpt` in src/plan/excerpt.ts).
 * Shared here because the preview panel pads a cited RANGE by the same radius
 * before asking for it, so the two framings agree by construction rather than by
 * a number copied into the browser bundle. */
export const EXCERPT_RADIUS = 30;

/** Most cited lines an opening file preview fetches at once. Every other excerpt
 * request is bounded by geometry — a ±radius window, a head window, or a chunk
 * sized off the viewport — but a `path:start-end` reference is sized by whatever
 * the plan wrote, and the panel highlights and mounts the opening window whole
 * before it has a row height to window by. A longer citation opens parked at its
 * first line and the rest arrives through the panel's own scroll-driven growth,
 * which is what the reader would do with it anyway. */
export const MAX_CITED_SPAN_LINES = 200;

// File extensions a plan's prose is likely to cite. Neither runtime uses this to
// decide what a reference *is* — the filesystem answers that (EXC-916) — so it is
// only ever a narrowing on top: the link layer folds it into a broader gate — a
// collapsed `[label](target)` earns a reference only when its target names a file
// by extension or spans more than one segment (EXC-956) — and the basename search
// fires only for a name shaped like one. Broad enough to cover the source and config kinds a
// plan cites, narrow enough that `obj.property` and `e.g` cost nothing.
const KNOWN_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "svelte",
  "vue",
  "json",
  "jsonc",
  "css",
  "scss",
  "less",
  "html",
  "htm",
  "xml",
  "svg",
  "md",
  "mdx",
  "py",
  "rb",
  "rs",
  "go",
  "java",
  "kt",
  "c",
  "h",
  "cc",
  "cpp",
  "hpp",
  "sh",
  "bash",
  "zsh",
  "toml",
  "yaml",
  "yml",
  "ini",
  "sql",
  "graphql",
  "gql",
  "php",
  "swift",
  "dart",
  "txt",
  "lock",
  "cfg",
  "conf",
]);

/** Whether `path`'s last segment reads as `name.ext` for one of the extensions a
 * plan is likely to cite. Requires a real name before the dot, so a bare `.ts`, a
 * dotfile like `.env`, and anything ending in `/` are all false here. They are
 * still perfectly good references — this only decides whether the two narrowings
 * above apply, and neither should fire on a name it cannot read as a file. */
export function hasKnownFileExtension(path: string): boolean {
  const base = path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 && KNOWN_FILE_EXTENSIONS.has(base.slice(dot + 1).toLowerCase());
}

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
