// doctor's OpenCode checks: which of `opencode-host` and `opencode-caret-version` run
// for a given config, and that the host version reaches the cache read.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withEnv } from "@test/support/env.ts";
import { readOpencodeChecks } from "@/adapters/opencode/checks.ts";
import type { VersionTriple } from "@/lib/semver.ts";

const PKG = "@macintacos/caret";

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
    opencodeVersion: () => {
      asked = true;
      return [2, 0, 18];
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
    opencodeVersion: () => [2, 0, 18],
  });
  expect(checks.map((c) => c.id)).toEqual(["opencode-host"]);
});

test("a package entry gets both checks, the version read from the host's cache layout", async () => {
  const v2: VersionTriple = [2, 0, 18];
  const gen = join(tmp, "opencode", "npm", `${PKG}@latest`, "1");
  mkdirSync(join(gen, "node_modules", PKG), { recursive: true });
  writeFileSync(
    join(gen, "node_modules", PKG, "package.json"),
    JSON.stringify({ version: "0.8.0" }),
  );
  const checks = await withEnv({ XDG_CACHE_HOME: tmp }, () =>
    readOpencodeChecks({
      configFiles: [configWith({ plugin: [PKG] })],
      opencodeVersion: () => v2,
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
    opencodeVersion: () => [2, 0, 18],
    published: async () => "0.9.0",
  });
  expect(checks.map((c) => c.id)).toEqual(["opencode-host", "opencode-caret-version"]);
});
