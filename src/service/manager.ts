// The supervisor seam: what a platform service manager must do, and the config a
// unit file is generated from. Nothing here performs I/O or detects a platform —
// the launchd and systemd implementations layer on top, and the composition point
// selects between them (src/service/index.ts).

export interface ServiceStatus {
  /** The unit is on disk and the supervisor knows about it. */
  installed: boolean;
  running: boolean;
}

export interface ServiceManager {
  /** Write the unit and hand it to the supervisor. Idempotent: a second install
   * replaces the unit and reloads it. */
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
  label: string;
  /** Where the supervisor sends the daemon's stdout and stderr. */
  logPath: string;
  workingDirectory: string;
  environment: Record<string, string>;
  /** The launcher's terminal-failure status: a restart cannot fix it, so the
   * supervisor must stop rather than loop. */
  terminalExitStatus: number;
}

export const LAUNCHD_LABEL = "dev.excessive.caret";
export const SYSTEMD_UNIT = "caret.service";
export const SERVICE_TERMINAL_EXIT_STATUS = 78;

/** The arguments the unit passes the launcher, which execs `bin/caret "$@"`.
 * Shared so the plist and the unit file cannot drift into starting different
 * subcommands. */
export const SERVICE_ARGS = ["daemon"] as const;

/** The world-defining variables a supervised daemon must carry, since a supervisor
 * starts it with its own environment rather than the user's shell (EXC-461). */
const WORLD_VARS = [
  "HOME",
  "XDG_STATE_HOME",
  "XDG_CONFIG_HOME",
  "CARET_CONFIG_FILE",
  "CARET_PORT",
] as const;

/** The environment block a unit records, captured from the installing shell. Each
 * world variable is passed through only when non-empty: xdgDir() falls back on an
 * unset OR empty value, so recording an empty one would have the daemon and the
 * hooks resolve it differently. */
export function serviceEnvironment(
  env: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of WORLD_VARS) {
    const value = env[key];
    if (value) out[key] = value;
  }
  out.CARET_SUPERVISED = "1";
  return out;
}
