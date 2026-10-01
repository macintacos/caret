// The OpenCode upgrade module (EXC-909): the pure "is this install stale?" decision,
// the two cache effects it needs — reading OpenCode's cached caret version and
// clearing those cache dirs — and how the verdict is described to a reader, as
// install's line and as doctor's check. The decision is a table over the verdict
// rules; the effects are driven against a temp dir, so nothing here touches the real
// cache. The published version the verdict compares against is read by
// `@/lib/upstream.ts` and covered by its own suite.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withEnv } from "@test/support/env.ts";
import { readCaretEntry } from "@/adapters/opencode/entries.ts";
import { existingOpencodeCachePackageDirs } from "@/adapters/opencode/paths.ts";
import {
  caretCacheDir,
  clearCachedCaret,
  readCachedCaretVersion,
  readUpgradeVerdict,
  type UpgradeVerdict,
  upgradeCheck,
  upgradeVerdict,
  upgradeVerdictLine,
} from "@/adapters/opencode/upgrade.ts";
import type { VersionTriple } from "@/lib/semver.ts";

const PKG = "@macintacos/caret";
const STALE_CACHE = { kind: "stale-cache", cached: "0.2.0", published: "0.8.1" } as const;
const STALE_PIN = {
  kind: "stale-pin",
  entry: `${PKG}@0.7.3`,
  pinned: "0.7.3",
  published: "0.8.1",
} as const;

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-oc-upgrade-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** A cache dir holding the shim manifest OpenCode's reify writes: the requested spec
 * under the package NAME, which may be an exact version or a range. */
function cacheDir(specifier: string, manifest: unknown): string {
  const dir = join(tmp, specifier);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  return dir;
}
const shim = (version: string) => ({ dependencies: { [PKG]: version } });

/** The caret package OpenCode actually installed under a cache dir. */
function installed(dir: string, version: string): void {
  const pkgDir = join(dir, "node_modules", PKG);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: PKG, version }));
}

test("no plugin entry is a fresh install, not a stale one", () => {
  expect(upgradeVerdict({ entry: null, cached: null, published: "0.8.1" })).toEqual({
    kind: "fresh",
  });
});

test("a bare entry with nothing cached is fresh — OpenCode resolves on next start", () => {
  expect(upgradeVerdict({ entry: PKG, cached: null, published: "0.8.1" })).toEqual({
    kind: "fresh",
  });
});

test("a bare entry whose cache is behind is a stale cache", () => {
  expect(upgradeVerdict({ entry: PKG, cached: "0.2.0", published: "0.8.1" })).toEqual({
    kind: "stale-cache",
    cached: "0.2.0",
    published: "0.8.1",
  });
});

test("a bare entry whose cache matches published is current", () => {
  expect(upgradeVerdict({ entry: PKG, cached: "0.8.1", published: "0.8.1" })).toEqual({
    kind: "current",
    version: "0.8.1",
  });
});

test("a cache ahead of published (a local build) is current, never stale", () => {
  expect(upgradeVerdict({ entry: PKG, cached: "0.9.0", published: "0.8.1" })).toEqual({
    kind: "current",
    version: "0.9.0",
  });
});

test("a pinned entry behind published is a stale pin, carrying the verbatim entry", () => {
  expect(upgradeVerdict({ entry: `${PKG}@0.7.3`, cached: "0.7.3", published: "0.8.1" })).toEqual({
    kind: "stale-pin",
    entry: `${PKG}@0.7.3`,
    pinned: "0.7.3",
    published: "0.8.1",
  });
});

test("a pin is judged against published even when the cache disagrees", () => {
  // The pin resolves exactly, so a cache that lags it says nothing about staleness.
  expect(upgradeVerdict({ entry: `${PKG}@0.8.1`, cached: "0.2.0", published: "0.8.1" })).toEqual({
    kind: "current",
    version: "0.8.1",
  });
});

test("a pin at or ahead of published is current", () => {
  expect(upgradeVerdict({ entry: `${PKG}@1.0.0`, cached: null, published: "0.8.1" })).toEqual({
    kind: "current",
    version: "1.0.0",
  });
});

test("a pin with nothing cached still reports stale — the pin is what resolves", () => {
  expect(upgradeVerdict({ entry: `${PKG}@0.7.3`, cached: null, published: "0.8.1" })).toEqual({
    kind: "stale-pin",
    entry: `${PKG}@0.7.3`,
    pinned: "0.7.3",
    published: "0.8.1",
  });
});

