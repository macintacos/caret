// The Linux ServiceManager: the systemctl and loginctl I/O that puts the caret unit on
// disk, hands it to the user manager, and reports back what systemd thinks of it.
// src/service/systemd.ts owns the unit text and stays pure, so every effect the unit
// needs lives here.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { logWarn } from "@/lib/log.ts";
import {
  type ServiceConfig,
  type ServiceManager,
  type ServiceStatus,
  SYSTEMD_UNIT,
} from "@/service/manager.ts";
import { type CommandResult, commandError, runCommand } from "@/service/run.ts";
import { buildSystemdUnit } from "@/service/systemd.ts";

/** Run a full argv — the binary name included, so systemctl and loginctl share one seam
 * rather than taking a dep each. Never rejects; callers branch on the status. */
export type RunCommand = (argv: string[]) => Promise<CommandResult>;

export interface SystemdDeps {
  /** Defaults to `$XDG_CONFIG_HOME/systemd/user` (`~/.config/systemd/user`). Keep in
   * sync with evict() in bin/caret-launcher, which computes the same path in bash —
   * test/structure/service-unit-paths.test.ts holds the shell half. */
  unitDir?: string;
  /** Defaults to spawning the real command. */
  run?: RunCommand;
}

/** The systemd user service manager. install() enables unconditionally — on systemd
 * `enable` is the load verb, and it also recreates the wants symlink a `systemctl --user
 * disable` removed, so the opt-out check cannot live here as it does on launchd. The
 * composition point reads status().disabled before calling install (EXC-1167); a masked
 * unit is refused here only incidentally, by enable failing. */
export function createSystemdManager(deps: SystemdDeps = {}): ServiceManager {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const unitDir = deps.unitDir ?? join(configHome, "systemd", "user");
  const run = deps.run ?? runCommand;
  const unitPath = join(unitDir, SYSTEMD_UNIT);

  const systemctl = (...args: string[]) => run(["systemctl", "--user", ...args]);

  /** Why this host cannot run the unit, or undefined when it can. `show-environment` is
   * the probe because a bus failure is the only thing it can fail with: every other
   * verb also exits non-zero for an ordinary reason — `is-enabled` reads 4 on an absent
   * unit, `is-active` 3 on a stopped one — so a non-zero exit from one of those cannot
   * name its own cause without parsing stderr. */
  async function probeSystemd(): Promise<string | undefined> {
    const shown = await systemctl("show-environment");
    if (shown.code === 0) return undefined;
    return `caret service: no systemd user session (${shown.code}): ${shown.stderr.trim()}`;
  }

  return {
    async install(cfg: ServiceConfig): Promise<void> {
      // cfg.label is otherwise unused on Linux: the filename and every target below are
      // the constant. A divergent label means the caller built this config for another
      // supervisor, so refuse rather than install something it did not describe.
      if (cfg.label !== SYSTEMD_UNIT) {
        throw new Error(`caret service: unit label ${cfg.label} is not ${SYSTEMD_UNIT}`);
      }
      const unsupported = await probeSystemd();
      if (unsupported) throw new Error(unsupported);
      // Absent on an account that has never had a user unit.
      mkdirSync(unitDir, { recursive: true });
      // Written in place, unlike installLauncher's tmp+rename: systemd reads this file
      // whole at the daemon-reload below and at login, never lazily from a live fd.
      writeFileSync(unitPath, buildSystemdUnit(cfg));
      const reloaded = await systemctl("daemon-reload");
      if (reloaded.code !== 0) throw commandError("systemctl", "daemon-reload", reloaded);
      const enabled = await systemctl("enable", SYSTEMD_UNIT);
      if (enabled.code !== 0) throw commandError("systemctl", "enable", enabled);
      // Best-effort, and immediately before the one start: a unit systemd parked on its
      // start limit refuses every further start until this clears it, and re-running
      // install is what a user does next. Exits non-zero on a unit systemd never loaded.
      await systemctl("reset-failed", SYSTEMD_UNIT);
      // restart rather than `enable --now`, which would only add a start this undoes:
      // restart starts a stopped unit, so one call covers the first install and the
      // replace both. The replace is what the seam promises — `enable` alone leaves a
      // running unit on its old file. macOS gets it free from bootout + bootstrap.
      const restarted = await systemctl("restart", SYSTEMD_UNIT);
      if (restarted.code !== 0) throw commandError("systemctl", "restart", restarted);
      // Degraded rather than fatal: without lingering the unit stops at logout, which
      // is a worse caret than a resident one but still a working install.
      const lingering = await run(["loginctl", "enable-linger"]);
      if (lingering.code !== 0) {
        logWarn("service", "lingering not enabled; caret stops at logout", {
          code: lingering.code,
          stderr: lingering.stderr.trim(),
        });
      }
    },

    async uninstall(): Promise<void> {
      // Best-effort: a missing unit exits 1 here, the ordinary case. Any other failure
      // leaves the unit loaded with its file gone; EXC-1167 owns whether uninstall says
      // so.
      await systemctl("disable", "--now", SYSTEMD_UNIT);
      rmSync(unitPath, { force: true });
      // Also best-effort, and after the removal, so systemd forgets a unit whose file
      // is already gone. Linger is deliberately not revoked: other services may rely on
      // it, and caret did not grant it exclusively.
      await systemctl("daemon-reload");
    },

    async status(): Promise<ServiceStatus> {
      const unsupported = await probeSystemd();
      if (unsupported) {
        return { installed: false, running: false, disabled: false, unsupported };
      }
      const [active, enabled] = await Promise.all([
        systemctl("is-active", SYSTEMD_UNIT),
        systemctl("is-enabled", SYSTEMD_UNIT),
      ]);
      const enablement = enabled.stdout.trim();
      return {
        // Both verbs print their answer on stdout at every exit code, so the word is
        // what is read and the exit status adds nothing. Absent output is systemd
        // failing to answer rather than an answer: the only negative match here, so it
        // is the only one an unrecognised word could flip the unsafe way — installed on
        // silence would have a reconcile skip a machine holding nothing.
        installed: enablement !== "" && enablement !== "not-found",
        running: active.stdout.trim() === "active",
        // startsWith, because `mask --runtime` reports `masked-runtime` and is the same
        // deliberate opt-out. ponytail: a unit written but never enabled reads
        // `disabled` too, so this cannot separate it from a real opt-out — install
        // always enables, so the ambiguous window is an enable that failed after the
        // write. Upgrade path if it ever matters: compare against default.target.wants.
        disabled: enablement === "disabled" || enablement.startsWith("masked"),
      };
    },

    /** The daemon is not serving the moment this resolves: Type=simple has no readiness
     * signal, so systemd calls the unit started as soon as ExecStart is forked and
     * anything waiting on the new daemon must poll. Unlike status() this does not probe
     * — it runs only where caret is already resident, so a bus failure surfaces as
     * systemd's own error. */
    async restart(): Promise<void> {
      const restarted = await systemctl("restart", SYSTEMD_UNIT);
      if (restarted.code !== 0) throw commandError("systemctl", "restart", restarted);
    },
  };
}
