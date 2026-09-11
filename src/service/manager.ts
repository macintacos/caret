// The supervisor seam: what a platform service manager must do, and the config a
// unit file is generated from. Nothing here performs I/O or detects a platform —
// the launchd and systemd implementations layer on top, and the composition point
// selects between them (src/service/index.ts).

export interface ServiceStatus {
  /** The supervisor knows the unit. What that rests on differs by platform, and the
   * difference is visible after a terminal failure: on macOS it is loadedness, and
   * bin/caret-launcher's stop_agent boots the agent out while deliberately leaving the
   * plist, so this reads false with the file still there. On Linux it is the unit file
   * being on systemd's search path, which `systemctl --user is-enabled` answers — a
   * file present but never loaded still reads true. Both agree after an eviction, which
   * removes the file on Linux. */
  installed: boolean;
  running: boolean;
  /** The user turned the service off themselves — Login Items on macOS, a disabled or
   * masked unit on Linux. Install reads this as an opt-out and never re-enables
   * (EXC-1167). */
  disabled: boolean;
  /** systemd will not start the unit again on its own: it exited terminally or spent its
   * start limit. Install resets and restarts it. Linux only — on macOS the launcher's
   * stop_agent boots the agent out instead, so `installed` already reads false. */
  failed?: boolean;
  /** Why this host cannot run the service at all, absent when it can. A stated
   * outcome rather than a failed install: the composition point branches on it and
   * leaves the machine non-resident instead of throwing (EXC-1167). */
  unsupported?: string;
}

export interface ServiceManager {
  /** Write the unit and hand it to the supervisor. A no-op when the generated unit is
   * byte-identical to the one on disk and status() reports it installed and running —
   * on Linux, not disabled either; anything else writes and reloads. Every field a unit
   * carries is version-independent, so an upgrade takes the no-op path and leaves the
   * supervisor on the old binary: cycling it is restart()'s job. */
  install(cfg: ServiceConfig): Promise<void>;
  /** Stop the service and remove its unit. Idempotent: nothing installed is not
   * an error. */
  uninstall(): Promise<void>;
  status(): Promise<ServiceStatus>;
  /** Cycle the service so the launcher re-resolves caret — the upgrade path under
   * residency, and what a hook reaches for instead of spawning (EXC-1166). */
  restart(): Promise<void>;
}

export interface ServiceConfig {
  /** The stable launcher the unit names forever — launcherPath(), EXC-1160. */
  launcherPath: string;
  /** LAUNCHD_LABEL on macOS, SYSTEMD_UNIT on Linux. */
  label: string;
  /** DAEMON_CWD (src/daemon/lifecycle.ts). */
  workingDirectory: string;
  environment: Record<string, string>;
  /** The launcher's terminal-failure status: a restart cannot fix it, so the
   * supervisor must stop rather than loop. */
  terminalExitStatus: number;
}

/** The launchd agent's label — no `.plist` suffix, which is the `service` record's
 * macOS form that bin/caret-launcher appends to. */
export const LAUNCHD_LABEL = "dev.excessive.caret";

/** The systemd unit's full name, suffix included — the `service` record's Linux form. */
export const SYSTEMD_UNIT = "caret.service";

/** The launcher's terminal-failure exit — keep in sync with `exit 78` in
 * bin/caret-launcher. */
export const SERVICE_TERMINAL_EXIT_STATUS = 78;

/** Marks a process whose lifetime something else owns — a generated unit's environment
 * block, or the dev task's child env — rather than a hook's fallback spawn (EXC-1161).
 * Read by `isResident` (src/config/settings.ts) and the daemon's upkeep gate, so the
 * name lives here once rather than as a literal in each. */
export const SUPERVISED_VAR = "CARET_SUPERVISED";

/** Whether something manages this process's lifetime rather than a hook's fallback
 * spawn — a platform supervisor, or the dev task's child env. */
export function isSupervised(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SUPERVISED_VAR] === "1";
}

/** The arguments the unit passes the launcher, which execs `bin/caret "$@"`.
 * Shared so the plist and the unit file cannot drift into starting different
 * subcommands. */
export const SERVICE_ARGS = ["daemon"] as const;

/** The world-defining variables a supervised process must carry, since a supervisor
 * starts it with its own environment rather than the user's shell (EXC-461). Two
 * consumers, not one: bin/caret-launcher resolves caret and bun from the XDG roots
 * and CLAUDE_CONFIG_DIR before any TypeScript runs, and the daemon it execs resolves
 * its own paths and its adapter from them again. PATH is deliberately absent — the
 * launcher rebuilds it around the bun it found. Coupling test:
 * test/structure/service-world-vars.test.ts. */
export const WORLD_VARS = [
  "HOME",
  "CLAUDE_CONFIG_DIR",
  "XDG_STATE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
  "CARET_CONFIG_FILE",
  "CARET_PORT",
  "CARET_AGENT",
] as const;

/** The environment block a unit records, captured from the installing shell. Each
 * world variable is passed through only when non-empty: xdgDir() falls back on an
 * unset OR empty value, so recording an empty one would have the daemon and the
 * hooks resolve it differently. */
export function serviceEnvironment(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of WORLD_VARS) {
    const value = env[key];
    if (value) environment[key] = value;
  }
  // The daemon idle-exits after [daemon].idle_ms with nothing pending
  // (src/daemon/server.ts) — under KeepAlive / Restart=always that's a restart loop, not
  // residency. isResident reads this and keeps the daemon up when [daemon].resident is
  // also set; without that key a supervised daemon still idle-exits (EXC-1164).
  environment[SUPERVISED_VAR] = "1";
  return environment;
}

/** Environment entries in a fixed code-unit order, so regenerating a unit for an
 * unchanged config is byte-identical and an idempotent install can compare rather
 * than always rewrite. Not locale-sensitive: that would make the output depend on
 * the installing shell's locale. */
export function sortedEnvironment(env: Record<string, string>): [string, string][] {
  return Object.entries(env).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}