test("`@latest` is treated as a bare entry: frozen the same way, unfrozen the same way", () => {
  expect(upgradeVerdict({ entry: `${PKG}@latest`, cached: "0.2.0", published: "0.8.1" })).toEqual({
    kind: "stale-cache",
    cached: "0.2.0",
    published: "0.8.1",
  });
});

test("a `bun link` path entry falls into the cache comparison", () => {
  expect(
    upgradeVerdict({ entry: "/Users/dev/caret", cached: "0.2.0", published: "0.8.1" }),
  ).toEqual({ kind: "stale-cache", cached: "0.2.0", published: "0.8.1" });
});

test("an unreadable published version is unknown, not current", () => {
  const v = upgradeVerdict({ entry: PKG, cached: "0.2.0", published: null });
  expect(v.kind).toBe("unknown");
  expect(v.kind === "unknown" && v.reason.length > 0).toBe(true);
});

test("an unparseable cached version is unknown, not silently current", () => {
  const v = upgradeVerdict({ entry: PKG, cached: "workspace:*", published: "0.8.1" });
  expect(v.kind).toBe("unknown");
  expect(v.kind === "unknown" && v.reason).toContain("workspace:*");
});

// --- the effects: reading the cache, clearing it ---------------------------------

test("the installed caret's version wins over a range in the shim", () => {
  const dir = cacheDir(PKG, shim("^1.1.0"));
  installed(dir, "1.1.3");
  expect(readCachedCaretVersion(dir)).toBe("1.1.3");
});

test("the installed caret's version wins over a differing exact shim", () => {
  const dir = cacheDir(PKG, shim("0.8.1"));
  installed(dir, "0.9.0");
  expect(readCachedCaretVersion(dir)).toBe("0.9.0");
});

test("with nothing installed, an exact shim version is returned", () => {
  expect(readCachedCaretVersion(cacheDir(PKG, shim("0.8.1")))).toBe("0.8.1");
});

test("with nothing installed, a range shim is returned verbatim", () => {
  expect(readCachedCaretVersion(cacheDir(PKG, shim("^1.1.0")))).toBe("^1.1.0");
});

test("an installed manifest without a version falls back to the shim", () => {
  const dir = cacheDir(PKG, shim("0.8.1"));
  const pkgDir = join(dir, "node_modules", PKG);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: PKG }));
  expect(readCachedCaretVersion(dir)).toBe("0.8.1");
});

test("an empty dir, a non-caret shim, or unparseable JSON reads as null", () => {
  const empty = join(tmp, "empty");
  mkdirSync(empty, { recursive: true });
  const other = cacheDir("other", { dependencies: { "opencode-wakatime": "1.0.0" } });
  const broken = join(tmp, "broken");
  mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, "package.json"), "{ not json");
  expect(readCachedCaretVersion(empty)).toBeNull();
  expect(readCachedCaretVersion(other)).toBeNull();
  expect(readCachedCaretVersion(broken)).toBeNull();
});

test("clearing removes every cache dir that existed and reports exactly those", () => {
  const bare = cacheDir(PKG, shim("0.2.0"));
  const pinned = cacheDir(`${PKG}@latest`, shim("0.2.0"));
  const absent = join(tmp, "never-there");
  expect(clearCachedCaret([bare, absent, pinned])).toEqual([bare, pinned]);
  expect(existsSync(bare)).toBe(false);
  expect(existsSync(pinned)).toBe(false);
});

test("clearing nothing is not an error and reports nothing", () => {
  expect(clearCachedCaret([join(tmp, "nope")])).toEqual([]);
  expect(clearCachedCaret([])).toEqual([]);
});

// ---- readUpgradeVerdict: the three reads the verdict is decided over ----

/** An OpenCode config file carrying `entries` in its `plugin` array. */
function configWith(entries: string[]): string {
  const path = join(tmp, "opencode.json");
  writeFileSync(path, JSON.stringify({ plugin: entries }));
  return path;
}

/** The verdict for a config carrying `entries`, against a cache under `tmp`. */
function verdictFor(entries: string[], published: string) {
  return readUpgradeVerdict({
    configFiles: [configWith(entries)],
    cacheDir: (e) => join(tmp, e.spec),
    published: async () => published,
  });
}

test("a pinned config entry is compared against the published version", async () => {
  expect(await verdictFor([`${PKG}@0.8.0`], "0.9.0")).toEqual({
    kind: "stale-pin",
    entry: `${PKG}@0.8.0`,
    pinned: "0.8.0",
    published: "0.9.0",
  });
});

test("a bare config entry is compared against what OpenCode cached", async () => {
  cacheDir(PKG, shim("0.8.0"));
  expect(await verdictFor([PKG], "0.9.0")).toEqual({
    kind: "stale-cache",
    cached: "0.8.0",
    published: "0.9.0",
  });
});

