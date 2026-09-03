// Guards the globals setup.ts restores: importing it registers happy-dom's
// DOM globals via GlobalRegistrator, which clobbers Bun natives the backend
// suite needs, and both suites share this one bun-test process. Each case below
// reproduces one leak deterministically in a single file — register, then
// exercise the native — so none of them depends on cross-file ordering.
import "./setup.ts";
import { afterAll, describe, expect, test } from "bun:test";
import { setMaxListeners } from "node:events";

const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
afterAll(() => server.stop(true));

describe("setup.ts happy-dom registration", () => {
  test("registers happy-dom's DOM globals", () => {
    expect((globalThis as { document?: unknown }).document).toBeDefined();
  });

  test("leaves native fetch able to reach a real loopback socket", async () => {
    const res = await fetch(`http://localhost:${server.port}/`);
    expect(await res.text()).toBe("ok");
  });

  // EXC-1080, the same leak one class further along. A happy-dom AbortSignal is
  // not an EventTarget `node:events` will accept, and listr2 hands its own
  // controller's signal to setMaxListeners from the Listr constructor, so every
  // scripts/preflight.ts case throws ERR_INVALID_ARG_TYPE once a UI file has
  // registered. One assertion per restored global: the controller is what keeps
  // node:events able to take a signal built anywhere in this shared process, and
  // AbortSignal is what keeps that signal an instance of the global it names —
  // restore the controller alone and `instanceof` silently goes false.
  test("leaves native AbortController's signal acceptable to node:events", () => {
    expect(() => setMaxListeners(0, new AbortController().signal)).not.toThrow();
    expect(new AbortController().signal).toBeInstanceOf(AbortSignal);
  });
});
