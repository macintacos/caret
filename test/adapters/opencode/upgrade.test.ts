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

import {
  clearCachedCaret,
  hasCaretPluginEntry,
  readCachedCaretVersion,
  readUpgradeVerdict,
  type UpgradeVerdict,
  upgradeCheck,
  upgradeVerdict,
  upgradeVerdictLine,
} from "@/adapters/opencode/upgrade.ts";

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

/** A cache dir holding the shim manifest OpenCode's reify writes: the resolved version
 * under the package NAME, with no range prefix. */
function cacheDir(specifier: string, manifest: unknown): string {
  const dir = join(tmp, specifier);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(manifest));
  return dir;
}
const shim = (version: string) => ({ dependencies: { [PKG]: version } });

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

test("the cached version comes from the first candidate whose shim manifest names caret", () => {
  const stale = cacheDir(`${PKG}@latest`, shim("0.2.0"));
  const bare = cacheDir(PKG, shim("0.8.1"));
  expect(readCachedCaretVersion([bare, stale])).toBe("0.8.1");
  expect(readCachedCaretVersion([stale, bare])).toBe("0.2.0");
});

test("a cache dir with no manifest, no caret entry, or unparseable JSON reads as null", () => {
  const empty = join(tmp, "empty");
  mkdirSync(empty, { recursive: true });
  const other = cacheDir("other", { dependencies: { "opencode-wakatime": "1.0.0" } });
  const broken = join(tmp, "broken");
  mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, "package.json"), "{ not json");
  expect(readCachedCaretVersion([empty, other, broken])).toBeNull();
  expect(readCachedCaretVersion([])).toBeNull();
});

test("an interrupted install — a manifest whose caret entry is missing — falls through", () => {
  const partial = cacheDir(PKG, { name: "opencode-shim" });
  const pinned = cacheDir(`${PKG}@0.7.3`, shim("0.7.3"));
  expect(readCachedCaretVersion([partial, pinned])).toBe("0.7.3");
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

test("a pinned config entry is compared against the published version", async () => {
  expect(
    await readUpgradeVerdict({
      configFile: configWith([`${PKG}@0.8.0`]),
      cacheDirs: () => [],
      published: async () => "0.9.0",
    }),
  ).toEqual({ kind: "stale-pin", entry: `${PKG}@0.8.0`, pinned: "0.8.0", published: "0.9.0" });
});

test("a bare config entry is compared against what OpenCode cached", async () => {
  expect(
    await readUpgradeVerdict({
      configFile: configWith([PKG]),
      cacheDirs: () => [cacheDir(PKG, shim("0.8.0"))],
      published: async () => "0.9.0",
    }),
  ).toEqual({ kind: "stale-cache", cached: "0.8.0", published: "0.9.0" });
});

test("an absent config file reads as no entry at all", async () => {
  expect(
    await readUpgradeVerdict({
      configFile: join(tmp, "no-such-config.json"),
      cacheDirs: () => [],
      published: async () => "0.9.0",
    }),
  ).toEqual({ kind: "fresh" });
});

// ---- hasCaretPluginEntry: the question doctor asks before paying for the check ----

test("a config naming caret has an entry; one naming another plugin does not", () => {
  expect(hasCaretPluginEntry(configWith([`${PKG}@0.8.0`]))).toBe(true);
  expect(hasCaretPluginEntry(configWith([PKG]))).toBe(true);
  expect(hasCaretPluginEntry(configWith(["opencode-wakatime"]))).toBe(false);
});

test("an absent config file carries no entry", () => {
  expect(hasCaretPluginEntry(join(tmp, "no-such-config.json"))).toBe(false);
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