test("a range shim with an installed caret behind npm is a stale cache", async () => {
  installed(cacheDir(PKG, shim("^1.1.0")), "1.1.3");
  expect(await verdictFor([PKG], "1.2.0")).toEqual({
    kind: "stale-cache",
    cached: "1.1.3",
    published: "1.2.0",
  });
});

test("an absent config file reads as no entry at all", async () => {
  expect(
    await readUpgradeVerdict({
      configFiles: [join(tmp, "no-such-config.json")],
      cacheDir: (e) => join(tmp, e.spec),
      published: async () => "0.9.0",
    }),
  ).toEqual({ kind: "fresh" });
});

test("the update check skips a tarball-only config without erroring", async () => {
  expect(await verdictFor([`file:${tmp}/macintacos-caret-1.2.3.tgz`], "0.9.0")).toEqual({
    kind: "fresh",
  });
});

test("a pinned entry reads its own cache dir, not the bare one", async () => {
  cacheDir(PKG, shim("0.8.1"));
  cacheDir(`${PKG}@latest`, shim("0.2.0"));
  expect(await verdictFor([`${PKG}@latest`], "0.8.1")).toEqual(STALE_CACHE);
});

test("an entry whose own cache dir is absent is fresh, whatever its siblings hold", async () => {
  cacheDir(PKG, shim("0.2.0"));
  expect(await verdictFor([`${PKG}@latest`], "0.8.1")).toEqual({ kind: "fresh" });
});

test("a range shim with nothing installed is unknown, naming the range", async () => {
  cacheDir(PKG, shim("^1.1.0"));
  const v = await verdictFor([PKG], "1.2.0");
  expect(v.kind).toBe("unknown");
  expect(v.kind === "unknown" && v.reason).toContain("^1.1.0");
});

// ---- readCaretEntry: the package-form entry the version check reads ----

test("a config naming caret has an entry; one naming another plugin does not", () => {
  expect(readCaretEntry([configWith([`${PKG}@0.8.0`])]) !== null).toBe(true);
  expect(readCaretEntry([configWith([PKG])]) !== null).toBe(true);
  expect(readCaretEntry([configWith(["opencode-wakatime"])]) !== null).toBe(false);
});

test("a --from-local checkout entry is not the package entry the version check reads", () => {
  const checkoutDir = join(tmp, "checkout");
  mkdirSync(join(checkoutDir, "opencode"), { recursive: true });
  writeFileSync(join(checkoutDir, "opencode", "caret.plugin.ts"), "");
  expect(readCaretEntry([configWith([`file:${checkoutDir}`])]) !== null).toBe(false);
});

test("a caret tarball entry is not the package entry the version check reads", () => {
  expect(readCaretEntry([configWith([`file:${tmp}/macintacos-caret-1.2.3.tgz`])]) !== null).toBe(
    false,
  );
});

test("an absent config file carries no entry", () => {
  expect(readCaretEntry([join(tmp, "no-such-config.json")]) !== null).toBe(false);
});

// ---- the verdict's line, and the check doctor renders it as ----

test("every verdict has a line, and only the stale ones name a version gap", () => {
  const lines: Record<UpgradeVerdict["kind"], string> = {
    fresh: upgradeVerdictLine({ kind: "fresh" }),
    current: upgradeVerdictLine({ kind: "current", version: "0.8.1" }),
    "stale-cache": upgradeVerdictLine(STALE_CACHE),
    "stale-pin": upgradeVerdictLine(STALE_PIN),
    unknown: upgradeVerdictLine({ kind: "unknown", reason: "offline" }),
  };
  expect(lines.current).toContain("0.8.1");
  expect(lines["stale-cache"]).toContain("0.2.0");
  expect(lines["stale-pin"]).toContain(`${PKG}@0.7.3`);
  // A line that could not be read must not read as a verdict about a version.
  expect(lines.unknown).not.toContain("0.8.1");
  expect(Object.values(lines).every((l) => l.length > 0)).toBe(true);
});

test("a settled verdict passes", () => {
  expect(upgradeCheck({ kind: "fresh" }).status).toBe("pass");
  expect(upgradeCheck({ kind: "current", version: "0.9.0" }).status).toBe("pass");
});

test("either staleness fails and names the flag that closes it", () => {
  for (const verdict of [STALE_CACHE, STALE_PIN]) {
    const check = upgradeCheck(verdict);
    expect(check.status).toBe("fail");
    expect(check.status === "fail" && check.remedy).toContain("--refresh");
  }
});

