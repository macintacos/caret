// `smoke` task group (EXC-740): release-confidence smoke tests for the two
// distribution artifacts, consolidated into one command whose `bin`/`bundle`
// positional targets map to `mise run smoke <target>`. Bare `mise run smoke`
// runs both (bin then bundle) — the full pre-release check. Kept OUT of preflight
// on purpose: each target depends on a full build, too slow for the per-push gate.
//
// Each target builds its own artifact first (replacing the old `#MISE
// depends=["build"]` / `depends=["build-bundle"]` edges): `smoke bin` invokes
// `build bin`, `smoke bundle` invokes `build bundle`, via the tasks CLI so the
// UI-first ordering + skip mechanism in build.ts is reused.

import {
  accessSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { isPidAlive } from "../../src/daemon-lifecycle.ts";
import { readJsonFileSync } from "../../src/lib/json-file.ts";
import { runForward } from "./lib/exec.ts";
import { installCleanupHandlers } from "./lib/signals.ts";
import { probeServedUi } from "./lib/smoke-probe.ts";

// --- smoke (umbrella) -------------------------------------------------------

/** Bare `mise run smoke`: build the UI once up front, then run both targets as
 * fresh subprocesses with CARET_SKIP_BUILD_UI=1 so neither rebuilds it — the
 * umbrella would otherwise pay the full Vite build twice (each target's build
 * bin / build bundle runs ensureUi). Each target exits on its own; stop at the
 * first failure. The runner is injectable so tests pin the sequence + the skip
 * env without spawning. */
export async function smokePlan(run: typeof runForward = runForward): Promise<number> {
  const ui = await run(["bun", "scripts/tasks/cli.ts", "build", "ui"]);
  if (ui !== 0) return ui;
  const env = { ...(process.env as Record<string, string>), CARET_SKIP_BUILD_UI: "1" };
  const bin = await run(["bun", "scripts/tasks/cli.ts", "smoke", "bin"], { env });
  if (bin !== 0) return bin;
  return await run(["bun", "scripts/tasks/cli.ts", "smoke", "bundle"], { env });
}

export async function runSmoke(): Promise<never> {
  process.exit(await smokePlan());
}

// --- smoke bin --------------------------------------------------------------
// Prove the COMPILED binary serves the UI purely from its embedded asset
// manifest (EXC-521/522), not from a dist tree on disk.
//
// Isolating the embed takes care: ui-assets.ts's resolver has two on-disk
// fallbacks that would serve a valid UI even with a broken embed, masking the
// failure this task exists to catch. Both key off the *binary's* location, not
// the cwd. besideDist (dirname(execPath)/ui) is the real masking source: build
// bin copies ui/dist to bin/ui, so bin/caret-native always has a valid sibling
// UI. We neutralize it by running a COPY of the binary alone in a temp dir with
// no sibling ui/ — then neither disk fallback resolves and the embedded manifest
// is the only possible asset source.

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The daemon lock's port field, or undefined if the lock is absent, unreadable,
 * or portless. */
function lockPort(lockFile: string): number | undefined {
  const lock = readJsonFileSync(lockFile) as { port?: number } | null;
  return typeof lock?.port === "number" ? lock.port : undefined;
}

export async function runSmokeBin(): Promise<never> {
  // Build the compiled binary first (ui + compile), replacing the old mise
  // `depends=["build"]` edge.
  const built = await runForward(["bun", "scripts/tasks/cli.ts", "build", "bin"]);
  if (built !== 0) process.exit(built);

  const srcBin = join(process.cwd(), "bin", "caret-native");
  if (!isExecutable(srcBin)) {
    process.stderr.write(
      `smoke bin: ${srcBin} missing or not executable (run \`mise run build bin\`)\n`,
    );
    process.exit(1);
  }

  // Isolated ephemeral state dir (its own daemon.lock + reviews) and a dir to
  // hold the lone binary copy — both wiped on exit.
  const stateDir = mkdtempSync(join(tmpdir(), "caret-smoke."));
  const runDir = mkdtempSync(join(tmpdir(), "caret-smoke-bin."));
  const lockFile = join(stateDir, "caret", "daemon.lock");

  let daemon: Subprocess | undefined;
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    try {
      daemon?.kill();
    } catch {
      // already gone
    }
    rmSync(stateDir, { recursive: true, force: true });
    rmSync(runDir, { recursive: true, force: true });
  };
  installCleanupHandlers(cleanup);

  // Copy the binary into the temp dir alone — no sibling ui/ — so the
  // beside-the-binary fallback has nothing to resolve and the embed must serve.
  const bin = join(runDir, "caret");
  cpSync(srcBin, bin);

  // Boot the copied binary on an OS-assigned port (--ephemeral) with the
  // isolated state dir. Env is passed explicitly (Bun.spawn snapshots
  // process.env); the cwd doesn't affect asset resolution (it keys off execPath).
  daemon = Bun.spawn([bin, "daemon", "--ephemeral"], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...(process.env as Record<string, string>), XDG_STATE_HOME: stateDir },
  });
  const daemonPid = daemon.pid;

  // Discover the bound port from the lock the daemon writes after binding.
  // Bounded poll: ~5s at 50ms, then fail loudly.
  let port: number | undefined;
  for (let i = 0; i < 100; i++) {
    port = lockPort(lockFile);
    if (port !== undefined) break;
    if (!isPidAlive(daemonPid)) {
      process.stderr.write("smoke bin: daemon exited before writing its lock\n");
      process.exit(1);
    }
    await Bun.sleep(50);
  }
  if (port === undefined) {
    process.stderr.write("smoke bin: daemon did not report a port within ~5s\n");
    process.exit(1);
  }

  const base = `http://127.0.0.1:${port}`;
  console.log(`smoke bin: daemon up on ${base} (pid ${daemonPid}, state ${stateDir})`);

  try {
    const assets = await probeServedUi(base, {
      label: "smoke bin",
      requireProduction: false,
      emptyAssetsHint: "broken embed? placeholder served?",
    });
    console.log(`smoke bin: index references ${assets.length} hashed asset(s)`);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  console.log("smoke bin: PASS — compiled binary serves the embedded multi-asset UI");
  process.exit(0);
}

