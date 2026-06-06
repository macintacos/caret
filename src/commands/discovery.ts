// `caret discovery`: print a one-shot diagnostics snapshot (EXC-464). Wires the
// production probes — the same primitives the review path uses (httpHealth,
// readDaemonLock, isPidAlive), the bounded read-only readers from discovery.ts,
// and the active adapter's install probe — collects the report, and always
// scrubs it (a deliberate inversion of the raw-by-default logging posture) since
// the artifact exists to be pasted into bug reports.

import { existsSync } from "node:fs";
import { release } from "node:os";
import { claudeAdapter } from "../adapters/claude/index.ts";
import { VERSION } from "../build-id.ts";
import { httpHealth } from "../daemon-client.ts";
import { isPidAlive, readDaemonLock } from "../daemon-lifecycle.ts";
import {
  collectReport,
  type DiscoveryDeps,
  listProcesses,
  listReviewFiles,
  logStats,
  renderReport,
  type Report,
} from "../discovery.ts";
import { configFile, daemonLogFile, logFile } from "../paths.ts";
import { scrubValue } from "../redact.ts";
import {
  getPort,
  heartbeatMs,
  idleMs,
  loadSettings,
  reviewTimeoutMs,
  type Settings,
} from "../settings.ts";

/** Production probes for the discovery report (EXC-464): the same primitives
 * the review path already uses (httpHealth, readDaemonLock, isPidAlive), the
 * bounded read-only readers from discovery.ts, and the active adapter's install
 * probe. Deliberately no removeLock or retire — discovery observes, never
 * repairs. */
function prodDiscoveryDeps(s: Settings): DiscoveryDeps {
  return {
    now: () => new Date(),
    version: VERSION,
    system: () => ({ platform: process.platform, os: release(), arch: process.arch }),
    install: () => ({
      // The same dev-vs-compiled signal daemonCommand/currentBuildId key off.
      kind: process.argv[1]?.endsWith(".ts") ? "dev" : "prod",
      binaryPath: process.execPath,
      bunVersion: Bun.version,
    }),
    settings: () => s,
    configPath: configFile(),
    configExists: () => existsSync(configFile()),
    effective: () => ({
      port: getPort(s),
      idleMs: idleMs(s),
      reviewTimeoutMs: reviewTimeoutMs(s),
      heartbeatMs: heartbeatMs(s),
    }),
    baseUrl: `http://localhost:${getPort(s)}`,
    health: httpHealth,
    readLock: readDaemonLock,
    isPidAlive,
    listProcesses,
    listReviewFiles,
    readAgentInstallState: () => claudeAdapter.readInstallState(),
    logStats,
    logPaths: { caret: logFile(), daemon: daemonLogFile() },
  };
}

export async function runDiscoverySubcommand(opts: { json: boolean }): Promise<void> {
  // One-shot diagnostics snapshot (EXC-464). Human-facing output like redact:
  // human-readable by default, --json for the machine document. ALWAYS redacted
  // (a deliberate inversion of the raw-by-default logging posture, EXC-399) —
  // this artifact exists to be pasted into bug reports. Exit 0 whenever a
  // report was produced, however degraded; non-zero only when none could be.
  try {
    const s = loadSettings();
    const report = await collectReport(prodDiscoveryDeps(s));
    // scrubValue preserves the report's shape (strings scrub in place), so the
    // cast back to Report is safe for renderReport.
    const redacted = scrubValue(report, true) as Report;
    const out = opts.json ? JSON.stringify(redacted, null, 2) : renderReport(redacted);
    process.stdout.write(`${out}\n`);
    process.exit(0);
  } catch (e) {
    process.stderr.write(`caret discovery: ${e}\n`);
    process.exit(1);
  }
}
