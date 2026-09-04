// Daemon self-diagnostics for GET /api/diagnostics (EXC-842): the system/runtime
// identity, uptime, live parsed settings, and config path + CARET_* env
// overrides the settings Advanced pane renders. buildDiagnostics is pure and
// dependency-injected; the effectful half (prodDiagnosticsDeps and systemInfo)
// sits here beside the interface it satisfies, as lifecycle.ts's prodEnsureDeps
// does, so a test can assert what production reads without booting the daemon.
// The settings dump rides redact/core.ts's scrubGraph — censor-only (no
// home-path scrub) since this serves the user's own loopback UI, not a
// pasteable bug report.

import { existsSync } from "node:fs";

import { envOverrides } from "@/config/settings.ts";
import type { DaemonDiagnostics, EnvOverride } from "@/lib/types.ts";
import { scrubGraph } from "@/redact/core.ts";

/** Every effect buildDiagnostics reads, injected so it stays a pure function of
 * its deps (prodDiagnosticsDeps below wires the prod readers). */
export interface DiagnosticsDeps {
  /** Wall clock in ms (Date.now in prod). */
  now: () => number;
  /** The daemon's boot time in ms, captured once at startup. */
  startedAt: number;
  system: () => { platform: string; arch: string; runtime: string };
  /** The parsed settings, read on every call so the dump reflects a config edit
   * without a restart. */
  settings: () => unknown;
  configPath: string;
  configExists: () => boolean;
  envOverrides: () => EnvOverride[];
}

/** The prod `DiagnosticsDeps.system` reader: process identity plus the runtime
 * string the settings Advanced pane renders. */
export function systemInfo(): DaemonDiagnostics["system"] {
  return { platform: process.platform, arch: process.arch, runtime: `bun ${Bun.version}` };
}

/** The prod `DiagnosticsDeps`: the daemon's boot state paired with the readers
 * that touch the world. */
export function prodDiagnosticsDeps(boot: {
  startedAt: number;
  settings: () => unknown;
  configPath: string;
}): DiagnosticsDeps {
  return {
    now: Date.now,
    startedAt: boot.startedAt,
    system: systemInfo,
    settings: boot.settings,
    configPath: boot.configPath,
    configExists: () => existsSync(boot.configPath),
    envOverrides,
  };
}

/** Assemble the daemon self-diagnostics document (EXC-842). Pure — every effect
 * is injected. The settings dump is routed through scrubGraph so DENY_KEYS
 * values never reach the wire. */
export function buildDiagnostics(deps: DiagnosticsDeps): DaemonDiagnostics {
  return {
    system: deps.system(),
    uptimeMs: deps.now() - deps.startedAt,
    settings: scrubGraph(deps.settings()) as Record<string, unknown>,
    config: {
      path: deps.configPath,
      exists: deps.configExists(),
      env: deps.envOverrides(),
    },
  };
}
