// The systemd user unit, as a pure function of a ServiceConfig. No I/O and no
// platform detection: the Linux ServiceManager writes what this returns.

import { SERVICE_ARGS, type ServiceConfig } from "@/service/manager.ts";

/** Give up after this many launcher starts inside this window — a crash loop the
 * supervisor cannot fix by trying again. launchd throttles instead of counting, so
 * only the unit file expresses it. */
const START_LIMIT_INTERVAL_SEC = 60;
const START_LIMIT_BURST = 5;

/** systemd splits unquoted values on whitespace, so a path with a space arrives as
 * two arguments unless it is quoted. */
function quote(value: string): string {
  return `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"`;
}

export function buildSystemdUnit(cfg: ServiceConfig): string {
  const execStart = [cfg.launcherPath, ...SERVICE_ARGS].map(quote).join(" ");
  const environment = Object.entries(cfg.environment)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `Environment=${quote(`${key}=${value}`)}`)
    .join("\n");
  return `[Unit]
Description=caret review daemon
After=default.target
StartLimitIntervalSec=${START_LIMIT_INTERVAL_SEC}
StartLimitBurst=${START_LIMIT_BURST}

[Service]
Type=simple
ExecStart=${execStart}
WorkingDirectory=${cfg.workingDirectory}
Restart=always
RestartPreventExitStatus=${cfg.terminalExitStatus}
StandardOutput=append:${cfg.logPath}
StandardError=append:${cfg.logPath}
${environment}

[Install]
WantedBy=default.target
`;
}
