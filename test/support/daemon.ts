// Boot a real caret daemon in-process (no browser, no spawned process) for the
// bun-test suite, with a small typed HTTP client over the public API — the same
// POST/GET surface a real hook and the browser UI use. The client is
// tool-agnostic: it speaks the daemon's wire protocol, never Claude's hook
// stdin shaping (that lives in scripts/tasks/dev/driver.ts).
//
// The e2e suite has its own daemon launcher (test/e2e/support/daemon-entry.ts): it
// runs under the Playwright/node runner, binds an OS-assigned port for parallel
// workers, and serves the built ui/dist/ tree (index plus its hashed assets) —
// a hermetic createServer-with-explicit-opts posture this module does not replace.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type CaretServer, type CreateServerOptions, createServer } from "@/daemon/server.ts";
import { createStore, type Store } from "@/review/store.ts";

/** Options forwarded to createServer, minus the store (bootDaemon owns it). */
export type BootOptions = Omit<CreateServerOptions, "store">;

export interface TestDaemon {
  /** Base URL of this daemon (http://localhost:<os-assigned-port>). */
  url: string;
  /** The OS-assigned port the daemon bound. */
  port: number;
  /** The in-process store backing this daemon, for white-box assertions. */
  store: Store;
  /** Stop the server (removes the lock when one is managed). */
  stop(): void;
  /**
   * Seed a review through POST /api/reviews. Defaults match a minimal pending
   * review; pass overrides to vary sessionId/cwd/plan. Returns the new id.
   */
  seed(body?: Record<string, unknown>): Promise<string>;
  /** GET /api/reviews/:id — the parsed ClientReview (throws on a non-OK status). */
  getReview(id: string): Promise<Record<string, unknown>>;
  /** GET /api/reviews — the pending list. */
  listReviews(): Promise<Array<Record<string, unknown>>>;
  /** POST /api/reviews/:id/resolve with the given decision body. */
  resolve(id: string, body: Record<string, unknown>): Promise<Response>;
  /** PUT /api/reviews/:id/draft with the given draft body. */
  draft(id: string, body: Record<string, unknown>): Promise<Response>;
  /** POST /api/reviews/:id/expire. */
  expire(id: string): Promise<Response>;
}

const SEED_DEFAULTS = { sessionId: "S", cwd: "/tmp/p", plan: "# Title\n\nbody" };

/**
 * Boot a daemon over a store rooted at `dir`, on an OS-assigned port. `opts`
 * forwards the createServer knobs (idleMs/heartbeatMs/lockPath/buildId/commit/
 * stateDir/instanceId/prefsPath/log/routePlan/onShutdown); idleMs defaults high
 * so the daemon never idle-shuts-down mid-test, and onShutdown to a no-op.
 */
export async function bootDaemon(dir: string, opts: BootOptions = {}): Promise<TestDaemon> {
  // The store keeps its own no-op logger: the daemon's lifecycle logger (opts.log)
  // is for request/route records, and routing store emits through it would add
  // noise the recording-log assertions don't expect.
  const store = createStore(dir);
  await store.rehydrate();
  const srv: CaretServer = createServer({
    store,
    port: 0,
    idleMs: opts.idleMs ?? 1_000_000,
    onShutdown: opts.onShutdown ?? (() => {}),
    ...opts,
  });
  const url = `http://localhost:${srv.port}`;
  const json = { "Content-Type": "application/json" };

  return {
    url,
    port: srv.port,
    store,
    stop: () => srv.stop(),
    async seed(body = {}) {
      const res = await fetch(`${url}/api/reviews`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ ...SEED_DEFAULTS, ...body }),
      });
      return ((await res.json()) as { id: string }).id;
    },
    async getReview(id) {
      const res = await fetch(`${url}/api/reviews/${id}`);
      if (!res.ok) throw new Error(`GET /api/reviews/${id} → ${res.status}`);
      return (await res.json()) as Record<string, unknown>;
    },
    async listReviews() {
      const res = await fetch(`${url}/api/reviews`);
      if (!res.ok) throw new Error(`GET /api/reviews → ${res.status}`);
      return (await res.json()) as Array<Record<string, unknown>>;
    },
    resolve(id, body) {
      return fetch(`${url}/api/reviews/${id}/resolve`, {
        method: "POST",
        headers: json,
        body: JSON.stringify(body),
      });
    },
    draft(id, body) {
      return fetch(`${url}/api/reviews/${id}/draft`, {
        method: "PUT",
        headers: json,
        body: JSON.stringify(body),
      });
    },
    expire(id) {
      return fetch(`${url}/api/reviews/${id}/expire`, { method: "POST" });
    },
  };
}

export interface DaemonTree {
  /** The daemon's own state dir. */
  store: string;
  /** The review's project dir, for a test to populate with real files. */
  cwd: string;
  /** The daemon booted over `store`. */
  d: TestDaemon;
}

/**
 * Create a throwaway state dir and project cwd, and boot a daemon over the
 * state dir. `prefix` names the temp dirs for diagnosability (e.g. "dir").
 */
export async function bootDaemonTree(prefix: string): Promise<DaemonTree> {
  const store = mkdtempSync(join(tmpdir(), `caret-${prefix}-store-`));
  const cwd = mkdtempSync(join(tmpdir(), `caret-${prefix}-cwd-`));
  const d = await bootDaemon(store);
  return { store, cwd, d };
}

/** Stop the daemon and remove both temp dirs from a `bootDaemonTree` fixture. */
export function teardownDaemonTree({ store, cwd, d }: DaemonTree): void {
  d.stop();
  rmSync(store, { recursive: true, force: true });
  rmSync(cwd, { recursive: true, force: true });
}
