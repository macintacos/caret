// Shared teardown wiring for the tasks that supervise child processes (dev, the
// smoke bin/bundle targets): register one cleanup function to run on normal exit
// and on SIGINT/SIGTERM. Without this, a Ctrl-C or `kill` would skip the
// 'exit' handler and orphan the spawned daemon/driver/Vite children — so the
// signal handlers run cleanup explicitly, then exit with the conventional
// 128+signal code (SIGINT=130, SIGTERM=143).

/** Register `cleanup` for normal exit and for SIGINT/SIGTERM. `cleanup` MUST be
 * idempotent: on a signal it runs once in the handler and then again from the
 * subsequent 'exit', so a re-entrancy guard in `cleanup` keeps the second call a
 * no-op. */
export function installCleanupHandlers(cleanup: () => void): void {
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
}
