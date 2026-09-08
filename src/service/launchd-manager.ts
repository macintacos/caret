// The macOS ServiceManager: the launchctl I/O that puts the caret agent on disk, hands
// it to launchd, and reports back what launchd thinks of it. src/service/launchd.ts owns
// the plist text and stays pure, so every effect the agent needs lives here.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { buildLaunchdPlist } from "@/service/launchd.ts";
import {
  LAUNCHD_LABEL,
  type ServiceConfig,
  type ServiceManager,
  type ServiceStatus,
} from "@/service/manager.ts";

export interface LaunchctlResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `launchctl` with `args`. Never rejects on a non-zero exit — every caller here
 * branches on the status rather than on a throw. */
export type Launchctl = (args: string[]) => Promise<LaunchctlResult>;

export interface LaunchdDeps {
  /** Defaults to `${homedir()}/Library/LaunchAgents`. Keep in sync with evict() in
   * bin/caret-launcher, which computes the same path in bash. */
  launchAgentsDir?: string;
  /** The `gui/<uid>` domain every target names. Defaults to the current process. */
  uid?: number;
  launchctl?: Launchctl;
}

const spawnLaunchctl: Launchctl = async (args) => {
  const proc = Bun.spawn(["launchctl", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
};

/** launchd prints `state = running` alongside a `pid` line, and the two have moved
 * relative to each other across releases; either alone is the whole answer. */
const RUNNING = [/^\s*state\s*=\s*running\b/m, /^\s*pid\s*=\s*\d+/m];

/** Older macOS spells a user's opt-out `"<label>" => true`, Ventura-era `=> disabled`. */
const DISABLED = new RegExp(
  `"${LAUNCHD_LABEL.replace(/\./g, "\\.")}"\\s*=>\\s*(?:true|disabled)\\b`,
);

function failed(action: string, result: LaunchctlResult): Error {
  return new Error(`caret service: launchctl ${action} failed: ${result.stderr.trim()}`);
}

/** The launchd user agent manager. Nothing here emits `launchctl enable`: a user who
 * turned caret off under System Settings › Login Items stays opted out, and install
 * reads that back through status().disabled instead (EXC-1167). */
export function createLaunchdManager(deps: LaunchdDeps = {}): ServiceManager {
  const launchAgentsDir = deps.launchAgentsDir ?? join(homedir(), "Library", "LaunchAgents");
  const launchctl = deps.launchctl ?? spawnLaunchctl;
  const domain = `gui/${deps.uid ?? process.getuid?.() ?? 0}`;
  const target = `${domain}/${LAUNCHD_LABEL}`;
  const plist = join(launchAgentsDir, `${LAUNCHD_LABEL}.plist`);

  return {
    async install(cfg: ServiceConfig): Promise<void> {
      // Absent on an account that has never had a login item.
      mkdirSync(launchAgentsDir, { recursive: true });
      writeFileSync(plist, buildLaunchdPlist(cfg));
      // Best-effort: it has nothing to boot out on a first install, and makes a second
      // one a reload rather than a "service already loaded" failure.
      await launchctl(["bootout", target]);
      const bootstrapped = await launchctl(["bootstrap", domain, plist]);
      if (bootstrapped.code !== 0) throw failed("bootstrap", bootstrapped);
    },

    async uninstall(): Promise<void> {
      await launchctl(["bootout", target]);
      rmSync(plist, { force: true });
    },

    async status(): Promise<ServiceStatus> {
      const printed = await launchctl(["print", target]);
      const disabled = await launchctl(["print-disabled", domain]);
      return {
        installed: printed.code === 0,
        running: printed.code === 0 && RUNNING.some((line) => line.test(printed.stdout)),
        disabled: DISABLED.test(disabled.stdout),
      };
    },

    /** The daemon is not back the moment this resolves: launchd's ThrottleInterval (10s
     * by default) bounds how soon it respawns, and anything waiting on the new daemon
     * must tolerate that. */
    async restart(): Promise<void> {
      const kicked = await launchctl(["kickstart", "-k", target]);
      if (kicked.code !== 0) throw failed("kickstart", kicked);
    },
  };
}
