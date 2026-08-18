// Orchestration for the `dev` tasks-CLI subcommand: boot and reap the dev
// processes (daemon + pino-pretty + Vite), run the protocol driver in-process,
// isolate their state, and tear everything down on exit. Commander owns the
// flags (see scripts/tasks/cli.ts), so the driver's --num-versions is parsed
// exactly once and handed over directly rather than re-spawned + re-parsed.
// Every non-supervisory decision comes from scripts/tasks/dev/dev-env.ts (port
// mode, lock-based port discovery, the typed constants), imported directly.
//
// The effects are injected through DevDeps (spawn, discoverPort, the in-process
// driver, exit, cleanup registration, the terminal UI) so the supervision —
// teardown and the daemon-died path — is unit-testable without launching real
// processes; the pure boot decisions (planStateDir, daemonCommand, childEnvFor,
// makeCleanup) are plain functions tested directly.
//
// On a TTY the task runs the split-pane console in scripts/tasks/dev/tui.ts,
// which owns the screen — so every child is piped into it rather than inheriting
// the terminal, and this process's own writes are captured too. Piped or
// redirected, startTui returns null and the original inherited stdio stands.

import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { NEVER_IDLE_MS } from "@/config/constants.ts";
import { devConfigFile } from "@/config/paths.ts";
import { devPort, devStateDir, loadSettings, type Settings } from "@/config/settings.ts";
import { isPidAlive } from "@/daemon/lifecycle.ts";
import {
  type DiscoverPortDeps,
  type PortMode,
  readDevLockPort,
  discoverPort as realDiscoverPort,
  resolvePortMode,
} from "@/tasks/dev/dev-env.ts";
import { type DriverOptions, run as runDriverEntry } from "@/tasks/dev/driver.ts";
import { createTui, type Tui, type TuiOptions } from "@/tasks/dev/tui.ts";
import { installCleanupHandlers } from "@/tasks/lib/signals.ts";

export interface RunDevOptions {
  /** How many versions the primary dev review opens with (commander-defaulted). */
  numVersions: number;
  /** Arm the recurring extra-review seeder (the EXC-427 notification path). */
  notify: boolean;
  /** --port: the fixed dev daemon port, taking precedence over CARET_DEV_PORT /
   * [dev].port. Unset → the env/config value (or an OS-assigned ephemeral port). */
  port?: number;
  /** --state-dir: a persistent dev state dir, taking precedence over
   * CARET_DEV_STATE_DIR / [dev].state_dir. Unset → the env/config value (or an
   * ephemeral mktemp dir). */
  stateDir?: string;
  /** --persist: keep the state dir on exit even when it is the ephemeral default
   * (a named dir is always kept). */
  persist: boolean;
  /** --fresh: boot as a brand-new user — ignore config.dev.toml (use built-in
   * defaults) and tell the UI (via CARET_FRESH) to clear its saved preferences.
   * Optional; absent counts as not-fresh. */
  fresh?: boolean;
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
export function childEnvFor(
  stateDirPath: string,
  portMode: PortMode,
  extra: { configFile?: string; fresh?: boolean } = {},
): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    XDG_STATE_HOME: stateDirPath,
    CARET_IDLE_MS: String(NEVER_IDLE_MS),
  };
  if (portMode.kind === "fixed") env.CARET_PORT = String(portMode.port);
  // The daemon child reads its own dev config (config.dev.toml, or a nonexistent
  // path under --fresh); CARET_FRESH surfaces through /api/health so the UI resets
  // its saved preferences. Both are omitted in normal (non-dev) contexts (EXC-781).
  if (extra.configFile) env.CARET_CONFIG_FILE = extra.configFile;
  if (extra.fresh) env.CARET_FRESH = "1";
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
  readonly stderr: ReadableStream<Uint8Array> | number | undefined;
  /** The log tail's piped stdout, forwarded into pino-pretty's stdin. */
  readonly stdout?: ReadableStream<Uint8Array> | number | undefined;
  readonly exited: Promise<number>;
  kill(signal?: number): void;
}

