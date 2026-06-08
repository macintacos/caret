// Regression for EXC-554: importing test-setup.ts registers happy-dom's DOM
// globals via GlobalRegistrator, which clobbers global fetch/Response/Request
// with virtual-network versions that can't reach a real loopback socket. The
// backend suite shares this one bun-test process and needs Bun's native fetch,
// so test-setup.ts must restore the native primitives after registering. This
// reproduces the leak deterministically in one file (register, then fetch a
// real server) — independent of cross-file ordering.
import "./test-setup.ts"; // registers happy-dom once per process
import { afterAll, describe, expect, test } from "bun:test";

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
});
