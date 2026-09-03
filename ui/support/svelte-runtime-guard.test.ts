// Pins the bare-invocation guard: the predicate distinguishes svelte's client
// build from its server stub, the assert throws the actionable message on the
// server build, and the live resolution under the canonical `--conditions
// browser` invocation is the client runtime. Imports only the guard module (no
// happy-dom), so it never registers DOM globals that would leak across the
// single bun-test process into the daemon suite's real fetch.
import { describe, expect, test } from "bun:test";

import {
  assertSvelteClientRuntime,
  BARE_INVOCATION_MESSAGE,
  isSvelteClientRuntime,
} from "./svelte-runtime-guard.ts";

const CLIENT_URL = "file:///x/node_modules/svelte/src/index-client.js";
const SERVER_URL = "file:///x/node_modules/svelte/src/index-server.js";

describe("svelte-runtime-guard", () => {
  test("isSvelteClientRuntime accepts the client build, rejects the server stub", () => {
    expect(isSvelteClientRuntime(CLIENT_URL)).toBe(true);
    expect(isSvelteClientRuntime(SERVER_URL)).toBe(false);
  });

  test("assertSvelteClientRuntime throws the actionable message on the server build", () => {
    expect(() => assertSvelteClientRuntime(SERVER_URL)).toThrow(BARE_INVOCATION_MESSAGE);
    expect(() => assertSvelteClientRuntime(CLIENT_URL)).not.toThrow();
  });

  test("the message names the fix", () => {
    expect(BARE_INVOCATION_MESSAGE).toContain("--conditions browser");
    expect(BARE_INVOCATION_MESSAGE).toContain("mise run test");
  });

  test("the live resolution under the test command is svelte's client runtime", () => {
    // This suite runs under `--conditions browser` (mise test task /
    // package.json `test`); a bare `bun test` would resolve the server build.
    expect(isSvelteClientRuntime(import.meta.resolve("svelte"))).toBe(true);
  });
});
