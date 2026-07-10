// Orchestration for the `dev` tasks-CLI subcommand: boot and reap the three dev
// processes (daemon + driver + Vite), isolate their state, and tear everything
// down on exit. This is the Bun port of the former .mise/tasks/dev bash task —
// same behavior, but the process supervision and the arg parsing now live in
// TypeScript (commander owns the flags; see scripts/tasks/cli.ts), so there is
// no `set -u`/empty-array/bash-3.2 class of footgun. Every non-supervisory
// decision still comes from scripts/tasks/dev/dev-env.ts (port mode, lock-based
// port discovery, the typed constants), imported directly rather than shelled out.

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Subprocess } from "bun";
import { NEVER_IDLE_MS } from "../../../src/constants.ts";
import { isPidAlive } from "../../../src/daemon-lifecycle.ts";
import { devPort, devStateDir, loadSettings } from "../../../src/settings.ts";
import { installCleanupHandlers } from "../lib/signals.ts";
import { discoverPort, readDevLockPort, resolvePortMode } from "./dev-env.ts";

export interface RunDevOptions {
  /** How many versions the primary dev review opens with (commander-defaulted). */
  numVersions: number;
  /** Arm the recurring extra-review seeder (the EXC-427 notification path). */
  notify: boolean;
}

/** Boot the dev stack and block until Vite exits (or a signal tears it down).
 * Never returns on the signal path — the handler calls process.exit — and calls
 * process.exit with Vite's code on the normal path. */
export async function runDev(opts: RunDevOptions): Promise<never> {
  // Self-heal missing JS deps so a fresh clone or worktree can run dev without a
  // separate install first. The Vite bin is the sentinel, so the common path
  // (deps present) is a cheap stat, not a full install on every boot.
  if (!existsSync("node_modules/.bin/vite")) {
    console.error("caret dev: JS deps not installed — running bun install");
    await Bun.spawn(["bun", "install"], { stdout: "inherit", stderr: "inherit" }).exited;
  }

  const settings = loadSettings();

  // Port mode (EXC-461): ephemeral by default (OS-assigned, discovered from the
  // daemon's lock, so any number of sessions coexist); a fixed CARET_DEV_PORT /
  // [dev].port pins it (dev-env.ts rejects the production default).
  const rawPort = devPort(settings);
  const portMode = resolvePortMode(rawPort === undefined ? undefined : String(rawPort));

  // State dir: ephemeral mktemp by default (isolated + wiped on exit); a
  // persistent CARET_DEV_STATE_DIR / [dev].state_dir is reused and kept.
  let stateDir = devStateDir(settings);
  const persistState = stateDir !== undefined && stateDir !== "";
  if (persistState) {
    mkdirSync(stateDir as string, { recursive: true });
  } else {
    stateDir = mkdtempSync(join(tmpdir(), "caret-dev."));
  }
  const stateDirPath = stateDir as string;

  // Child env: Bun.spawn snapshots process.env at startup and IGNORES later
  // mutations (verified), so the dev overrides must be passed explicitly to
  // every child — the bash task got away with `export` because it set them
  // before exec. The daemon reads XDG_STATE_HOME (its isolated state) and
  // CARET_IDLE_MS (never idle-shutdown mid-session); the driver and Vite's proxy
  // read CARET_PORT, filled in after port discovery below.
  const childEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    XDG_STATE_HOME: stateDirPath,
    CARET_IDLE_MS: String(NEVER_IDLE_MS),
  };
  if (portMode.kind === "fixed") childEnv.CARET_PORT = String(portMode.port);

  // A persistent dir may hold a stale lock from a crashed run; the boot writes
  // its own, so clear it first or port discovery would read the stale port.
  const worldDir = join(stateDirPath, "caret");
  const lockFile = join(worldDir, "daemon.lock");
  rmSync(lockFile, { force: true });

  const children: Subprocess[] = [];
  let cleanedUp = false;
  // Reap the children and drop the ephemeral state dir, so a teardown never
  // leaves an orphan holding the dev port or stale reviews (AC6). Idempotent and
  // fully synchronous, so it is safe from both signal handlers and 'exit'.
  const cleanup = (): void => {
    if (cleanedUp) return;
    cleanedUp = true;
    for (const child of children) {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }
    if (!persistState) {
      try {
        rmSync(stateDirPath, { recursive: true, force: true });
      } catch {
        // best-effort
      }
    }
  };
  installCleanupHandlers(cleanup);

  // Daemon: stock daemon from source (so edits are live without a rebuild). It
  // emits NDJSON on stderr (EXC-398); render it human-readable through
  // pino-pretty (a devDependency, never bundled). pino-pretty's own stdout goes
  // to our stderr (fd 2) so it never pollutes the task's stdout.
  const daemon = Bun.spawn(
    ["bun", "src/cli.ts", "daemon", ...(portMode.kind === "ephemeral" ? ["--ephemeral"] : [])],
    { stdout: "inherit", stderr: "pipe", env: childEnv },
  );
  children.push(daemon);
  const pretty = Bun.spawn(
    ["bunx", "pino-pretty", "--colorize", "--translateTime", "UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'"],
    { stdin: daemon.stderr, stdout: 2, stderr: "inherit" },
  );
  children.push(pretty);

  // Discover the daemon's bound port from its own-world lock (written after a
  // successful bind). Bounded wait, loud failure — including a daemon that died
  // on boot (DAEMON_DIED) or that grabbed the production default port.
  const port = await discoverPort({
    readPort: () => readDevLockPort(lockFile, worldDir),
    daemonAlive: () => isPidAlive(daemon.pid),
  });
  childEnv.CARET_PORT = String(port);
  console.log(`caret dev: port=${port} state=${stateDirPath} persistent=${persistState ? 1 : 0}`);

  // Driver: seeds the fake plan and plays the agent's protocol side (waits for
  // health first). --num-versions is always forwarded (commander-defaulted);
  // --notify arms the recurring extra-review seeder.
  const driver = Bun.spawn(
    [
      "bun",
      "scripts/tasks/dev/driver.ts",
      "--num-versions",
      String(opts.numVersions),
      ...(opts.notify ? ["--notify"] : []),
    ],
    { stdout: "inherit", stderr: "inherit", env: childEnv },
  );
  children.push(driver);

  // Vite last; block on it (like the bash `wait "$vite_pid"`) so the process
  // stays alive until Vite exits, and a teardown signal reaches the handlers
  // above even if it hits this PID alone rather than the whole group.
  const vite = Bun.spawn(["bunx", "vite"], {
    cwd: "ui",
    stdout: "inherit",
    stderr: "inherit",
    env: childEnv,
  });
  children.push(vite);

  const code = await vite.exited;
  cleanup();
  process.exit(code ?? 0);
}
