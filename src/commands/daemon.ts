// `caret daemon`: run the review daemon. Boots the settings service (hot-reload
// + boot-time validation), wires the leveled NDJSON logger, rehydrates the
// store, binds the HTTP server, and installs the signal/exit cleanup that frees
// the lock on shutdown (EXC-406).

import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";

import { selectAdapter } from "@/adapters/index.ts";
import { warnInvalidEnvVars } from "@/commands/boot.ts";
import { configFile, daemonLock, reviewsDir, stateDir, updateCheckFile } from "@/config/paths.ts";
import { readUpdatesCheck } from "@/config/prefs.ts";
import {
  getPort,
  heartbeatMs,
  idleMs,
  isResident,
  logKeep,
  logMaxSize,
  settings,
  watchSettings,
} from "@/config/settings.ts";
import { buildDiagnostics, prodDiagnosticsDeps } from "@/daemon/diagnostics.ts";
import { isAddrInUse, removeOwnDaemonLock, rotateDaemonStderr } from "@/daemon/lifecycle.ts";
import { type CaretServer, createServer } from "@/daemon/server.ts";
import {
  fileUpdateCache,
  readCachedStatus,
  runUpdateCheck,
  updateReportFor,
} from "@/daemon/update-check.ts";
import { startUpkeep, type UpkeepTask } from "@/daemon/upkeep.ts";
import { buildHash, buildKind, currentBuildId, currentCommit, VERSION } from "@/lib/build-id.ts";
import { createDaemonLogger } from "@/lib/log.ts";
import { commitsAheadOfTrunk, latestReleaseTag, publishedCaretVersion } from "@/lib/upstream.ts";
import { createStore } from "@/review/store.ts";
import { isSupervised, SERVICE_TERMINAL_EXIT_STATUS } from "@/service/manager.ts";
import { loadUiAssets } from "@/ui/assets.ts";

