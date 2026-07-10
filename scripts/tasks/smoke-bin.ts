// `smoke-bin` task: prove the COMPILED binary serves the UI purely from its
// embedded asset manifest (EXC-521/522), not from a dist tree on disk. Kept OUT
// of preflight on purpose — it depends on a full `bun build --compile`, too slow
// for the per-push gate; this is the final-validation / pre-release run.
//
// Isolating the embed takes care: ui-assets.ts's resolver has two on-disk
// fallbacks that would serve a valid UI even with a broken embed, masking the
// failure this task exists to catch. Both key off the *binary's* location, not
// the cwd. besideDist (dirname(execPath)/ui) is the real masking source: build-bin
// copies ui/dist to bin/ui, so bin/caret-native always has a valid sibling UI. We
// neutralize it by running a COPY of the binary alone in a temp dir with no
// sibling ui/ — then neither disk fallback resolves and the embedded manifest is
// the only possible asset source.

import { accessSync, constants, cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { isPidAlive } from "../../src/daemon-lifecycle.ts";
import { readJsonFileSync } from "../../src/json-file.ts";
import { installCleanupHandlers } from "./lib/signals.ts";
import { probeServedUi } from "./lib/smoke-probe.ts";

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
  const srcBin = join(process.cwd(), "bin", "caret-native");
  if (!isExecutable(srcBin)) {
    process.stderr.write(
      `smoke-bin: ${srcBin} missing or not executable (run \`mise run build\`)\n`,
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
      process.stderr.write("smoke-bin: daemon exited before writing its lock\n");
      process.exit(1);
    }
    await Bun.sleep(50);
  }
  if (port === undefined) {
    process.stderr.write("smoke-bin: daemon did not report a port within ~5s\n");
    process.exit(1);
  }

  const base = `http://127.0.0.1:${port}`;
  console.log(`smoke-bin: daemon up on ${base} (pid ${daemonPid}, state ${stateDir})`);

  try {
    const assets = await probeServedUi(base, {
      label: "smoke-bin",
      requireProduction: false,
      emptyAssetsHint: "broken embed? placeholder served?",
    });
    console.log(`smoke-bin: index references ${assets.length} hashed asset(s)`);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  console.log("smoke-bin: PASS — compiled binary serves the embedded multi-asset UI");
  process.exit(0);
}
