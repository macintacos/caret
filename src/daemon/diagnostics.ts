// Daemon self-diagnostics for GET /api/diagnostics (EXC-842): the system/runtime
// identity, uptime, live parsed settings, and config path + CARET_* env
// overrides the settings Advanced pane renders. Pure and dependency-injected —
// every effect is passed in (DiagnosticsDeps), so the document is a pure
// function of its deps and unit-testable with fakes, the same shape
// src/discovery.ts's collectReport uses. The settings dump rides redact/core.ts's
// scrubGraph (the shared DENY_KEYS walk) rather than a second hand-rolled
// redaction path; censor-only (no home-path scrub) since this serves the user's
// own loopback UI, not a pasteable bug report.

import type { DaemonDiagnostics, EnvOverride } from "@/lib/types.ts";
import { scrubGraph } from "@/redact/core.ts";

/** Every effect buildDiagnostics reads, injected so it stays a pure function of
 * its deps (runDaemon wires the prod readers). */
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
