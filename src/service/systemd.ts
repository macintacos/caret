// The systemd user unit, as a pure function of a ServiceConfig. No I/O and no
// platform detection: the Linux ServiceManager writes what this returns.
//
// The unit tests assert on this text, not on what systemd does with it. The only thing
// that checks the difference is `mise run linux verify`, by hand, and it reads
// StartLimitBurst back out of the unit — run it when you change what this emits.

import { SERVICE_ARGS, type ServiceConfig, sortedEnvironment } from "@/service/manager.ts";

// A crash the supervisor cannot fix by trying again: five starts inside this window
// parks the unit rather than looping forever. RestartSec is what makes the window
// mean what it reads as — systemd's own 100ms default would burn the whole burst in
// half a second, so a two-second port conflict would park residency permanently.
const START_LIMIT_INTERVAL_SEC = 60;
const START_LIMIT_BURST = 5;
const RESTART_DELAY_SEC = 5;

/** systemd resolves `%` specifiers (`%h`, `%t`, …) in unit values before anything
 * else, and quoting does not suppress it, so a literal percent must be doubled.
 * Applies to quoted and unquoted settings alike. */
function unitValue(value: string): string {
  return value.replace(/%/g, "%%");
}

/** systemd splits unquoted values on whitespace, so anything sharing a line with
 * another argument — an `Environment=` assignment, one `ExecStart` word — is quoted.
 * A raw newline would end the directive and make the remainder a new one; inside
 * double quotes systemd reads the C escape. A single-argument setting like
 * WorkingDirectory takes the rest of the line and needs only unitValue(). */
function quote(value: string): string {
  const escaped = unitValue(value)
    .replace(/[\\"]/g, (c) => `\\${c}`)
    .replace(/\n/g, "\\n");
  return `"${escaped}"`;
}

/** A quoted `ExecStart` word. Command lines are the one place systemd also expands
 * `$VAR` / `${VAR}`, where the literal is `$$`. */
function execArg(value: string): string {
  return quote(value).replace(/\$/g, "$$$$");
}

/** The systemd user unit for `cfg`, as text. Pure: the Linux ServiceManager writes
 * it. */
export function buildSystemdUnit(cfg: ServiceConfig): string {
  const execStart = [cfg.launcherPath, ...SERVICE_ARGS].map(execArg).join(" ");
  const environment = sortedEnvironment(cfg.environment)
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
WorkingDirectory=${unitValue(cfg.workingDirectory)}
Restart=always
RestartSec=${RESTART_DELAY_SEC}
RestartPreventExitStatus=${cfg.terminalExitStatus}
${environment}

[Install]
WantedBy=default.target
`;
}
