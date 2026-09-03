// Drive the real `caret` CLI as a subprocess — the only way to exercise argv
// routing, process exit codes, and daemon signal/lock handling end to end.
import { existsSync } from "node:fs";
import { join } from "node:path";

import { freePort } from "@test/support/net.ts";

export interface CliRun {
  exitCode: number;
  stdout: string;
}

/** Drain a piped `Bun.spawn`'d process's stdout, stderr, and exit code all
 * concurrently — the shape every subprocess-driving test needs so a child that
 * writes before exiting can't deadlock on a full pipe buffer. */
export async function drainProcess(proc: {
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
}): Promise<{ stdout: string; stderr: string; exit: number }> {
  const [stdout, stderr, exit] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exit };
}

/**
 * Spawn `bun src/cli.ts <args>` as a real subprocess, wait for it to exit, and
 * return its exit code and stdout text.
 */
export async function runCaretCli(
  args: string[],
  opts: { env: Record<string, string | undefined>; stdin?: Uint8Array },
): Promise<CliRun> {
  const proc = Bun.spawn([process.execPath, "src/cli.ts", ...args], {
    env: opts.env,
    stdin: opts.stdin,
    stdout: "pipe",
    stderr: "ignore",
  });
  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  return { exitCode, stdout };
}

/**
 * Spawn a real `caret daemon` subprocess over a throwaway `stateHome` on a
 * free port. `pipeStderr` opts into a piped (rather than discarded) stderr,
 * for a test that needs the child not to block on a full pipe buffer while it
 * reads the daemon's own NDJSON log file for assertions.
 */
export function spawnCaretDaemon(
  stateHome: string,
  extraEnv: Record<string, string> = {},
  pipeStderr = false,
) {
  return Bun.spawn([process.execPath, "src/cli.ts", "daemon"], {
    env: {
      ...process.env,
      CARET_PORT: String(freePort()),
      XDG_STATE_HOME: stateHome,
      CARET_IDLE_MS: "600000", // don't idle-shutdown mid-test
      ...extraEnv,
    },
    stdio: pipeStderr ? ["ignore", "ignore", "pipe"] : ["ignore", "ignore", "ignore"],
  });
}

export interface EphemeralDaemonLock {
  port: number;
  stateDir?: string;
  instanceId?: string;
}

/**
 * Spawn `caret daemon --ephemeral` over a throwaway `stateHome` — an OS-assigned
 * port regardless of CARET_PORT — and wait for its lock file, returning the
 * process and the parsed lock.
 */
export async function spawnEphemeralDaemon(
  stateHome: string,
  extraEnv: Record<string, string> = {},
): Promise<{ proc: ReturnType<typeof Bun.spawn>; lockPath: string; lock: EphemeralDaemonLock }> {
  const lockPath = join(stateHome, "caret", "daemon.lock");
  const proc = Bun.spawn([process.execPath, "src/cli.ts", "daemon", "--ephemeral"], {
    env: {
      ...process.env,
      XDG_STATE_HOME: stateHome,
      CARET_PORT: "", // blank = unset: --ephemeral must not need a port at all
      CARET_IDLE_MS: "600000",
      ...extraEnv,
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  await untilLockWritten(proc, lockPath);
  const lock = JSON.parse(await Bun.file(lockPath).text()) as EphemeralDaemonLock;
  return { proc, lockPath, lock };
}

/**
 * Wait for the daemon to write `lockPath`, polling only while the process is
 * alive: tolerant of an arbitrarily slow boot under a loaded box, but failing
 * fast — with the exit code — the instant the process exits without a lock (a
 * crash, not slowness). The caller's own test timeout backstops a boot that
 * hangs without ever exiting.
 */
export async function untilLockWritten(
  proc: { exited: Promise<number> },
  lockPath: string,
): Promise<void> {
  let exitCode: number | undefined;
  void proc.exited.then((code) => {
    exitCode = code;
  });
  while (!existsSync(lockPath)) {
    if (exitCode !== undefined) {
      throw new Error(`daemon exited (code ${exitCode}) before writing its lock at ${lockPath}`);
    }
    await Bun.sleep(25);
  }
}
