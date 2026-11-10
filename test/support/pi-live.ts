// Drive real pi (on Node) against the packed caret package: pack it, install it into a
// throwaway pi agent dir, run pi with a scripted faux model, and reap everything after.

import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Subprocess } from "bun";

import pkg from "@root/package.json" with { type: "json" };
import { drainProcess } from "@test/support/cli-process.ts";
import { freePort } from "@test/support/net.ts";
import { until, waitFor } from "@test/support/poll.ts";
import { buildBundleCommand } from "@/tasks/build.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const PI_BIN = join(REPO_ROOT, "node_modules", ".bin", "pi");
const FAUX_EXTENSION = fileURLToPath(new URL("./pi-faux-provider.ts", import.meta.url));

function run(
  argv: string[],
  opts: { cwd?: string; env?: Record<string, string | undefined> } = {},
): string {
  const res = Bun.spawnSync(argv, { ...opts, timeout: 30_000 });
  if (res.exitCode !== 0) {
    throw new Error(
      `${argv.join(" ")} exited ${res.exitCode}:\n${res.stderr.toString()}${res.stdout.toString()}`,
    );
  }
  return res.stdout.toString();
}

const NODE_FLOOR = "22.19.0";

/** Throws naming the runtime when `node` or `npm` is missing from PATH, or `node` is
 * older than pi's floor. Call at module load. */
export function requireNode(): void {
  const hint = `pi's CLI runs on Node ${NODE_FLOOR}+ and the package is packed with npm. Install Node, e.g. \`mise use -g node@24\`.`;
  for (const bin of ["node", "npm"]) {
    if (!Bun.which(bin)) throw new Error(`pi live check: no \`${bin}\` on PATH — ${hint}`);
  }
  const version = Bun.spawnSync(["node", "--version"]).stdout.toString().trim();
  if (!Bun.semver.satisfies(version.replace(/^v/, ""), `>=${NODE_FLOOR}`)) {
    throw new Error(`pi live check: \`node\` is ${version}, below ${NODE_FLOOR} — ${hint}`);
  }
}

function bundleArgv(outdir: string): string[] {
  const argv = buildBundleCommand();
  argv[0] = process.execPath;
  argv[argv.indexOf("--outdir") + 1] = outdir;
  // Keeps a generated UI manifest left by `build bin` out of the bundle, as runBuildBundle does by deleting it.
  return [...argv, "--external", "@/ui-manifest.generated.ts"];
}

/** Stage package.json + every `files` entry but dist/ and ui/dist/ under `root`, build
 * dist/cli.js into the stage, `npm pack` it, untar; returns the unpacked package dir. */
export function packCaret(root: string): string {
  const stage = join(root, "stage");
  const packDir = join(root, "pack");
  const unpackDir = join(root, "pkg");
  mkdirSync(stage);
  mkdirSync(packDir);
  mkdirSync(unpackDir);
  cpSync(join(REPO_ROOT, "package.json"), join(stage, "package.json"));
  for (const entry of pkg.files.map((f) => f.replace(/\/$/, ""))) {
    if (entry === "dist" || entry === "ui/dist") continue;
    const src = join(REPO_ROOT, entry);
    if (!existsSync(src)) throw new Error(`package.json files entry missing on disk: ${entry}`);
    const dst = join(stage, entry);
    mkdirSync(dirname(dst), { recursive: true });
    cpSync(src, dst, { recursive: true });
  }
  run(bundleArgv(join(stage, "dist")), { cwd: REPO_ROOT });
  const packReport = run(
    ["npm", "pack", "--ignore-scripts", "--json", "--pack-destination", packDir],
    {
      cwd: stage,
      env: { ...process.env, npm_config_update_notifier: "false" },
    },
  );
  const tgz = join(packDir, JSON.parse(packReport)[0].filename);
  run(["tar", "-xzf", tgz, "-C", unpackDir]);
  return join(unpackDir, "package");
}

export interface PiSandbox {
  /** The child's complete env, not an overlay on `process.env`. */
  env: Record<string, string>;
  cwd: string;
  agentDir: string;
  url: string;
  port: number;
}

/** A fresh dir under `root`: stub open/xdg-open on PATH, pi agent dir with `pkgDir`
 * installed, isolated caret state/config/port. */
