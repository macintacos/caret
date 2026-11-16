// The facts the Swift menubar app shares with the daemon, read from the fixture its Swift
// tests read too, so neither side can drift alone.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootDaemon, type TestDaemon } from "@test/support/daemon.ts";
import { DEFAULT_PORT, VANITY_HOST } from "@/config/constants.ts";
import { isExposed } from "@/daemon/address.ts";

const contract = (await Bun.file(
  join(import.meta.dir, "../../../menubar/Tests/CaretMenubarCoreTests/contract.json"),
).json()) as {
  defaults: { baseURL: string; reviewURL: string };
  loopbackHosts: string[];
  exposedHosts: string[];
  pendingBody: Record<string, number>;
};

let dir: string;
let d: TestDaemon;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-menubar-contract-"));
  d = await bootDaemon(dir, {
    configPath: join(dir, "config.toml"),
    themesDir: join(dir, "themes"),
  });
});

afterAll(async () => {
  d.stop();
  await rm(dir, { recursive: true, force: true });
});

test("the app's default URLs are the daemon's default port and vanity host", () => {
  expect(contract.defaults.baseURL).toBe(`http://127.0.0.1:${DEFAULT_PORT}`);
  expect(contract.defaults.reviewURL).toBe(`http://${VANITY_HOST}:${DEFAULT_PORT}`);
});

test("the app's loopback hosts are exactly the ones the daemon treats as unexposed", () => {
  for (const host of contract.loopbackHosts) expect([host, isExposed(host)]).toEqual([host, false]);
  for (const host of contract.exposedHosts) expect([host, isExposed(host)]).toEqual([host, true]);
});

test("GET /api/pending answers with the body the app decodes", async () => {
  const body = (await (await fetch(`${d.url}/api/pending`)).json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(Object.keys(contract.pendingBody));
});
