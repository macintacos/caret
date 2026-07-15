// `caret daemon`: run the review daemon. Boots the settings service (hot-reload
// + boot-time validation), wires the leveled NDJSON logger, rehydrates the
// store, binds the HTTP server, and installs the signal/exit cleanup that frees
// the lock on shutdown (EXC-406).

import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import { selectAdapter } from "../adapters/index.ts";
import { currentBuildId, currentCommit } from "../lib/build-id.ts";
import { isAddrInUse } from "../daemon/lifecycle.ts";
import { type CaretServer, createServer } from "../daemon/server.ts";
import { createDaemonLogger } from "../lib/log.ts";
import { configFile, daemonLock, reviewsDir, stateDir } from "../config/paths.ts";
import { getPort, heartbeatMs, idleMs, settings, watchSettings } from "../config/settings.ts";
import { createStore } from "../review/store.ts";
import { loadUiAssets } from "../ui/assets.ts";
import { warnInvalidEnvVars } from "./boot.ts";

export async function runDaemon(opts: { ephemeral: boolean }): Promise<void> {
  // Leveled NDJSON to stderr (spawnDaemon redirects it into daemon.log). The
  // level and redact thunks re-read svc.current() per emit, so config.toml
  // edits hot-reload without a restart — and the boot line below doubles as
  // the EXC-429 settings warm: an invalid config is detected and logged here,
  // not on first use. The watcher records which keys changed when a reload is
  // detected (i.e. on the first emit after the edit — detection is as lazy as
  // the reload itself). NB: a change record is an info emit, so raising
  // [logging].level above info suppresses it like any other info record.
  // The change record's msg already carries old → new per key; the full
  // settings object rides only on the boot record.
  const svc = watchSettings(settings(), (changes) =>
    log.info("settings", `settings changed: ${changes.join("; ")}`),
  );
  const log = createDaemonLogger(
    () => svc.current().logging.level,
    undefined,
    () => svc.current().logging.redact,
  );
  const cfg = configFile();
  // The boot snapshot: logged below and reused for the startup-captured
  // tunables (port/idle/heartbeat), so the boot record provably matches the
  // values the server binds with — a config edit landing mid-boot can't split
  // them. The record holds the VALIDATED parse only — schema-constrained
  // values — never raw config text, which may hold anything (the settings.ts
  // logValidationFailure invariant). This is also the watcher's baseline read,
  // so boot never fires a spurious change record.
  const boot = svc.current();
  log.info(
    "settings",
    existsSync(cfg) ? `settings: reading ${cfg}` : `settings: no config at ${cfg}; using defaults`,
    { settings: boot },
  );
  warnInvalidEnvVars((msg) => log.warn("env", msg));
  // The active adapter (CARET_AGENT, default claude). Its declared approve
  // variants are published in /api/health so the UI renders its approve
  // split-button from the capability rather than baked-in tool mode names.
  const adapter = selectAdapter();
  const store = createStore(reviewsDir(), log);
  await store.rehydrate();
  const assets = await loadUiAssets();
  if (!assets) log.info("ui", "no embedded ui; serving placeholder");
  // `caret daemon --ephemeral` (EXC-461): bind an OS-assigned port instead of
  // the configured one. A process flag, not a setting — the dev task owns the
  // daemon and discovers the bound port from the lock, so port resolution for
  // hooks (getPort) is untouched.
  const ephemeral = opts.ephemeral;
  let server: CaretServer;
  try {
    server = createServer({
      store,
      port: ephemeral ? 0 : getPort(boot),
      idleMs: idleMs(boot),
      heartbeatMs: heartbeatMs(boot),
      assets,
      lockPath: daemonLock(),
      buildId: await currentBuildId(),
      commit: currentCommit(),
      // World + boot identity (EXC-461): stateDir is the world key (never
      // logged — identifying); the per-boot instanceId is the loggable handle.
      stateDir: stateDir(),
      instanceId: randomUUID().slice(0, 8),
      approveVariants: adapter.approveVariants,
      // The active adapter's id, published on /api/health so the UI can adapt to
      // the environment (EXC-791).
      source: adapter.id,
      log,
    });
  } catch (e) {
    if (isAddrInUse(e)) {
      process.stderr.write("caret: another daemon won the port; exiting.\n");
      process.exit(0);
    }
    throw e;
  }
  // Cleanup is wired ONLY after a successful bind + lock write: a daemon that
  // lost the EADDRINUSE race exits via the catch above without a lock, so it
  // must never reach here and unlink the winner's lock. stop() removes the lock;
  // pending reviews are already write-through to disk and rehydrate on restart.
  const shutdown = (code: number) => {
    server.stop();
    process.exit(code);
  };
  // Signal deaths leave a record (the synchronous write is durable before the
  // exit); fatal errors log through the daemon's own sink, not caret.log.
  process.once("SIGTERM", () => {
    log.info("signal", "sigterm: shutting down");
    shutdown(0);
  });
  process.once("SIGINT", () => {
    log.info("signal", "sigint: shutting down");
    shutdown(0);
  });
  const onFatal = (label: string) => (err: unknown) => {
    log.error(label, err);
    shutdown(1);
  };
  process.once("uncaughtException", onFatal("uncaughtException"));
  process.once("unhandledRejection", onFatal("unhandledRejection"));
  // Last-resort synchronous unlink in case an exit path bypassed stop().
  process.once("exit", () => {
    try {
      unlinkSync(daemonLock());
    } catch {
      // already removed by stop(), or never written — both fine.
    }
  });
  // Bun.serve keeps the process alive; the daemon idle-auto-shuts-down.
}
