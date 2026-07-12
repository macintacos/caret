// Orchestration for the `dev` tasks-CLI subcommand: boot and reap the dev
// processes (daemon + pino-pretty + Vite), run the protocol driver in-process,
// isolate their state, and tear everything down on exit. Commander owns the
// flags (see scripts/tasks/cli.ts), so the driver's --num-versions is parsed
// exactly once and handed over directly rather than re-spawned + re-parsed.
// Every non-supervisory decision comes from scripts/tasks/dev/dev-env.ts (port
// mode, lock-based port discovery, the typed constants), imported directly.
//
// The effects are injected through DevDeps (spawn, discoverPort, the in-process
// driver, exit, cleanup registration) so the supervision — teardown and the
// daemon-died path — is unit-testable without launching real processes; the
// pure boot decisions (planStateDir, daemonCommand, childEnvFor, makeCleanup)
// are plain functions tested directly.

import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NEVER_IDLE_MS } from "../../../src/constants.ts";
import { isPidAlive } from "../../../src/daemon-lifecycle.ts";
import { devPort, devStateDir, loadSettings, type Settings } from "../../../src/settings.ts";
import { installCleanupHandlers } from "../lib/signals.ts";
import { type DriverOptions, run as runDriverEntry } from "./driver.ts";
import {
  type DiscoverPortDeps,
  discoverPort as realDiscoverPort,
  type PortMode,
  readDevLockPort,
  resolvePortMode,
} from "./dev-env.ts";

export interface RunDevOptions {
  /** How many versions the primary dev review opens with (commander-defaulted). */
  numVersions: number;
  /** Arm the recurring extra-review seeder (the EXC-427 notification path). */
  notify: boolean;
}

/** The daemon argv, adding `--ephemeral` only in ephemeral port mode (a fixed
 * port is passed through the child env instead, via childEnvFor). */
export function daemonCommand(portMode: PortMode): string[] {
  return ["bun", "src/cli.ts", "daemon", ...(portMode.kind === "ephemeral" ? ["--ephemeral"] : [])];
}

/** The environment every dev child inherits: the isolated state dir, a
 * never-idle daemon, and (in fixed-port mode) the pinned port. Built off
 * process.env because Bun.spawn snapshots it at startup and ignores later
 * mutations, so the overrides must be passed explicitly to each child. In
 * ephemeral mode CARET_PORT is filled in after port discovery. */
export function childEnvFor(stateDirPath: string, portMode: PortMode): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    XDG_STATE_HOME: stateDirPath,
    CARET_IDLE_MS: String(NEVER_IDLE_MS),
  };
  if (portMode.kind === "fixed") env.CARET_PORT = String(portMode.port);
  return env;
}

/** Decide the dev state dir from the resolved config value and the --persist
 * flag. A named dir (flag / CARET_DEV_STATE_DIR / [dev].state_dir) is reused and
 * always kept; otherwise an ephemeral mktemp dir is used, kept only when
 * --persist is set (for post-run inspection) and wiped on exit otherwise. */
export type StatePlan = { kind: "named"; dir: string } | { kind: "ephemeral"; keep: boolean };
export function planStateDir(configured: string | undefined, persist: boolean): StatePlan {
  if (configured !== undefined && configured !== "") return { kind: "named", dir: configured };
  return { kind: "ephemeral", keep: persist };
}

/** A spawned child, narrowed to what the supervision uses; the real
 * implementation wraps Bun.spawn, tests supply a fake. */
export interface SpawnedChild {
  readonly pid: number;
  /** The daemon's piped stderr, forwarded into pino-pretty's stdin. */
  readonly stderr: ReadableStream<Uint8Array> | number | undefined;
  readonly exited: Promise<number>;
  kill(signal?: number): void;
}

export type SpawnFn = (
  cmd: string[],
  opts: {
    cwd?: string;
    env?: Record<string, string>;
    stdout?: "inherit" | "pipe" | number;
    stderr?: "inherit" | "pipe" | number;
    stdin?: ReadableStream<Uint8Array> | number | "inherit" | null;
  },
) => SpawnedChild;

/** Something the teardown can kill (SpawnedChild satisfies it). */
export interface Killable {
  kill(): void;
}

/** Build the idempotent teardown: kill every child, then wipe the state dir
 * only when `wipeOnExit`. Fully synchronous and re-entrancy-guarded, so it is
 * safe to run from a signal handler and again from the subsequent 'exit'. */
export function makeCleanup(
  children: Killable[],
  opts: { stateDirPath: string; wipeOnExit: boolean; rm: (dir: string) => void },
): () => void {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    for (const child of children) {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }
    if (opts.wipeOnExit) {
      try {
        opts.rm(opts.stateDirPath);
      } catch {
        // best-effort
      }
    }
  };
}

/** The effects runDev performs, injected so the supervision is testable. */
export interface DevDeps {
  loadSettings: () => Settings;
  spawn: SpawnFn;
  discoverPort: (deps: DiscoverPortDeps) => Promise<number>;
  /** Run the protocol driver in-process (never resolves under normal operation;
   * it dies with this process on teardown). */
  runDriver: (opts: DriverOptions) => void;
  installCleanupHandlers: (cleanup: () => void) => void;
  exit: (code: number) => never;
}