test("the two stale kinds get their own remedies — a cache is cleared, a pin is bumped", () => {
  const cache = upgradeCheck(STALE_CACHE);
  const pin = upgradeCheck(STALE_PIN);
  expect(cache.status === "fail" && pin.status === "fail" && cache.remedy).not.toBe(
    pin.status === "fail" ? pin.remedy : "",
  );
});

test("an unreadable verdict is unknown and carries its reason", () => {
  const check = upgradeCheck({ kind: "unknown", reason: "no network" });
  expect(check.status).toBe("unknown");
  expect(check.status === "unknown" && check.reason).toBe("no network");
});

test("the check's detail is the same line install prints, so neither can drift", () => {
  expect(upgradeCheck(STALE_PIN).detail).toBe(upgradeVerdictLine(STALE_PIN));
});

// ---- the cache layout follows the key, and a known v2 host ----

/** A v2 generation dir under `$XDG_CACHE_HOME/opencode/npm/<leaf>/<gen>/` holding an
 * installed caret. */
function v2Generation(leaf: string, gen: string, version: string): string {
  const dir = join(tmp, "opencode", "npm", leaf, gen);
  installed(dir, version);
  return dir;
}

/** v1's `packages/<specifier>/` holding an installed caret. */
function v1Package(specifier: string, version: string): void {
  installed(join(tmp, "opencode", "packages", specifier), version);
}

function v2Verdict(entry: string, key: "plugin" | "plugins", host?: VersionTriple) {
  const path = join(tmp, "opencode.json");
  writeFileSync(path, JSON.stringify({ [key]: [entry] }));
  return withEnv({ XDG_CACHE_HOME: tmp }, () =>
    readUpgradeVerdict({ configFiles: [path], host, published: async () => "0.9.0" }),
  );
}

test("a bare plugins entry reads v2's live @latest generation", async () => {
  v2Generation(`${PKG}@latest`, "1", "0.2.0");
  v2Generation(`${PKG}@latest`, "2", "0.8.0");
  expect(await v2Verdict(PKG, "plugins")).toEqual({
    kind: "stale-cache",
    cached: "0.8.0",
    published: "0.9.0",
  });
});

test("an unparseable plugins pin reads its own v2 dir", async () => {
  v2Generation(`${PKG}@latest`, "3", "0.9.0");
  expect(await v2Verdict(`${PKG}@latest`, "plugins")).toEqual({
    kind: "current",
    version: "0.9.0",
  });
});

test("a plugins entry resolves its v2 generation dir", () => {
  const gen = v2Generation(`${PKG}@0.8.1`, "1", "0.8.1");
  withEnv({ XDG_CACHE_HOME: tmp }, () => {
    expect(caretCacheDir({ key: "plugins", index: 0, spec: `${PKG}@0.8.1` })).toBe(gen);
  });
});

test("a plugin entry reads v2's layout on a v2 host and v1's otherwise", async () => {
  v2Generation(`${PKG}@latest`, "1", "0.8.0");
  v1Package(PKG, "0.2.0");
  expect(await v2Verdict(PKG, "plugin", [2, 0, 18])).toMatchObject({ cached: "0.8.0" });
  expect(await v2Verdict(PKG, "plugin")).toMatchObject({ cached: "0.2.0" });
});

test("a v2 cache dir with no generation reads as nothing cached", async () => {
  mkdirSync(join(tmp, "opencode", "npm", `${PKG}@latest`), { recursive: true });
  expect(await v2Verdict(PKG, "plugins")).toEqual({ kind: "fresh" });
});

test("a plugins entry counts as caret's package entry", () => {
  const path = join(tmp, "opencode.json");
  writeFileSync(path, JSON.stringify({ plugins: [{ package: PKG }] }));
  expect(readCaretEntry([path]) !== null).toBe(true);
});

test("clearing removes a whole v2 npm dir, every generation with it", () => {
  v2Generation(`${PKG}@latest`, "1", "0.2.0");
  v2Generation(`${PKG}@latest`, "2", "0.8.0");
  const dir = join(tmp, "opencode", "npm", `${PKG}@latest`);
  const dirs = withEnv({ XDG_CACHE_HOME: tmp }, () => existingOpencodeCachePackageDirs());
  expect(clearCachedCaret(dirs)).toEqual([dir]);
  expect(existsSync(dir)).toBe(false);
});

test("a caret entry in a later config file is found", () => {
  const jsonc = join(tmp, "opencode.jsonc");
  writeFileSync(jsonc, JSON.stringify({ plugin: ["opencode-wakatime"] }));
  expect(readCaretEntry([jsonc, configWith([`${PKG}@0.8.0`])])?.spec).toBe(`${PKG}@0.8.0`);
});
