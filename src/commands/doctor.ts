// `caret doctor`: print a one-shot diagnostics snapshot (EXC-464). Wires the
// production probes, collects the report, and always scrubs it — a deliberate
// inversion of the raw-by-default logging posture (EXC-399), since the artifact
// exists to be pasted into bug reports.

import { existsSync } from "node:fs";
import { release } from "node:os";

import { selectAdapter } from "@/adapters/index.ts";
import {
  configFile,
  daemonLogFile,
  daemonStderrLogFile,
  launcherServiceFile,
  logFile,
} from "@/config/paths.ts";
import {
  getPort,
  heartbeatMs,
  idleMs,
  loadSettings,
  reviewTimeoutMs,
  type Settings,
} from "@/config/settings.ts";
import { httpHealth } from "@/daemon/client.ts";
import { isPidAlive, readDaemonLock } from "@/daemon/lifecycle.ts";
import { runChecks } from "@/doctor/checks.ts";
import {
  collectReport,
  type DoctorDeps,
  type DoctorDocument,
  listProcesses,
  listReviewFiles,
  logStats,
  renderStdout,
} from "@/doctor/report.ts";
import { isCompiledBinary, VERSION } from "@/lib/build-id.ts";

/** Production probes for the doctor report, reusing the primitives the review
 * path already drives. Deliberately no removeLock or retire — doctor
 * observes, never repairs. */
function prodDoctorDeps(s: Settings): DoctorDeps {
  return {
    now: () => new Date(),
    version: VERSION,
    system: () => ({ platform: process.platform, os: release(), arch: process.arch }),
    install: () => ({
      // The same dev-vs-compiled signal selfCommand/currentBuildId key off.
      kind: isCompiledBinary() ? "prod" : "dev",
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
    serviceInstalled: () => existsSync(launcherServiceFile()),
    readLock: readDaemonLock,
    isPidAlive,
    listProcesses,
    listReviewFiles,
    readAgentInstallState: () => selectAdapter().readInstallState(),
    logStats,
    logPaths: {
      caret: logFile(),
      daemon: daemonLogFile(),
      daemonStderr: daemonStderrLogFile(),
    },
  };
}

export async function runDoctorSubcommand(opts: { json: boolean }): Promise<void> {
  // 1 means the install has something wrong with it, 2 that doctor could not say —
  // a distinction a script needs, since a degraded section is still a usable report.
  try {
    const s = loadSettings();
    const report = await collectReport(prodDoctorDeps(s));
    const doc: DoctorDocument = { ...report, checks: runChecks(report) };
    process.stdout.write(`${renderStdout(doc, opts.json ? "json" : "text")}\n`);
    process.exit(doc.checks.some((c) => c.status === "fail") ? 1 : 0);
  } catch (e) {
    process.stderr.write(`caret doctor: ${e}\n`);
    process.exit(2);
  }
}
