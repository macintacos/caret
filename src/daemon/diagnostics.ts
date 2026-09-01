// Daemon self-diagnostics for GET /api/diagnostics (EXC-842): the system/runtime
// identity, uptime, live parsed settings, and config path + CARET_* env
// overrides the settings Advanced pane renders. buildDiagnostics is pure and
// dependency-injected — every effect is passed in (DiagnosticsDeps), so the
// document is a pure function of its deps and unit-testable with fakes, the same
// shape src/discovery.ts's collectReport uses. The module's effectful half is
// prodDiagnosticsDeps and the systemInfo reader it wires; both sit here beside
// the interface they satisfy (as lifecycle.ts's prodEnsureDeps does) rather than
// at the wiring point, so a test can assert what production actually reads
// without importing the daemon boot graph. The settings dump
// rides redact/core.ts's scrubGraph (the shared DENY_KEYS walk) rather than a
// second hand-rolled redaction path; censor-only (no home-path scrub) since this
// serves the user's own loopback UI, not a pasteable bug report.

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
  /** The live, hot-reloaded parsed settings (the settings service's current()
   * in prod) — read on every call so the dump reflects a config edit without a
   * restart. */
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

/** The prod `DiagnosticsDeps`: the daemon's own boot state (`boot`) paired with
 * the four readers that touch the world — the clock, the process identity, the
 * config-file probe, and the CARET_* overrides in effect. Everything the daemon
 * knows and this module cannot is a parameter, so a test can assert the wiring
 * without booting anything. */
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
 * values never reach the wire, sharing the one redaction path. */
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
