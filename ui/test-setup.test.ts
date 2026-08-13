// Regression for EXC-554: importing test-setup.ts registers happy-dom's DOM
// globals via GlobalRegistrator, which clobbers global fetch/Response/Request
// with virtual-network versions that can't reach a real loopback socket. The
// backend suite shares this one bun-test process and needs Bun's native fetch,
// so test-setup.ts must restore the native primitives after registering. This
// reproduces the leak deterministically in one file (register, then fetch a
// real server) — independent of cross-file ordering.
import "./test-setup.ts"; // registers happy-dom once per process
import { afterAll, describe, expect, test } from "bun:test";
import { setMaxListeners } from "node:events";

const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
afterAll(() => server.stop(true));

describe("test-setup happy-dom registration", () => {
  test("registers happy-dom's DOM globals", () => {
    expect((globalThis as { document?: unknown }).document).toBeDefined();
  });

  test("leaves native fetch able to reach a real loopback socket", async () => {
    const res = await fetch(`http://localhost:${server.port}/`);
    expect(await res.text()).toBe("ok");
  });

  // Regression for EXC-1080, the same leak one class further along: happy-dom's
  // AbortController is not one `node:events` will accept, and listr2 11 hands its
  // own controller's signal to setMaxListeners from the Listr constructor. Every
  // scripts/preflight.ts case therefore threw ERR_INVALID_ARG_TYPE the moment any
  // UI file had registered first. Restoring the pair is what keeps node:events
  // able to take a signal built anywhere else in this shared process.
  test("leaves native AbortController's signal acceptable to node:events", () => {
    expect(() => setMaxListeners(0, new AbortController().signal)).not.toThrow();
  });
});
