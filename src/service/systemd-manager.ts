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
import { type CommandResult, runCommand } from "@/service/run.ts";
import { buildSystemdUnit } from "@/service/systemd.ts";

export interface SystemdDeps {
  /** Defaults to `$XDG_CONFIG_HOME/systemd/user` (`~/.config/systemd/user`). Keep in
   * sync with evict() in bin/caret-launcher, which computes the same path in bash —
   * test/structure/service-unit-paths.test.ts holds the shell half. */
  unitDir?: string;
  /** Defaults to spawning the real command. Takes full argv so systemctl and loginctl
   * share one seam. */
  run?: (argv: string[]) => Promise<CommandResult>;
}

/** systemd's exit codes are stable (1 a refused operation, 4 an unknown unit) where its
 * stderr is free-form prose and sometimes empty. */
function systemctlError(verb: string, result: CommandResult): Error {
  return new Error(
    `caret service: systemctl ${verb} failed (${result.code}): ${result.stderr.trim()}`,
  );
}

/** The systemd user service manager. Nothing here emits a bare `systemctl --user
 * enable`: a user who masked or disabled the unit stays opted out, and install reads
 * that back through status().disabled instead (EXC-1167). */
export function createSystemdManager(deps: SystemdDeps = {}): ServiceManager {
  const configHome = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const unitDir = deps.unitDir ?? join(configHome, "systemd", "user");
  const run = deps.run ?? runCommand;
  const unitPath = join(unitDir, SYSTEMD_UNIT);

  const systemctl = (...args: string[]) => run(["systemctl", "--user", ...args]);

  /** Why this host cannot run the unit, or undefined when it can. `show-environment` is
   * the probe rather than `is-enabled`, which answers off the unit search path on disk
   * and returns cleanly with no bus at all — it cannot detect the condition. */
  async function probeSystemd(): Promise<string | undefined> {
    const shown = await systemctl("show-environment");
    if (shown.code === 0) return undefined;
    return `caret service: no systemd user session (${shown.code}): ${shown.stderr.trim()}`;
  }

  return {
    async install(cfg: ServiceConfig): Promise<void> {
      // The unit carries cfg.label as its filename while every target below is the
      // constant. Diverge and enable registers a unit that restart and is-active cannot
      // name — a resident daemon caret can no longer see or stop.
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
      if (reloaded.code !== 0) throw systemctlError("daemon-reload", reloaded);
      const enabled = await systemctl("enable", "--now", SYSTEMD_UNIT);
      if (enabled.code !== 0) throw systemctlError("enable", enabled);
      // `enable --now` leaves an already-running unit on its old file, so a second
      // install would keep serving the old one. Costs a redundant start on a first
      // install; macOS gets the same guarantee free from bootout + bootstrap.
      const restarted = await systemctl("restart", SYSTEMD_UNIT);
      if (restarted.code !== 0) throw systemctlError("restart", restarted);
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
        // what is read and the exit status adds nothing.
        installed: enablement !== "not-found",
        running: active.stdout.trim() === "active",
        // ponytail: a unit written but never enabled reads `disabled` too, so this
        // cannot separate it from a real opt-out — install always enables, so the
        // ambiguous window is an enable that failed after the write. Upgrade path if it
        // ever matters: compare against the default.target.wants symlink.
        disabled: enablement === "disabled" || enablement === "masked",
      };
    },

    /** The daemon is not back the moment this resolves: RestartSec bounds how soon
     * systemd respawns after a failure, and anything waiting on the new daemon must
     * tolerate that. */
    async restart(): Promise<void> {
      const restarted = await systemctl("restart", SYSTEMD_UNIT);
      if (restarted.code !== 0) throw systemctlError("restart", restarted);
    },
  };
}
