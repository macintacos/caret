import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withEnv } from "@test/support/env.ts";
import { hostConfigFilenames } from "@/adapters/opencode/host.ts";
import {
  existingConfigFiles,
  existingOpencodeCachePackageDirs,
  liveGenerationDir,
  opencodeCachePackageDir,
  opencodeNpmCacheDir,
  opencodeNpmLocalCacheDir,
  resolveConfigFile,
} from "@/adapters/opencode/paths.ts";
import type { VersionTriple } from "@/lib/semver.ts";

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-oc-paths-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const packages = () => join(tmp, "opencode", "packages");
const npm = () => join(tmp, "opencode", "npm");

test("a plugin entry maps to its cache dir verbatim, pin and all", () => {
  withEnv({ XDG_CACHE_HOME: tmp }, () => {
    expect(opencodeCachePackageDir("@macintacos/caret")).toBe(
      join(packages(), "@macintacos/caret"),
    );
    expect(opencodeCachePackageDir("@macintacos/caret@latest")).toBe(
      join(packages(), "@macintacos/caret@latest"),
    );
    expect(opencodeCachePackageDir("@macintacos/caret@1.0.2")).toBe(
      join(packages(), "@macintacos/caret@1.0.2"),
    );
  });
});

test("caret's cache dirs are the bare dir and its pinned siblings, never a same-prefix package", () => {
  for (const name of ["caret", "caret@latest", "caret@0.7.3", "caret-tools"]) {
    mkdirSync(join(packages(), "@macintacos", name), { recursive: true });
  }
  withEnv({ XDG_CACHE_HOME: tmp }, () => {
    expect(existingOpencodeCachePackageDirs().sort()).toEqual(
      ["caret", "caret@0.7.3", "caret@latest"].map((n) => join(packages(), "@macintacos", n)),
    );
  });
});

test("v2's npm cache dir is <pkg>@<version>, a bare entry keyed @latest", () => {
  withEnv({ XDG_CACHE_HOME: tmp }, () => {
    expect(opencodeNpmCacheDir("@macintacos/caret", null)).toBe(
      join(npm(), "@macintacos/caret@latest"),
    );
    expect(opencodeNpmCacheDir("@macintacos/caret", "0.8.1")).toBe(
      join(npm(), "@macintacos/caret@0.8.1"),
    );
  });
});

test("v2 keys a file: entry verbatim under npm/", () => {
  withEnv({ XDG_CACHE_HOME: tmp }, () => {
    expect(opencodeNpmLocalCacheDir("file:/Users/j/caret")).toBe(
      join(npm(), "file:/Users/j/caret"),
    );
  });
});

test("the live generation is the numerically largest all-digit child", () => {
  for (const name of ["2", "10", "9", "tmp", "3a"])
    mkdirSync(join(tmp, "g", name), { recursive: true });
  expect(liveGenerationDir(join(tmp, "g"))).toBe(join(tmp, "g", "10"));
});

test("a dir with no generation, or no dir at all, has no live generation", () => {
  mkdirSync(join(tmp, "g", "tmp"), { recursive: true });
  expect(liveGenerationDir(join(tmp, "g"))).toBeNull();
  expect(liveGenerationDir(join(tmp, "absent"))).toBeNull();
});

test("caret's cache dirs cover v2's npm layout beside v1's packages layout", () => {
  mkdirSync(join(packages(), "@macintacos", "caret"), { recursive: true });
  for (const name of ["caret@latest", "caret@0.8.1", "caret-tools@latest"]) {
    mkdirSync(join(npm(), "@macintacos", name), { recursive: true });
  }
  withEnv({ XDG_CACHE_HOME: tmp }, () => {
    expect(existingOpencodeCachePackageDirs().sort()).toEqual(
      [
        join(npm(), "@macintacos", "caret@0.8.1"),
        join(npm(), "@macintacos", "caret@latest"),
        join(packages(), "@macintacos", "caret"),
      ].sort(),
    );
  });
});

test("existingConfigFiles lists the configs that exist, jsonc first", () => {
  for (const name of ["config.json", "opencode.jsonc"]) writeFileSync(join(tmp, name), "{}");
  expect(existingConfigFiles(tmp)).toEqual([join(tmp, "opencode.jsonc"), join(tmp, "config.json")]);
});

test("existingConfigFiles lists two names for one file once, under the earlier name", () => {
  writeFileSync(join(tmp, "opencode.json"), "{}");
  symlinkSync(join(tmp, "opencode.json"), join(tmp, "config.json"));
  expect(existingConfigFiles(tmp)).toEqual([join(tmp, "opencode.json")]);
});

test("resolveConfigFile on v2 and an unknown host skips a config.json-only dir for a new opencode.json", () => {
  writeFileSync(join(tmp, "config.json"), "{}");
  const hosts: (VersionTriple | null)[] = [[2, 0, 18], null];
  for (const host of hosts) {
    expect(resolveConfigFile(tmp, hostConfigFilenames(host))).toBe(join(tmp, "opencode.json"));
  }
});

test("resolveConfigFile on v1 keeps a config.json-only dir", () => {
  writeFileSync(join(tmp, "config.json"), "{}");
  expect(resolveConfigFile(tmp, hostConfigFilenames([1, 18, 29]))).toBe(join(tmp, "config.json"));
});

test("resolveConfigFile prefers opencode.jsonc when opencode.json is beside it", () => {
  for (const name of ["opencode.json", "opencode.jsonc"]) writeFileSync(join(tmp, name), "{}");
  const hosts: (VersionTriple | null)[] = [[2, 0, 18], [1, 18, 29], null];
  for (const host of hosts) {
    expect(resolveConfigFile(tmp, hostConfigFilenames(host))).toBe(join(tmp, "opencode.jsonc"));
  }
});

test("resolveConfigFile falls back to opencode.json when no config exists", () => {
  expect(resolveConfigFile(tmp, hostConfigFilenames([2, 0, 18]))).toBe(join(tmp, "opencode.json"));
});