export function piSandbox(root: string, pkgDir: string): PiSandbox {
  const dir = mkdtempSync(join(root, "case-"));
  const bin = join(dir, "bin");
  const agentDir = join(dir, "agent");
  const cwd = join(dir, "work");
  const state = join(dir, "state");
  for (const d of [bin, agentDir, cwd, state]) mkdirSync(d);
  for (const name of ["open", "xdg-open"]) {
    writeFileSync(join(bin, name), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, name), 0o755);
  }
  const config = join(dir, "config.toml");
  writeFileSync(config, "[updates]\ncheck = false\n");
  const port = freePort();
  const inherited = Object.entries(process.env).filter(
    (e): e is [string, string] =>
      e[1] !== undefined && !e[0].startsWith("CARET_") && !e[0].startsWith("CMUX_"),
  );
  const env: Record<string, string> = {
    ...Object.fromEntries(inherited),
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    PI_CODING_AGENT_DIR: agentDir,
    PI_OFFLINE: "1",
    PI_SKIP_VERSION_CHECK: "1",
    PI_TELEMETRY: "0",
    XDG_STATE_HOME: state,
    CARET_CONFIG_FILE: config,
    CARET_PORT: String(port),
    // The one CARET_* key kept: the daemon formats with test/support/rumdl-preload.ts's
    // offline rumdl instead of downloading one into each fresh state dir.
    ...(process.env.CARET_RUMDL_BIN ? { CARET_RUMDL_BIN: process.env.CARET_RUMDL_BIN } : {}),
  };
  run([PI_BIN, "install", pkgDir], { cwd, env });
  return { env, cwd, agentDir, url: `http://127.0.0.1:${port}`, port };
}

export interface PiRun {
  /** Leads its own process group. */
  proc: Subprocess<"ignore", "pipe", "pipe">;
  output: Promise<{ stdout: string; stderr: string; exit: number }>;
}

/** Runs `prompts` in order, in one pi session under the faux model, in its own process
 * group, so stopPiTree can signal the whole tree. */
export function runPi(sandbox: PiSandbox, ...prompts: string[]): PiRun {
  const proc = Bun.spawn(
    [PI_BIN, "-p", "--provider", "faux", "--model", "faux-1", "-e", FAUX_EXTENSION, ...prompts],
    {
      cwd: sandbox.cwd,
      env: sandbox.env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      detached: true,
    },
  );
  return { proc, output: drainProcess(proc) };
}

/** The first pending review; rejects at once (with pi's output) if pi exits first, or
 * with waitFor's timeout after `ms`. */
export function waitForReview(
  sandbox: PiSandbox,
  pi: PiRun,
  ms: number,
): Promise<Record<string, unknown>> {
  return waitFor(async () => {
    if (pi.proc.exitCode !== null) {
      const out = await pi.output;
      throw new Error(
        `pi exited ${out.exit} before a review appeared\n--- stdout\n${out.stdout}\n--- stderr\n${out.stderr}`,
      );
    }
    // Not daemonClient().listReviews: it has no timeout, so a silent listener hangs it.
    try {
      const res = await fetch(`${sandbox.url}/api/reviews`, {
        signal: AbortSignal.timeout(1_000),
      });
      const reviews = (await res.json()) as Array<Record<string, unknown>>;
      return reviews[0];
    } catch {
      return undefined;
    }
  }, ms);
}

/** The one `*.jsonl` under `<agentDir>/sessions` and the `<sessionId>` its name carries;
 * throws with the listing unless there is exactly one. */
function piSessionFile(sandbox: PiSandbox): { path: string; id: string } {
  const sessions = join(sandbox.agentDir, "sessions");
  const files = readdirSync(sessions, { recursive: true }).map(String);
  const sessionFiles = files.flatMap((f) => {
    const id = f.match(/_([0-9a-f-]{36})\.jsonl$/)?.[1];
    return id ? [{ path: join(sessions, f), id }] : [];
  });
  if (sessionFiles.length !== 1)
    throw new Error(`expected one pi session file, found: ${files.join(", ")}`);
  return sessionFiles[0] as { path: string; id: string };
}

/** pi's session id. */
export function piSessionId(sandbox: PiSandbox): string {
  return piSessionFile(sandbox).id;
}

/** The parsed entries of pi's session file, one per JSONL line. */
export function piSessionEntries(sandbox: PiSandbox): unknown[] {
  return readFileSync(piSessionFile(sandbox).path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/** PIDs whose command line names `root` (`pgrep -f root`). */
export function strays(root: string): number[] {
  const out = Bun.spawnSync(["pgrep", "-f", root]).stdout.toString();
  return out.split("\n").filter(Boolean).map(Number);
}

function kill(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ESRCH") throw err;
  }
}

/** SIGTERM pi's group, SIGKILL it after 2 s, then SIGKILL strays under `root` until none. */
export async function stopPiTree(pi: PiRun | undefined, root: string): Promise<void> {
  if (pi) {
    kill(-pi.proc.pid, "SIGTERM");
    await until(() => pi.proc.exitCode !== null, 2_000);
    kill(-pi.proc.pid, "SIGKILL");
  }
  await until(() => {
    const pids = strays(root);
    for (const p of pids) kill(p, "SIGKILL");
    return pids.length === 0;
  }, 3_000);
}
