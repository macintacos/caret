// Cross-cutting constants with no behavior. Pure TS, no node imports — so the
// browser bundle and config files (ui/vite.config.ts) can import these
// without dragging in the daemon's node-only dependency chain.

/** Default daemon port — the [daemon].port schema default (EXC-430). */
export const DEFAULT_PORT = 42718;

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