const realDevDeps: DevDeps = {
  loadSettings,
  // The seam's option subset maps onto Bun.spawn; cast once at this boundary so
  // callers and tests work against the narrow SpawnFn shape.
  spawn: (cmd, opts) =>
    (Bun.spawn as unknown as (c: string[], o: unknown) => SpawnedChild)(cmd, opts),
  discoverPort: realDiscoverPort,
  runDriver: (opts) => {
    void runDriverEntry(opts).catch((err) => process.stderr.write(`caret dev driver: ${err}\n`));
  },
  installCleanupHandlers,
  exit: (code) => process.exit(code),
};

/** Boot the dev stack and block until Vite exits (or a signal tears it down).
 * Never returns on the signal path — the handler calls process.exit — and calls
 * process.exit with Vite's code on the normal path. */
export async function runDev(opts: RunDevOptions, deps: DevDeps = realDevDeps): Promise<never> {
  // Self-heal missing JS deps so a fresh clone or worktree can run dev without a
  // separate install first. The Vite bin is the sentinel, so the common path
  // (deps present) is a cheap stat, not a full install on every boot.
  if (!existsSync("node_modules/.bin/vite")) {
    console.error("caret dev: JS deps not installed — running bun install");
    await deps.spawn(["bun", "install"], { stdout: "inherit", stderr: "inherit" }).exited;
  }

  const settings = deps.loadSettings();

  // Port mode (EXC-461): ephemeral by default (OS-assigned, discovered from the
  // daemon's lock, so any number of sessions coexist); a fixed CARET_DEV_PORT /
  // [dev].port pins it (dev-env.ts rejects the production default).
  const rawPort = devPort(settings);
  const portMode = resolvePortMode(rawPort === undefined ? undefined : String(rawPort));

  // State dir: ephemeral mktemp by default (isolated + wiped on exit); a
  // persistent CARET_DEV_STATE_DIR / [dev].state_dir is reused and kept.
  const plan = planStateDir(devStateDir(settings), false);
  let stateDirPath: string;
  let wipeOnExit: boolean;
  if (plan.kind === "named") {
    mkdirSync(plan.dir, { recursive: true });
    stateDirPath = plan.dir;
    wipeOnExit = false;
  } else {
    stateDirPath = mkdtempSync(join(tmpdir(), "caret-dev."));
    wipeOnExit = !plan.keep;
  }
  const persistState = !wipeOnExit;

  const childEnv = childEnvFor(stateDirPath, portMode);

  // A persistent dir may hold a stale lock from a crashed run; the boot writes
  // its own, so clear it first or port discovery would read the stale port.
  const worldDir = join(stateDirPath, "caret");
  const lockFile = join(worldDir, "daemon.lock");
  rmSync(lockFile, { force: true });

  const children: SpawnedChild[] = [];
  // Reap the children and drop the ephemeral state dir, so a teardown never
  // leaves an orphan holding the dev port or stale reviews (AC6).
  const cleanup = makeCleanup(children, {
    stateDirPath,
    wipeOnExit,
    rm: (dir) => rmSync(dir, { recursive: true, force: true }),
  });
  deps.installCleanupHandlers(cleanup);

  try {
    // Daemon: stock daemon from source (so edits are live without a rebuild). It
    // emits NDJSON on stderr (EXC-398); render it human-readable through
    // pino-pretty (a devDependency, never bundled). pino-pretty's own stdout goes
    // to our stderr (fd 2) so it never pollutes the task's stdout.
    const daemon = deps.spawn(daemonCommand(portMode), {
      stdout: "inherit",
      stderr: "pipe",
      env: childEnv,
    });
    children.push(daemon);
    const pretty = deps.spawn(
      ["bunx", "pino-pretty", "--colorize", "--translateTime", "UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'"],
      { stdin: daemon.stderr, stdout: 2, stderr: "inherit" },
    );
    children.push(pretty);

    // Discover the daemon's bound port from its own-world lock (written after a
    // successful bind). Bounded wait, loud failure — including a daemon that died
    // on boot (DAEMON_DIED) or that grabbed the production default port.
    const port = await deps.discoverPort({
      readPort: () => readDevLockPort(lockFile, worldDir),
      daemonAlive: () => isPidAlive(daemon.pid),
    });
    childEnv.CARET_PORT = String(port);
    console.log(`caret dev: port=${port} state=${stateDirPath} persistent=${persistState ? 1 : 0}`);

    // Driver: seeds the fake plan and plays the agent's protocol side, in this
    // same process. Its options arrive already parsed (commander), so there is no
    // subprocess and no argv re-parse; the loop never resolves and dies with this
    // process on teardown, so it is not among the reaped children.
    deps.runDriver({
      base: `http://127.0.0.1:${port}`,
      numVersions: opts.numVersions,
      notify: opts.notify,
      settings,
    });

    // Vite last; block on it (like the bash `wait "$vite_pid"`) so the process
    // stays alive until Vite exits, and a teardown signal reaches the handlers
    // above even if it hits this PID alone rather than the whole group.
    const vite = deps.spawn(["bunx", "vite"], {
      cwd: "ui",
      stdout: "inherit",
      stderr: "inherit",
      env: childEnv,
    });
    children.push(vite);

    const code = await vite.exited;
    cleanup();
    return deps.exit(code ?? 0);
  } catch (err) {
    // A throw mid-boot (e.g. discoverPort's DAEMON_DIED) still reaps the children
    // already spawned, rather than leaking them until the process exits.
    cleanup();
    throw err;
  }
}
