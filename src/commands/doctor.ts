// `caret doctor`: print a one-shot diagnostics snapshot (EXC-464) with a verdict over
// it. Wires the production probes, collects the report, runs the checks, and always
// scrubs the result — a deliberate inversion of the raw-by-default logging posture
// (EXC-399), since the artifact exists to be pasted into bug reports.
//
// The OpenCode version check reaches the report from the adapter rather than from
// src/doctor/checks.ts, which is core and imports no adapter: it is the one check that
// needs an adapter's vocabulary, so composition asks for it and the core layer just
// appends what it is handed.

import { existsSync } from "node:fs";
import { release } from "node:os";

import { selectAdapter } from "@/adapters/index.ts";
import { opencodeConfigDir, resolveConfigFile } from "@/adapters/opencode/paths.ts";
import {
  hasCaretPluginEntry,
  readUpgradeVerdict,
  upgradeCheck,
} from "@/adapters/opencode/upgrade.ts";
import { isTerminal } from "@/commands/install/ui.ts";
import {
  configFile,
  daemonLogFile,
  daemonStderrLogFile,
  ensureStateDir,
  launcherServiceFile,
  logFile,
  reviewsDir,
  stateDir,
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
import { isPidAlive, readBootMarker, readDaemonLock } from "@/daemon/lifecycle.ts";
import { type BundleDeps, runBundle } from "@/doctor/bundle.ts";
import { runChecks } from "@/doctor/checks.ts";
import {
  type Check,
  collectReport,
  type DoctorDeps,
  type DoctorDocument,
  listProcesses,
  listReviewFiles,
  logErrorRecords,
  logStats,
  renderStdout,
} from "@/doctor/report.ts";
import { writeZip } from "@/doctor/zip.ts";
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
    readBootMarker,
    isPidAlive,
    listProcesses,
    listReviewFiles,
    readAgentInstallState: () => {
      const adapter = selectAdapter();
      return { agent: adapter.id, ...adapter.readInstallState() };
    },
    logStats,
    logErrorRecords,
    logPaths: {
      caret: logFile(),
      daemon: daemonLogFile(),
      daemonStderr: daemonStderrLogFile(),
    },
  };
}

/** The adapter checks doctor appends to the core ones: OpenCode's version verdict, or
 * nothing when OpenCode's config carries no caret package entry — a Claude-only user
 * then pays no network call and gets no meaningless verdict. A `file:` entry is skipped
 * by the same test: it re-resolves to its checkout on every start, so npm's version says
 * nothing about it. */
async function readAdapterChecks(): Promise<Check[]> {
  try {
    const config = resolveConfigFile(opencodeConfigDir());
    if (!hasCaretPluginEntry(config)) return [];
    return [upgradeCheck(await readUpgradeVerdict({ configFile: config }))];
  } catch (e) {
    return [upgradeCheck({ kind: "unknown", reason: errorMessage(e) })];
  }
}

/** The bundle's effects. The state dir is created here rather than in the zip writer,
 * which owns the container and nothing else. */
function prodBundleDeps(): BundleDeps {
  return {
    stateDir: stateDir(),
    logPaths: [logFile(), daemonLogFile(), daemonStderrLogFile()],
    reviewsDir: reviewsDir(),
    now: () => new Date(),
    isInteractive: isTerminal,
    confirm: confirmBundle,
    write: (path, entries, now) => {
      ensureStateDir();
      writeZip(path, entries, now);
    },
  };
}

/** Ask before writing unredacted content, naming plainly what the archive holds. clack
 * is loaded lazily: src/cli.ts is the review hook's entrypoint on every plan, so nothing
 * on that path may pull it in eagerly. */
async function confirmBundle(): Promise<boolean | null> {
  const { confirm, isCancel } = await import("@clack/prompts");
  const answer = await confirm({
    message: "The bundle holds your logs and plan bodies, unredacted. Write it?",
  });
  return isCancel(answer) ? null : answer === true;
}

export async function runDoctorSubcommand(opts: {
  json: boolean;
  bundle: boolean;
  yes: boolean;
}): Promise<void> {
  // 1 means the install has something wrong with it, 2 that no report was produced at
  // all — doctor could not collect one, or --bundle had no terminal to ask consent at
  // and stopped before collecting. Neither a degraded section nor a prompt answered no
  // is that: both still print a usable report.
  try {
    // Consent is settled before anything is collected, so a refusal costs no probes.
    const bundled = opts.bundle ? await runBundle({ yes: opts.yes }, prodBundleDeps()) : undefined;
    if (bundled?.kind === "refused") {
      process.stderr.write(`caret doctor: ${bundled.message}\n`);
      process.exit(2);
    }
    if (bundled?.kind === "written") {
      // Announced the moment it exists, so a failure below never leaves an unredacted
      // archive unmentioned. Under --json the note goes to stderr so stdout stays
      // exactly one document.
      const note = opts.json ? process.stderr : process.stdout;
      note.write(`caret doctor: wrote ${bundled.path}\n`);
      note.write("caret doctor: it is unredacted — move it over a channel you trust\n");
    }
    const s = loadSettings();
    // The check's bounded npm read is independent of the local probes, so it runs
    // alongside them.
    const [report, adapterChecks] = await Promise.all([
      collectReport(prodDoctorDeps(s)),
      readAdapterChecks(),
    ]);
    const doc: DoctorDocument = { ...report, checks: runChecks(report, adapterChecks) };
    // The same gate createInstallUI draws its chrome behind: a pipe, NO_COLOR, or CI all
    // want the glyphs bare. Deciding it here keeps the renderer a pure function.
    const color =
      process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.CI !== "true";
    process.stdout.write(`${renderStdout(doc, opts.json ? "json" : "text", color)}\n`);
    process.exit(doc.checks.some((c) => c.status === "fail") ? 1 : 0);
  } catch (e) {
    process.stderr.write(`caret doctor: ${errorMessage(e)}\n`);
    process.exit(2);
  }
}