export type SpawnFn = (
  cmd: string[],
  opts: {
    cwd?: string;
    env?: Record<string, string>;
    stdout?: "inherit" | "pipe" | number;
    stderr?: "inherit" | "pipe" | "ignore" | number;
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
  loadSettings: (file?: string) => Settings;
  spawn: SpawnFn;
  discoverPort: (deps: DiscoverPortDeps) => Promise<number>;
  /** Run the protocol driver in-process (never resolves under normal operation;
   * it dies with this process on teardown). */
  runDriver: (opts: DriverOptions) => void;
  installCleanupHandlers: (cleanup: () => void) => void;
  exit: (code: number) => never;
  /** Start the split-pane terminal UI, or return null to keep the children's
   * stdio inherited. Null whenever stdout is not a TTY — piped, redirected, or
   * under CI — which is what keeps `mise run dev > log.txt` behaving as before. */
  startTui: (opts: TuiOptions) => Tui | null;
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
  startTui: (opts) => {
    if (!process.stdout.isTTY) return null;
    return createTui(opts, {
      write: (s) => void writeToTerminal(s),
      size: () => ({ cols: process.stdout.columns ?? 80, rows: process.stdout.rows ?? 24 }),
      onKey: (handler) => {
        process.stdin.setEncoding("utf8");
        process.stdin.resume();
        process.stdin.on("data", (chunk) => handler(String(chunk)));
      },
      onResize: (handler) => process.stdout.on("resize", handler),
      setRaw: (on) => process.stdin.isTTY && process.stdin.setRawMode(on),
      // Coalesce a burst of child output into one repaint per frame; a busy boot
      // otherwise redraws the screen once per log line.
      schedule: (fn) => setTimeout(fn, 16),
    });
  },
};

/** The real terminal writer, captured at import — before `captureProcessOutput`
 * below replaces `process.stdout.write`. The console paints through this rather
 * than through the live `process.stdout`, which would otherwise feed every frame
 * back into the log buffer it just rendered and leave the screen frozen on the
 * first paint. Holding the reference makes that independent of call ordering. */
const writeToTerminal = process.stdout.write.bind(process.stdout);

/** Route this process's own output into the log pane. The driver logs through
 * stderr and the boot line through console.log; both would otherwise paint over
 * the frame. `console.*` is patched separately because Bun's console writes
 * straight to the fd rather than through `process.stdout.write`, so patching the
 * stream alone silently misses it. Nothing restores the originals: the only exit
 * path tears the process down, and `tui.stop()` has already left the alternate
 * screen by then. */
export function captureProcessOutput(tui: Tui): void {
  for (const stream of [process.stdout, process.stderr]) {
    stream.write = ((chunk: unknown) => {
      tui.write(typeof chunk === "string" ? chunk : String(chunk));
      return true;
    }) as typeof stream.write;
  }
  const toLine = (args: unknown[]) => `${args.map((a) => String(a)).join(" ")}\n`;
  console.log = (...args: unknown[]) => tui.write(toLine(args));
  console.error = (...args: unknown[]) => tui.write(toLine(args));
  console.warn = (...args: unknown[]) => tui.write(toLine(args));
}

/** Forward a piped child stream into the log pane. Best-effort: a child dying
 * mid-read ends the pump rather than taking the dev task down with it. */
function pumpIntoTui(stream: SpawnedChild["stdout"], tui: Tui): void {
  if (!stream || typeof stream === "number") return;
  void (async () => {
    const decoder = new TextDecoder();
    try {
      for await (const bytes of stream as ReadableStream<Uint8Array>) {
        tui.write(decoder.decode(bytes, { stream: true }));
      }
    } catch {
      // child gone; its exit is handled by the supervision
    }
  })();
}

/** Boot the dev stack and block until Vite exits (or a signal tears it down).
 * Never returns on the signal path — the handler calls process.exit — and calls
 * process.exit with Vite's code on the normal path. */
export async function runDev(opts: RunDevOptions, deps: DevDeps = realDevDeps): Promise<never> {
  // Dev reads its own config.dev.toml, never the user's production config.toml
  // (EXC-781). --fresh instead boots from built-in defaults by pointing at a path
  // that does not exist (loadSettings falls back to DEFAULTS on a missing file),
  // and CARET_FRESH tells the UI to reset its saved preferences. The daemon child
  // inherits the same choice through childEnv below.
  const configFilePath = opts.fresh
    ? join(tmpdir(), "caret-dev-fresh-no-config.toml")
    : devConfigFile();
  const settings = deps.loadSettings(configFilePath);

  // Port mode (EXC-461): ephemeral by default (OS-assigned, discovered from the
  // daemon's lock, so any number of sessions coexist); a fixed port pins it
  // (dev-env.ts rejects the production default). Precedence: --port > CARET_DEV_PORT
  // > [dev].port.
  const rawPort = opts.port ?? devPort(settings);
  const portMode = resolvePortMode(rawPort === undefined ? undefined : String(rawPort));

  // State dir: ephemeral mktemp by default (isolated + wiped on exit); a
  // persistent dir is reused and kept. Precedence: --state-dir > CARET_DEV_STATE_DIR
  // > [dev].state_dir; --persist keeps an otherwise-ephemeral dir too.
  const plan = planStateDir(opts.stateDir ?? devStateDir(settings), opts.persist);
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

  const childEnv = childEnvFor(stateDirPath, portMode, {
    configFile: configFilePath,
    fresh: opts.fresh,
  });

  // A persistent dir may hold a stale lock from a crashed run; the boot writes
  // its own, so clear it first or port discovery would read the stale port.
  const worldDir = join(stateDirPath, "caret");
  const daemonLogDir = join(worldDir, "logs");
  const daemonLogPath = join(daemonLogDir, "daemon.log");
  const lockFile = join(worldDir, "daemon.lock");
  rmSync(lockFile, { force: true });

  const children: SpawnedChild[] = [];
  // The driver's key handler, wired once the driver starts. The terminal UI owns
  // the keyboard from boot — before the driver exists — so presses route through
  // this hole and are dropped until the driver fills it.
  let onDriverKey: ((key: string) => void) | null = null;
  const tui = deps.startTui({
    title: "caret dev",
    shortcuts: [
      { key: "n", label: "new plan" },
      { key: "r", label: "revise last plan" },
      { key: "↑ ↓", label: "scroll" },
      { key: "PgUp/Dn", label: "scroll a page" },
      { key: "G", label: "follow live" },
      { key: "q", label: "quit" },
    ],
    onInject: (key) => onDriverKey?.(key),
    onQuit: () => {
      cleanup();
      deps.exit(0);
    },
  });
  // Reap the children and drop the ephemeral state dir, so a teardown never
  // leaves an orphan holding the dev port or stale reviews (AC6). Restoring the
  // terminal is first: a cleanup that killed the children but left the alternate
  // screen up would hand back an unusable shell.
  const killChildren = makeCleanup(children, {
    stateDirPath,
    wipeOnExit,
    rm: (dir) => rmSync(dir, { recursive: true, force: true }),
  });
  const cleanup = () => {
    tui?.stop();
    killChildren();
  };
  deps.installCleanupHandlers(cleanup);
  // With the screen taken over, this process's own writes have to be captured
  // too — the driver logs through stderr and boot logs through stdout, and both
  // would otherwise scribble over the frame.
  if (tui) captureProcessOutput(tui);

  try {
    // Daemon: stock daemon from source (so edits are live without a rebuild). It
    // writes its NDJSON to logs/daemon.log, a path it owns so it can rotate it
    // (EXC-1068), so the human-readable render tails that file into pino-pretty
    // (a devDependency, never bundled) rather than reading a stderr pipe. Its
    // raw stderr inherits the terminal instead: dev has no spawnDaemon to
    // redirect it into daemon-stderr.log, so an un-inherited crash trace would
    // vanish. pino-pretty's own stdout goes to our stderr (fd 2) so it never
    // pollutes the task's stdout.
    //
    // The file is created before the tail because BSD `tail -F` exits on a
    // missing path, and the daemon may not have logged yet. `-F` follows a
    // truncation, so the render survives a rotation.
    mkdirSync(daemonLogDir, { recursive: true, mode: 0o700 });
    closeSync(openSync(daemonLogPath, "a", 0o600));
    const daemon = deps.spawn(daemonCommand(portMode), {
      stdout: tui ? "pipe" : "inherit",
      stderr: tui ? "pipe" : "inherit",
      env: childEnv,
    });
    children.push(daemon);
    if (tui) {
      pumpIntoTui(daemon.stdout, tui);
      pumpIntoTui(daemon.stderr, tui);
    }
    const tail = deps.spawn(["tail", "-n", "+1", "-F", daemonLogPath], {
      stdout: "pipe",
      stderr: "ignore",
    });
    children.push(tail);
    const pretty = deps.spawn(
      ["bunx", "pino-pretty", "--colorize", "--translateTime", "UTC:yyyy-mm-dd'T'HH:MM:ss.l'Z'"],
      tui
        ? { stdin: tail.stdout, stdout: "pipe", stderr: "pipe" }
        : { stdin: tail.stdout, stdout: 2, stderr: "inherit" },
    );
    children.push(pretty);
    if (tui) {
      pumpIntoTui(pretty.stdout, tui);
      pumpIntoTui(pretty.stderr, tui);
    }

    // Discover the daemon's bound port from its own-world lock (written after a
    // successful bind). Bounded wait, loud failure — including a daemon that died
    // on boot (DAEMON_DIED) or that grabbed the production default port.
    const port = await deps.discoverPort({
      readPort: () => readDevLockPort(lockFile, worldDir),
      daemonAlive: () => isPidAlive(daemon.pid),
    });
    childEnv.CARET_PORT = String(port);
    console.log(
      `caret dev: port=${port} state=${stateDirPath} config=${configFilePath} fresh=${opts.fresh ? 1 : 0} persistent=${persistState ? 1 : 0}`,
    );

    // Driver: seeds the dev fixtures and plays the agent's protocol side, in this
    // same process. Its options arrive already parsed (commander), so there is no
    // subprocess and no argv re-parse; the loop never resolves and dies with this
    // process on teardown, so it is not among the reaped children. Because it runs
    // here rather than in a child with `env: childEnv`, point this process's
    // XDG_STATE_HOME at the isolated dev state dir: the driver's hook-side logging
    // (runReview → caret.log, read lazily off process.env) would otherwise write
    // to the real ~/.local/state/caret instead of the dev dir. Safe now — the
    // daemon and pino-pretty are already spawned (env snapshotted) and Vite below
    // is spawned with an explicit `env: childEnv`, so this reaches only the driver.
    process.env.XDG_STATE_HOME = stateDirPath;
    // Port only: a state-dir path is far wider than the rail and would truncate
    // to nothing useful. The boot line carries it in full, into the log pane.
    tui?.setStatus([`port ${port}`]);
    deps.runDriver({
      base: `http://127.0.0.1:${port}`,
      numVersions: opts.numVersions,
      notify: opts.notify,
      settings,
      // The terminal UI holds raw stdin, so it forwards keys rather than the
      // driver reading them itself; without it there is no keyboard to own.
      onKey: tui ? (handler) => (onDriverKey = handler) : undefined,
    });

    // Vite last; block on it (like the bash `wait "$vite_pid"`) so the process
    // stays alive until Vite exits, and a teardown signal reaches the handlers
    // above even if it hits this PID alone rather than the whole group.
    const vite = deps.spawn(["bunx", "vite"], {
      cwd: "ui",
      stdout: tui ? "pipe" : "inherit",
      stderr: tui ? "pipe" : "inherit",
      // Piping costs Vite its TTY, and it drops colour when it cannot see one;
      // the pane renders SGR fine, so ask for colour back explicitly.
      env: tui ? { ...childEnv, FORCE_COLOR: "1" } : childEnv,
    });
    children.push(vite);
    if (tui) {
      pumpIntoTui(vite.stdout, tui);
      pumpIntoTui(vite.stderr, tui);
    }

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
