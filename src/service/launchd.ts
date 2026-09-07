// The launchd agent definition, as a pure function of a ServiceConfig. No I/O and
// no platform detection: the macOS ServiceManager writes what this returns.

import { SERVICE_ARGS, type ServiceConfig } from "@/service/manager.ts";

/** Paths and environment values are user-derived, and a raw `&` alone is enough to
 * make a plist launchd refuses to parse. */
function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function stringEntry(key: string, value: string, indent: string): string {
  return `${indent}<key>${key}</key>\n${indent}<string>${escapeXml(value)}</string>`;
}

/** `cfg.terminalExitStatus` is deliberately unused here: launchd has no per-status
 * restart allowlist, so the launcher boots its own agent out on that status instead
 * (`stop_agent` in bin/caret-launcher). Only the systemd unit can express it. */
export function buildLaunchdPlist(cfg: ServiceConfig): string {
  const args = [cfg.launcherPath, ...SERVICE_ARGS]
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join("\n");
  const environment = Object.entries(cfg.environment)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => stringEntry(key, value, "    "))
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${stringEntry("Label", cfg.label, "  ")}
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
${stringEntry("WorkingDirectory", cfg.workingDirectory, "  ")}
${stringEntry("StandardOutPath", cfg.logPath, "  ")}
${stringEntry("StandardErrorPath", cfg.logPath, "  ")}
  <key>EnvironmentVariables</key>
  <dict>
${environment}
  </dict>
</dict>
</plist>
`;
}
