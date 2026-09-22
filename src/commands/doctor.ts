// `caret doctor`: print a one-shot diagnostics snapshot (EXC-464) with a verdict over
// it. Wires the production probes, collects the report, runs the checks, and always
// scrubs the result — a deliberate inversion of the raw-by-default logging posture
// (EXC-399), since the artifact exists to be pasted into bug reports.
//
// The OpenCode version check is built here rather than in src/doctor/checks.ts, which is
// core and imports no adapter: it is the one check that needs an adapter's vocabulary,
// so composition builds it and the core layer just appends what it is handed.

import { existsSync } from "node:fs";
import { release } from "node:os";

import { selectAdapter } from "@/adapters/index.ts";
import { findPluginEntry } from "@/adapters/opencode/config-plugin.ts";
import { CARET_PACKAGE, opencodeConfigDir, resolveConfigFile } from "@/adapters/opencode/paths.ts";
import {
  readConfigText,
  readUpgradeVerdict,
  type UpgradeVerdict,
} from "@/adapters/opencode/upgrade.ts";
import { upgradeVerdictLine } from "@/commands/install/prompt.ts";
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
  type Check,
  collectReport,
  type DoctorDeps,
  type DoctorDocument,
  listProcesses,
  listReviewFiles,
  logStats,
  renderStdout,
} from "@/doctor/report.ts";
import { isCompiledBinary, VERSION } from "@/lib/build-id.ts";
import { errorMessage } from "@/lib/types.ts";

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

/** The upgrade verdict as a check. The detail is the line `caret install` prints, so the
 * two surfaces can never describe a version gap differently; only the remedies differ,
 * because a bare entry is unfrozen by clearing its cache and a pin only by rewriting it.
 * An `unknown` stays `unknown` rather than becoming a failure — a doctor run offline is
 * the normal case, not a broken install. */
export function opencodeVersionCheck(verdict: UpgradeVerdict): Check {
  const base = {
    id: "opencode-caret-version",
    title: "OpenCode's caret",
    detail: upgradeVerdictLine(verdict),
  };
  switch (verdict.kind) {
    case "unknown":
      return { ...base, status: "unknown", reason: verdict.reason };
    case "stale-cache":
      return {
        ...base,
        status: "fail",
        remedy: "run `caret install --refresh` to clear the cached copy",
      };
    case "stale-pin":
      return { ...base, status: "fail", remedy: "run `caret install --refresh` to bump the pin" };
    default:
      return { ...base, status: "pass" };
  }
}

/** The OpenCode check, or undefined when OpenCode's config carries no caret package
 * entry — a Claude-only user then pays no network call and gets no meaningless verdict.
 * A `file:` entry is skipped by the same test: it re-resolves to its checkout on every
 * start, so npm's version says nothing about it. */
async function readOpencodeCheck(): Promise<Check | undefined> {
  try {
    const configFile = resolveConfigFile(opencodeConfigDir());
    if (findPluginEntry(readConfigText(configFile), CARET_PACKAGE) === null) return undefined;
    return opencodeVersionCheck(await readUpgradeVerdict({ configFile }));
  } catch (e) {
    return opencodeVersionCheck({ kind: "unknown", reason: errorMessage(e) });
  }
}

export async function runDoctorSubcommand(opts: { json: boolean }): Promise<void> {
  // 1 means the install has something wrong with it, 2 that doctor could not say —
  // a distinction a script needs, since a degraded section is still a usable report.
  try {
    const s = loadSettings();
    const report = await collectReport(prodDoctorDeps(s));
    const doc: DoctorDocument = { ...report, checks: runChecks(report, await readOpencodeCheck()) };
    process.stdout.write(`${renderStdout(doc, opts.json ? "json" : "text")}\n`);
    process.exit(doc.checks.some((c) => c.status === "fail") ? 1 : 0);
  } catch (e) {
    process.stderr.write(`caret doctor: ${e}\n`);
    process.exit(2);
  }
}
