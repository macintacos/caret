#!/usr/bin/env bun
// Non-supervisory logic for the `mise run dev` task: the port-mode decision,
// the daemon-lock port discovery (with the dev-specific stateDir guard), and a
// constants bridge — so the bash task can stay thin process-supervision glue
// and never embed a TS constant or a hand-rolled lock parser.
//
// CLI surface the task drives (one line of stdout per success):
//   dev-env.ts never-idle-ms              → "<NEVER_IDLE_MS>"
//   dev-env.ts port-mode <CARET_DEV_PORT> → "ephemeral" | "fixed <port>"
//   dev-env.ts discover-port <lock> <world> <daemonPid> → "<port>"
// Any error exits non-zero with a message on stderr; the task aborts loudly.

import type { DaemonLock } from "../../src/build-id.ts";
import { DEFAULT_PORT, NEVER_IDLE_MS } from "../../src/constants.ts";
import { isPidAlive } from "../../src/daemon-lifecycle.ts";
import { readJsonFileSync } from "../../src/json-file.ts";

/** Decide how the dev daemon binds its port from CARET_DEV_PORT. Unset →
 * ephemeral (an OS-assigned port, discovered from the lock). Set → that fixed
 * port, but never the production default: a CARET_DEV_PORT of 42718 would squat
 * an installed caret. */
export type PortMode = { kind: "ephemeral" } | { kind: "fixed"; port: number };

export function resolvePortMode(raw: string | undefined): PortMode {
  if (raw === undefined || raw === "") return { kind: "ephemeral" };
  if (raw === String(DEFAULT_PORT)) {
    throw new Error(`CARET_DEV_PORT must differ from the production default (${DEFAULT_PORT})`);
  }
  return { kind: "fixed", port: Number(raw) };
}

/** Read the daemon lock at `lockPath` and return its port only if the lock
 * names OUR world (its stateDir is `expectedStateDir`) and carries a usable
 * port. Null on anything else — missing, unreadable, foreign stateDir, or a
 * non-positive port — so a dev session can never silently attach to a foreign
 * daemon's lock (e.g. two sessions pointed at one persistent CARET_DEV_STATE_DIR).
 *
 * This is the canonical lock shape (DaemonLock, read via readJsonFileSync)
 * plus the dev-only stateDir + positive-port guards — one definition of "valid
 * dev lock", not a second parser crammed into a shell string. */
export function readDevLockPort(lockPath: string, expectedStateDir: string): number | null {
  const lock = readJsonFileSync(lockPath) as DaemonLock | null;
  if (!lock || typeof lock.port !== "number") return null;
  if (lock.stateDir !== expectedStateDir) return null;
  if (!Number.isInteger(lock.port) || lock.port <= 0) return null;
  return lock.port;
}

export interface DiscoverPortDeps {
  /** Read the own-world lock port, or null if not yet usable. */
  readPort: () => number | null;
  /** Is the daemon process still alive? A dead daemon means the lock will
   * never appear — abort rather than spin out the whole budget. */
  daemonAlive: () => boolean;
  /** Injectable for tests; defaults to Bun.sleep. */
  sleep?: (ms: number) => Promise<void>;
  attempts?: number;
  intervalMs?: number;
}

/** Poll for the daemon's bound port: it writes its lock after a successful
 * bind, so retry the own-world read until the port appears. Bounded, loud
 * failure — including the special case of a daemon that died on boot before
 * writing its lock (DAEMON_DIED). An OS-assigned ephemeral port can be the
 * production default on Linux (its ephemeral range includes 42718); refuse it
 * so a dev daemon never squats the installed caret (PRODUCTION_DEFAULT_PORT). */
export const DAEMON_DIED = "daemon exited before writing its lock";
export const PRODUCTION_DEFAULT_PORT = "OS assigned the production default port";
export const NO_USABLE_LOCK = "no usable lock (missing, foreign, or bad port)";

export async function discoverPort(deps: DiscoverPortDeps): Promise<number> {
  const attempts = deps.attempts ?? 100;
  const intervalMs = deps.intervalMs ?? 100;
  const sleep = deps.sleep ?? Bun.sleep;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const port = deps.readPort();
    if (port !== null) {
      if (port === DEFAULT_PORT) throw new Error(PRODUCTION_DEFAULT_PORT);
      return port;
    }
    if (!deps.daemonAlive()) throw new Error(DAEMON_DIED);
    await sleep(intervalMs);
  }
  throw new Error(NO_USABLE_LOCK);
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  if (cmd === "never-idle-ms") {
    process.stdout.write(`${NEVER_IDLE_MS}\n`);
    return;
  }
  if (cmd === "port-mode") {
    const mode = resolvePortMode(rest[0]);
    process.stdout.write(mode.kind === "ephemeral" ? "ephemeral\n" : `fixed ${mode.port}\n`);
    return;
  }
  if (cmd === "discover-port") {
    const [lockPath, world, daemonPidRaw] = rest;
    if (!lockPath || !world || !daemonPidRaw) {
      throw new Error("discover-port requires <lockPath> <world> <daemonPid>");
    }
    const daemonPid = Number(daemonPidRaw);
    const port = await discoverPort({
      readPort: () => readDevLockPort(lockPath, world),
      daemonAlive: () => isPidAlive(daemonPid),
    });
    process.stdout.write(`${port}\n`);
    return;
  }
  throw new Error(`unknown command: ${cmd ?? "(none)"}`);
}

if (import.meta.main) {
  main(Bun.argv.slice(2)).catch((err) => {
    process.stderr.write(`caret dev: ${err instanceof Error ? err.message : err}\n`);
    process.exit(1);
  });
}