// --- smoke bundle -----------------------------------------------------------
// Release-confidence smoke for the GitHub-based plugin install (EXC-643). Proves
// the distribution artifact — the non-compile `bun build` bundle plus the on-disk
// ui/dist beside it — works exactly as a user's npm-installed plugin would.
//
// Crucially it drives the REAL hook flow: `caret prewarm` → ensureDaemon →
// daemonCommand() spawns a DETACHED daemon child. Running the daemon in the
// foreground (an earlier version) never exercised daemonCommand and missed a
// bundle mis-classified as a compiled binary, whose spawned child was
// `[bun, "daemon"]` (no script) and never started. The prewarm path catches that.
//
// Isolation: a temp package layout (pkg/dist/cli.js + pkg/ui/dist) the resolver
// can only serve the shipped ui/dist from, a private XDG_STATE_HOME, and a free
// CARET_PORT so the test daemon never collides with a real caret daemon on the
// default port (a foreign-world collision makes prewarm a silent no-op).

/** The daemon lock's pid field, or undefined if the lock is absent/unreadable. */
function lockPid(lockFile: string): number | undefined {
  const lock = readJsonFileSync(lockFile) as { pid?: number } | null;
  return typeof lock?.pid === "number" ? lock.pid : undefined;
}

/** Allocate a free TCP port by binding one momentarily, so the test daemon never
 * collides with a real caret daemon on the default port. */
function freePort(): number {
  const server = Bun.serve({ port: 0, fetch: () => new Response("") });
  const { port } = server;
  server.stop(true);
  if (port === undefined) throw new Error("smoke bundle: failed to allocate a free port");
  return port;
}

/** Best-effort: write the tail of the isolated daemon's logs to stderr, so a
 * prewarm that failed to spawn a daemon leaves a diagnostic. */
