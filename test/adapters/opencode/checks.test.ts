// doctor's OpenCode checks: which of `opencode-host` and `opencode-caret-version` run
// for a given config, and that the host version reaches the cache read.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withEnv } from "@test/support/env.ts";
import { readOpencodeChecks } from "@/adapters/opencode/checks.ts";
import type { OpencodeHost } from "@/adapters/opencode/host.ts";

const PKG = "@macintacos/caret";
const V2 = (): OpencodeHost[] => [{ bin: "/v2/opencode", version: [2, 0, 18] }];

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-oc-checks-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function configWith(cfg: object): string {
  const path = join(tmp, "opencode.json");
  writeFileSync(path, JSON.stringify(cfg));
  return path;
}

test("a config with no caret entry runs no check and never reads the host version", async () => {
  let asked = false;
  const checks = await readOpencodeChecks({
    configFiles: [configWith({ plugin: ["opencode-wakatime"] })],
    opencodeHosts: () => {
      asked = true;
      return V2();
    },
  });
  expect(checks).toEqual([]);
  expect(asked).toBe(false);
});

test("a checkout-only config gets the host check alone", async () => {
  const checkout = join(tmp, "checkout");
  mkdirSync(join(checkout, "opencode"), { recursive: true });
  writeFileSync(join(checkout, "opencode", "caret.plugin.ts"), "");
  const checks = await readOpencodeChecks({
    configFiles: [configWith({ plugins: [`file:${checkout}`] })],
    opencodeHosts: V2,
  });
  expect(checks.map((c) => c.id)).toEqual(["opencode-host"]);
});

test("a tarball-only config gets the host check alone", async () => {
  const checks = await readOpencodeChecks({
    configFiles: [configWith({ plugins: [`file:${tmp}/macintacos-caret-1.2.3.tgz`] })],
    opencodeHosts: V2,
  });
  expect(checks.map((c) => c.id)).toEqual(["opencode-host"]);
});

test("a package entry gets both checks, the version read from the host's cache layout", async () => {
  const gen = join(tmp, "opencode", "npm", `${PKG}@latest`, "1");
  mkdirSync(join(gen, "node_modules", PKG), { recursive: true });
  writeFileSync(
    join(gen, "node_modules", PKG, "package.json"),
    JSON.stringify({ version: "0.8.0" }),
  );
  const checks = await withEnv({ XDG_CACHE_HOME: tmp }, () =>
    readOpencodeChecks({
      configFiles: [configWith({ plugin: [PKG] })],
      opencodeHosts: V2,
      published: async () => "0.9.0",
    }),
  );
  expect(checks.map((c) => c.id)).toEqual(["opencode-host", "opencode-caret-version"]);
  expect(checks[1]?.detail).toContain("0.8.0");
});

test("a caret entry in a later config file is found", async () => {
  const jsonc = join(tmp, "opencode.jsonc");
  writeFileSync(jsonc, JSON.stringify({ plugin: ["opencode-wakatime"] }));
  const checks = await readOpencodeChecks({
    configFiles: [jsonc, configWith({ plugin: [PKG] })],
    opencodeHosts: V2,
    published: async () => "0.9.0",
  });
  expect(checks.map((c) => c.id)).toEqual(["opencode-host", "opencode-caret-version"]);
});

test("v2 with caret only in config.json fails the host check alone", async () => {
  const legacy = join(tmp, "config.json");
  writeFileSync(legacy, JSON.stringify({ plugins: [PKG] }));
  const checks = await readOpencodeChecks({
    configFiles: [legacy],
    opencodeHosts: V2,
    published: async () => "0.9.0",
  });
  expect(checks).toEqual([
    expect.objectContaining({
      id: "opencode-host",
      status: "fail",
      remedy: expect.stringContaining("caret install"),
    }),
  ]);
});

test("v2 with a stale caret in config.json beside opencode.json fails the host check, naming it", async () => {
  const legacy = join(tmp, "config.json");
  writeFileSync(legacy, JSON.stringify({ plugins: [PKG] }));
  const checks = await readOpencodeChecks({
    configFiles: [configWith({ plugins: [PKG] }), legacy],
    opencodeHosts: V2,
    published: async () => "0.9.0",
  });
  expect(checks.map((c) => c.id)).toEqual(["opencode-host", "opencode-caret-version"]);
  expect(checks[0]?.status).toBe("fail");
  expect(checks[0]?.detail).toContain("config.json");
});

const MIXED = (): OpencodeHost[] => [
  { bin: "/v1/opencode", version: [1, 18, 15] },
  { bin: "/v2/opencode", version: [2, 0, 18] },
];

test("v1 beside v2 passes caret in plugin, naming both", async () => {
  const checks = await withEnv({ XDG_CACHE_HOME: tmp }, () =>
    readOpencodeChecks({
      configFiles: [configWith({ plugin: [PKG] })],
      opencodeHosts: MIXED,
      published: async () => "0.9.0",
    }),
  );
  const host = checks.find((c) => c.id === "opencode-host");
  expect(host?.status).toBe("pass");
  expect(host?.detail).toContain("/v1/opencode");
  expect(host?.detail).toContain("/v2/opencode");
});

/** doctor's checks for caret's package entry alone in `config.json`, off the network. */
function checksForLegacyConfig(hosts: OpencodeHost[]) {
  const legacy = join(tmp, "config.json");
  writeFileSync(legacy, JSON.stringify({ plugin: [PKG] }));
  return withEnv({ XDG_CACHE_HOME: tmp }, () =>
    readOpencodeChecks({
      configFiles: [legacy],
      opencodeHosts: () => hosts,
      published: async () => "0.9.0",
    }),
  );
}

test("v1 beside v2 fails caret in config.json as ignored by v2", async () => {
  const host = (await checksForLegacyConfig(MIXED())).find((c) => c.id === "opencode-host");
  expect(host?.status).toBe("fail");
  expect(host?.detail).toContain("config.json, which OpenCode v2 doesn't load");
});

test("v2 beside an unreadable opencode fails caret in config.json as ignored by v2", async () => {
  const checks = await checksForLegacyConfig([...V2(), { bin: "/x/opencode", version: null }]);
  const host = checks.find((c) => c.id === "opencode-host");
  expect(host?.status).toBe("fail");
  expect(host?.detail).toContain("config.json, which OpenCode v2 doesn't load");
});

test("v1 beside an unreadable opencode loads caret from config.json", async () => {
  const checks = await checksForLegacyConfig([
    { bin: "/v1/opencode", version: [1, 18, 15] },
    { bin: "/x/opencode", version: null },
  ]);
  expect(checks.map((c) => [c.id, c.status])).toEqual([
    ["opencode-host", "pass"],
    ["opencode-caret-version", "pass"],
  ]);
});