export async function runDaemon(opts: { ephemeral: boolean }): Promise<void> {
  // The daemon's boot time, captured once for the /api/diagnostics uptime (EXC-842).
  const startedAt = Date.now();
  // Leveled NDJSON to logs/daemon.log, the path the logger owns and rotates.
  // The level, redact, and rotation thunks re-read svc.current() per emit, so config.toml
  // edits hot-reload without a restart — and the boot line below doubles as the EXC-429
  // settings warm: an invalid config is detected and logged here, not on first use.
  // Reload detection is as lazy as the reload itself: the watcher records what changed
  // on the first emit after the edit, as an info record, so raising [logging].level
  // above info suppresses it like any other.
  const svc = watchSettings(settings(), (changes) =>
    log.info("settings", `settings changed: ${changes.join("; ")}`),
  );
  const log = createDaemonLogger(
    () => svc.current().logging.level,
    undefined,
    () => svc.current().logging.redact,
    { maxSize: () => logMaxSize(svc.current()), keep: () => logKeep(svc.current()) },
  );
  const cfg = configFile();
  // The boot snapshot: logged below and reused for the startup-captured tunables
  // (port/idle/heartbeat), so a config edit landing mid-boot can't split the record
  // from the values the server binds with. It holds the VALIDATED parse only — never
  // raw config text, which may hold anything (the settings.ts logValidationFailure
  // invariant). Also the watcher's baseline read, so boot never fires a spurious
  // change record.
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
  // The identity the update check judges, captured once: all three are process
  // constants, and the check's cache record is keyed on the version and commit so a
  // verdict about an older build is never reported against this one (EXC-1205).
  const install = buildKind();
  const version = VERSION;
  const commit = currentCommit();
  // Seeded from the last persisted verdict, so a daemon that starts fresh can answer
  // immediately; the background check below replaces it when it settles.
  const updateCache = fileUpdateCache(updateCheckFile());
  let updateStatus = readCachedStatus(updateCache, version, commit);
  // Ask — at most once a day, and never on a dev build or under the `updates.check`
  // opt-out — whether a newer caret exists (EXC-1205). Fire-and-forget: nothing awaits it,
  // so neither boot nor a prefs write is delayed, and runUpdateCheck never rejects. A null
  // result is the throttle (or the opt-out) saying there is nothing new, so the seeded
  // verdict stands. Boot fires it once; a resident daemon re-arms it on the upkeep tick,
  // bounded by the same 24h stamp.
  function refreshUpdate(): void {
    void runUpdateCheck({
      kind: install,
      version,
      commit,
      enabled: () => readUpdatesCheck(),
      now: Date.now,
      cache: updateCache,
      npmLatest: publishedCaretVersion,
      release: latestReleaseTag,
      aheadBy: commitsAheadOfTrunk,
      log,
    }).then(
      (status) => {
        if (status) updateStatus = status;
      },
      // runUpdateCheck settles every failure itself, so this arm should be unreachable —
      // but an unhandled rejection here would hit the process handlers installed below and
      // take a live daemon down with it, which is far too high a price for an update nudge.
      (err) => log.error("update", err),
    );
  }
  // Read from the same boot snapshot as the other startup-captured tunables, so a
  // config edit landing mid-boot cannot split residency from the idle delay it gates.
  const resident = isResident(boot);
  const store = createStore(reviewsDir(), log);
  await store.rehydrate();
  const assets = await loadUiAssets();
  if (!assets) log.info("ui", "no embedded ui; serving placeholder");
  // `caret daemon --ephemeral` (EXC-461): bind an OS-assigned port instead of
  // the configured one. A process flag, not a setting — the dev task owns the
  // daemon and discovers the bound port from the lock, so port resolution for
  // hooks (getPort) is untouched.
  const ephemeral = opts.ephemeral;

  // Signal cleanup goes up BEFORE the bind, because until a handler exists
  // SIGTERM and SIGINT take their DEFAULT disposition: the kernel kills the
  // process outright, no shutdown runs, and the lock createServer had just
  // written is left behind for the next boot to trip over (the daemon exits 143
  // with nothing in its log). That window is a few statements wide and looks
  // impossible to hit — but a loaded box preempts inside it, which is how a
  // contended `mise run preflight` reproduced it about once in twenty boots.
  //
  // A daemon that LOSES the EADDRINUSE race below must not unlink the winner's
  // lock, and with the handlers this early that rests on the code rather than on
  // placement: `server` stays undefined until the bind succeeds, so a loser stops
  // nothing, and removeOwnDaemonLock unlinks only a lock naming this pid.
  let server: CaretServer | undefined;
  const shutdown = (code: number) => {
    server?.stop();
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
  // Last-resort unlink for an exit path that bypassed stop() — including a signal
  // landing in the sliver between createServer writing the lock and `server`
  // being assigned, where shutdown() has nothing to stop yet.
  process.once("exit", removeOwnDaemonLock);

  // Stop on a boot failure no restart can fix: SERVICE_TERMINAL_EXIT_STATUS is the status
  // systemd's RestartPreventExitStatus is keyed on, and the stderr line is what reaches
  // the supervisor's own log (the units redirect stderr to daemon-stderr.log). launchd has
  // no per-status allowlist, so a macOS agent still respawns under KeepAlive — throttled
  // to its ~10s floor, not looping (EXC-1164).
  function exitTerminal(reason: string, err: unknown): never {
    process.stderr.write(`caret: ${reason}; exiting.\n`);
    log.error("fatal", err, { reason, exitStatus: SERVICE_TERMINAL_EXIT_STATUS });
    process.exit(SERVICE_TERMINAL_EXIT_STATUS);
  }

  // Resolved before the try, so a read failure in either surfaces as an ordinary startup
  // crash rather than being reported — and permanently parked — as a bind failure.
  const buildId = await currentBuildId();
  const assetDigest = await buildHash(assets);

  try {
    server = createServer({
      store,
      port: ephemeral ? 0 : getPort(boot),
      idleMs: idleMs(boot),
      heartbeatMs: heartbeatMs(boot),
      resident,
      assets,
      lockPath: daemonLock(),
      buildId,
      assetDigest,
      commit,
      // World + boot identity (EXC-461): stateDir is the world key (never
      // logged — identifying); the per-boot instanceId is the loggable handle.
      stateDir: stateDir(),
      instanceId: randomUUID().slice(0, 8),
      approveVariants: adapter.approveVariants,
      // The active adapter's id, published on /api/health so the UI can adapt to
      // the environment (EXC-791).
      source: adapter.id,
      // The active adapter's skill enumeration, served by
      // GET /api/reviews/:id/skills so the feedback editors can complete `/` names
      // from the reviewing agent's own skills (EXC-1176).
      listSkills: (cwd) => adapter.listSkills(cwd),
      // What the skill the reviewer highlighted in that list actually does, served by
      // GET /api/reviews/:id/skill-description for the Ctrl+Space preview panel
      // (EXC-1186).
      readSkillDescription: (cwd, skill) => adapter.readSkillDescription(cwd, skill),
      // Daemon self-diagnostics for the settings Advanced pane (EXC-842). The
      // settings thunk is re-read per request, so a config edit hot-reloads;
      // prodDiagnosticsDeps supplies the readers and buildDiagnostics scrubs the dump.
      diagnostics: () =>
        buildDiagnostics(
          prodDiagnosticsDeps({
            startedAt,
            settings: () => settings().current(),
            configPath: cfg,
          }),
        ),
      // Whether this caret is behind (EXC-1205). A thunk over a local the background
      // check assigns, so GET /api/update never makes a network call of its own — it
      // reads the live `updates.check` (a prefs.json read, not a call out) and folds it
      // over the held verdict, so an opt-out takes effect without a restart (EXC-1210).
      updateReport: async () =>
        updateReportFor({ install, version, commit }, updateStatus, await readUpdatesCheck()),
      // Turning the check back on re-runs it, so a reviewer who opted out long ago gets
      // a real verdict on the spot rather than a daemon lifetime later.
      onUpdatesEnabled: refreshUpdate,
      log,
    });
  } catch (e) {
    if (isAddrInUse(e)) {
      process.stderr.write("caret: another daemon won the port; exiting.\n");
      process.exit(0);
    }
    // Any other bind failure is a configuration problem — an unbindable port, a
    // privileged one, an address that does not exist — so a supervisor must stop
    // rather than restart into it. Left to propagate, the CLI's fatal handler would
    // print the hook fail-safe's deny line and exit 0, which reads as a clean stop.
    exitTerminal("cannot bind the daemon port", e);
  }
  // The fatal handlers stay BELOW the bind: a boot that dies before this point
  // should surface its stack the way any other startup crash does, rather than
  // being turned into a logged exit(1).
  const onFatal = (label: string) => (err: unknown) => {
    log.error(label, err);
    shutdown(1);
  };
  process.once("uncaughtException", onFatal("uncaughtException"));
  process.once("unhandledRejection", onFatal("unhandledRejection"));
  // Boot's own check, fired last so it cannot delay the bind or the signal handlers.
  refreshUpdate();
  // The periodic work a daemon that respawns per review got for free from its own
  // restart (EXC-1164). The two gates differ: the update check only matters to a daemon
  // that stays up, while any supervised daemon bypasses spawnDaemon, so its
  // daemon-stderr.log would otherwise never be rotated at all.
  const upkeep: UpkeepTask[] = [];
  if (resident) upkeep.push({ name: "update-check", run: refreshUpdate });
  if (isSupervised()) {
    // Once at boot as well as on the tick. A supervised but NON-resident daemon still
    // idle-exits after about a minute, so the hourly tick alone would never fire for it —
    // and it is the daemon that appends fresh crash output on every restart.
    // svc.current() rather than the boot snapshot: the rotation knobs are [logging] keys,
    // which hot-reload.
    rotateDaemonStderr(svc.current());
    upkeep.push({ name: "stderr-rotate", run: () => rotateDaemonStderr(svc.current()) });
  }
  startUpkeep({ tasks: upkeep, log });
  // Bun.serve keeps the process alive; the daemon idle-auto-shuts-down.
}