function dumpDaemonLogs(worldDir: string): void {
  try {
    const lines: string[] = [];
    for (const f of readdirSync(worldDir).filter((n) => n.endsWith(".log"))) {
      lines.push(...readFileSync(join(worldDir, f), "utf8").split("\n"));
    }
    const tail = lines.slice(-20).join("\n");
    if (tail) process.stderr.write(`${tail}\n`);
  } catch {
    // best-effort
  }
}

export async function runSmokeBundle(): Promise<never> {
  // Build the distribution bundle first (ui + non-compile bundle), replacing the
  // old mise `depends=["build-bundle"]` edge.
  const built = await runForward(["bun", "scripts/tasks/cli.ts", "build", "bundle"]);
  if (built !== 0) process.exit(built);

  const distDir = join(process.cwd(), "dist");
  const uiDist = join(process.cwd(), "ui", "dist");
  if (!existsSync(join(distDir, "cli.js"))) {
    process.stderr.write(
      `smoke bundle: ${join(distDir, "cli.js")} missing (run \`mise run build bundle\`)\n`,
    );
    process.exit(1);
  }
  if (!existsSync(uiDist)) {
    process.stderr.write(`smoke bundle: ${uiDist} missing (run \`mise run build ui\`)\n`);
    process.exit(1);
  }

  const pkgDir = mkdtempSync(join(tmpdir(), "caret-smoke-bundle."));
  const stateDir = mkdtempSync(join(tmpdir(), "caret-smoke-bundle-state."));
  const worldDir = join(stateDir, "caret");
  const lockFile = join(worldDir, "daemon.lock");

  let daemonPid: number | undefined;
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    // Kill the detached daemon the prewarm spawned (it would otherwise idle-exit
    // after ~60s); read its pid from the lock if we didn't capture it.
    daemonPid ??= lockPid(lockFile);
    if (daemonPid !== undefined) {
      try {
        process.kill(daemonPid);
      } catch {
        // already gone
      }
    }
    rmSync(pkgDir, { recursive: true, force: true });
    rmSync(stateDir, { recursive: true, force: true });
  };
  installCleanupHandlers(cleanup);

  // Assemble the temp package layout the resolver serves the shipped ui/dist from.
  cpSync(distDir, join(pkgDir, "dist"), { recursive: true });
  mkdirSync(join(pkgDir, "ui"), { recursive: true });
  cpSync(uiDist, join(pkgDir, "ui", "dist"), { recursive: true });

  const port = freePort();

  // Drive the real hook: prewarm → ensureDaemon → daemonCommand spawns the
  // daemon. Env is passed explicitly (Bun.spawn snapshots process.env). A
  // non-zero prewarm aborts here — nothing will bind, so there is no point
  // polling for a lock that can't appear.
  const prewarmCode = await Bun.spawn(["bun", join(pkgDir, "dist", "cli.js"), "prewarm"], {
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...(process.env as Record<string, string>),
      CARET_PORT: String(port),
      XDG_STATE_HOME: stateDir,
    },
  }).exited;
  if (prewarmCode !== 0) {
    process.stderr.write(`smoke bundle: prewarm exited ${prewarmCode}\n`);
    process.exit(prewarmCode);
  }

  // The detached daemon writes its lock after binding (~poll a couple seconds).
  let lockPresent = false;
  for (let i = 0; i < 100; i++) {
    if (existsSync(lockFile)) {
      lockPresent = true;
      break;
    }
    await Bun.sleep(50);
  }
  if (!lockPresent) {
    process.stderr.write(`smoke bundle: prewarm did not spawn a daemon (no lock at ${lockFile})\n`);
    dumpDaemonLogs(worldDir);
    process.exit(1);
  }
  daemonPid = lockPid(lockFile);

  const base = `http://127.0.0.1:${port}`;
  console.log(`smoke bundle: prewarm spawned a daemon on ${base} (pid ${daemonPid ?? ""})`);

  try {
    const assets = await probeServedUi(base, {
      label: "smoke bundle",
      requireProduction: true,
      emptyAssetsHint: "placeholder served? ui/dist missing?",
    });
    console.log(`smoke bundle: index references ${assets.length} hashed asset(s)`);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  console.log(
    "smoke bundle: PASS — prewarm spawned a bundle daemon that serves the multi-asset UI",
  );
  process.exit(0);
}
