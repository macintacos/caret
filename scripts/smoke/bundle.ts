// `smoke-bundle` task: release-confidence smoke for the GitHub-based plugin
// install (EXC-643). Proves the distribution artifact — the non-compile
// `bun build` bundle plus the on-disk ui/dist beside it — works exactly as a
// user's npm-installed plugin would.
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

import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonFileSync } from "../../src/json-file.ts";
import { probeServedUi } from "./probe.ts";

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
  if (port === undefined) throw new Error("smoke-bundle: failed to allocate a free port");
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
  const distDir = join(process.cwd(), "dist");
  const uiDist = join(process.cwd(), "ui", "dist");
  if (!existsSync(join(distDir, "cli.js"))) {
    process.stderr.write(
      `smoke-bundle: ${join(distDir, "cli.js")} missing (run \`mise run build-bundle\`)\n`,
    );
    process.exit(1);
  }
  if (!existsSync(uiDist)) {
    process.stderr.write(`smoke-bundle: ${uiDist} missing (run \`mise run build-ui\`)\n`);
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
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

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
    process.stderr.write(`smoke-bundle: prewarm exited ${prewarmCode}\n`);
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
    process.stderr.write(`smoke-bundle: prewarm did not spawn a daemon (no lock at ${lockFile})\n`);
    dumpDaemonLogs(worldDir);
    process.exit(1);
  }
  daemonPid = lockPid(lockFile);

  const base = `http://127.0.0.1:${port}`;
  console.log(`smoke-bundle: prewarm spawned a daemon on ${base} (pid ${daemonPid ?? ""})`);

  try {
    const assets = await probeServedUi(base, {
      label: "smoke-bundle",
      requireProduction: true,
      emptyAssetsHint: "placeholder served? ui/dist missing?",
    });
    console.log(`smoke-bundle: index references ${assets.length} hashed asset(s)`);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  console.log(
    "smoke-bundle: PASS — prewarm spawned a bundle daemon that serves the multi-asset UI",
  );
  process.exit(0);
}
