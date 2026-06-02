// Integration: exercise the REAL httpHealth + ensureDaemon against a live
// server (no mocked health). The real cross-process spawn race is covered by
// the manual end-to-end test (two Claude instances).

import { afterEach, expect, test } from "bun:test";
import { ensureDaemon, httpHealth } from "../src/cli.ts";
import { createServer } from "../src/daemon.ts";
import { createStore } from "../src/store.ts";

const servers: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop();
});

test("httpHealth reports the caret identity from a live daemon", async () => {
  const srv = createServer({ store: createStore("/tmp/caret-it-x"), port: 0 });
  servers.push(srv);
  const h = await httpHealth(`http://localhost:${srv.port}`);
  expect(h?.service).toBe("caret");
});

test("concurrent ensureDaemon callers both connect to a live daemon", async () => {
  const srv = createServer({ store: createStore("/tmp/caret-it-y"), port: 0 });
  servers.push(srv);
  const baseUrl = `http://localhost:${srv.port}`;
  let spawns = 0;
  const deps = {
    baseUrl,
    health: httpHealth,
    spawn: () => spawns++,
    backoff: async () => {},
    maxAttempts: 5,
  };
  const [a, b] = await Promise.all([ensureDaemon(deps), ensureDaemon(deps)]);
  expect(a).toBe(baseUrl);
  expect(b).toBe(baseUrl);
  expect(spawns).toBe(0); // already up — no spawn needed
});

test("ensureDaemon fails fast against a non-caret server on the port", async () => {
  const foreign = Bun.serve({
    port: 0,
    fetch: () => Response.json({ service: "not-caret" }),
  });
  try {
    await expect(
      ensureDaemon({
        baseUrl: `http://localhost:${foreign.port}`,
        health: httpHealth,
        spawn: () => {},
        backoff: async () => {},
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/CARET_PORT/);
  } finally {
    foreign.stop();
  }
});
