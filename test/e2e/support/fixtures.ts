// Shared Playwright fixture: one isolated caret daemon per test.
//
// Per-test (not per-run) because the review list is global daemon state and
// several specs assert exact review sets (switcher = exactly two, deep link,
// poll pickup); there is no DELETE endpoint to clean a shared daemon between
// tests. Boot is ~100-200ms, and OS-assigned ports (daemon-entry.ts) make
// fullyParallel workers collision-free. The fixture runs under the Playwright
// (node) runner; only the daemon child needs Bun, so it is spawned with `bun`
// explicitly.

import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type ChildProcess, spawn } from "node:child_process";
import { expect, type Page, test as base } from "@playwright/test";
import { waitForHealth } from "../../../src/daemon-client.ts";
import type { ClientReview, PlanInput, RouteResult } from "../../../src/types.ts";
import { FIXTURE_PLAN } from "./fixture-plan.ts";

export interface Daemon {
  /** Base URL of this test's daemon (http://127.0.0.1:<os-assigned-port>). */
  url: string;
  /**
   * Seed a review through the public API — the same POST /api/reviews the hook
   * makes, issued harness-side (no Origin header, so the same-origin guard is
   * unaffected). `sessionId` defaults to a fresh UUID per call: the daemon
   * SUPERSEDES a same-session pending review, so two seeds sharing a session
   * would silently collapse to one. Pass an explicit sessionId only to test
   * that threading behavior.
   */
  seed(input?: PlanInput): Promise<string>;
  /** GET /api/reviews/:id — status + parsed body (body undefined on 404). */
  getReview(id: string): Promise<{ status: number; body?: ClientReview }>;
  /** GET /api/reviews — the pending list. */
  listReviews(): Promise<ClientReview[]>;
}

const DAEMON_ENTRY = fileURLToPath(new URL("./daemon-entry.ts", import.meta.url));
const BOOT_TIMEOUT_MS = 15_000;

/** Resolve the one `{"port": N}` line daemon-entry.ts prints to stdout. */
function awaitPortLine(child: ChildProcess, stderr: () => string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl === -1) return;
      try {
        settle(() => resolve((JSON.parse(buf.slice(0, nl)) as { port: number }).port));
      } catch (err) {
        settle(() =>
          reject(
            new Error(
              `caret e2e daemon: bad port line ${JSON.stringify(buf.slice(0, nl))}: ${err}`,
            ),
          ),
        );
      }
    };
    // "close" (not "exit"): exit can fire before the stdout pipe drains, which
    // would spuriously reject even though the port line was already written.
    const onClose = (code: number | null) => {
      settle(() =>
        reject(
          new Error(`caret e2e daemon exited (code ${code}) before reporting a port\n${stderr()}`),
        ),
      );
    };
    // Without this, a spawn failure (e.g. `bun` missing from PATH) is an
    // unhandled "error" event that tears down the whole runner process.
    const onError = (err: Error) => {
      settle(() => reject(new Error(`caret e2e daemon failed to spawn: ${err.message}`)));
    };
    const timer = setTimeout(() => {
      settle(() =>
        reject(
          new Error(`caret e2e daemon: no port line within ${BOOT_TIMEOUT_MS}ms\n${stderr()}`),
        ),
      );
    }, BOOT_TIMEOUT_MS);
    // Settle exactly once, then detach everything so late events are inert.
    const settle = (fn: () => void) => {
      clearTimeout(timer);
      child.stdout?.off("data", onData);
      child.off("close", onClose);
      child.off("error", onError);
      fn();
    };
    child.stdout?.on("data", onData);
    child.on("close", onClose);
    child.on("error", onError);
  });
}

// node-runner sleep: the Playwright fixture runs under node, so reach for
// setTimeout rather than Bun.sleep (the src probe defaults to Bun.sleep).
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const test = base.extend<{ daemon: Daemon }>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright's fixture signature requires the destructuring slot; {} declares "no fixture dependencies"
  daemon: async ({}, use) => {
    // Ephemeral, isolated state: the daemon's reviews/prefs/logs all live under
    // this dir and are wiped at teardown. The user's real state is never touched.
    const stateDir = await mkdtemp(join(tmpdir(), "caret-e2e."));
    // stdin is a live pipe on purpose: the daemon self-reaps when it closes,
    // so a SIGKILL'd runner can't leave an orphan daemon behind.
    const child = spawn("bun", [DAEMON_ENTRY], {
      env: { ...process.env, XDG_STATE_HOME: stateDir },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    child.stderr?.on("data", (c: Buffer) => stderrChunks.push(c));
    const stderr = () => Buffer.concat(stderrChunks).toString();

    try {
      const port = await awaitPortLine(child, stderr);
      const url = `http://127.0.0.1:${port}`;
      // ~15s budget at 50ms intervals (BOOT_TIMEOUT_MS / 50), node-runner sleep.
      await waitForHealth(url, { attempts: BOOT_TIMEOUT_MS / 50, intervalMs: 50, sleep });

      await use({
        url,
        async seed(input?: PlanInput) {
          const res = await fetch(`${url}/api/reviews`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId: randomUUID(),
              cwd: "/tmp/caret-e2e",
              plan: FIXTURE_PLAN,
              ...input,
            }),
          });
          if (!res.ok) throw new Error(`seed failed: POST /api/reviews → ${res.status}`);
          return ((await res.json()) as RouteResult).id;
        },
        async getReview(id: string) {
          const res = await fetch(`${url}/api/reviews/${encodeURIComponent(id)}`);
          if (!res.ok) return { status: res.status };
          return { status: res.status, body: (await res.json()) as ClientReview };
        },
        async listReviews() {
          const res = await fetch(`${url}/api/reviews`);
          if (!res.ok) throw new Error(`GET /api/reviews → ${res.status}`);
          return (await res.json()) as ClientReview[];
        },
      });
    } finally {
      // Reap the daemon before wiping its state dir; escalate if SIGTERM hangs.
      if (child.exitCode === null) {
        const exited = once(child, "exit");
        child.kill("SIGTERM");
        const killTimer = setTimeout(() => child.kill("SIGKILL"), 2_000);
        await exited;
        clearTimeout(killTimer);
      }
      await rm(stateDir, { recursive: true, force: true });
    }
  },

  // Route Playwright's built-in baseURL at this test's daemon so specs can
  // `page.goto("/")` and use relative paths.
  baseURL: async ({ daemon }, use) => {
    await use(daemon.url);
  },
});

/**
 * Wait until the safe-mode grace window that opened at app mount has passed.
 *
 * The guard (ui/src/lib/safeMode.ts) arms a 300ms grace window when App mounts;
 * a keystroke inside it is deliberately swallowed — that's the feature, and
 * safe-mode.e2e.ts asserts it. Specs whose FIRST key press could otherwise race
 * that window call this after asserting the plan is visible (mount done, so the
 * guard armed at or before the captured instant). Not a wall-clock sleep: the
 * condition reads performance.now(), the same clock the guard reads, so it
 * cannot race hydration speed.
 */
export async function waitPastSafeModeGrace(page: Page): Promise<void> {
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => performance.now() > t + 350, t0);
}

export { expect };
