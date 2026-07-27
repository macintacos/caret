// The OpenCode upgrade module (EXC-909): the pure "is this install stale?" decision
// plus the three effects it needs — reading OpenCode's cached caret version, clearing
// those cache dirs, and asking npm what `latest` resolves to. The decision is a table
// over the verdict rules; the effects are driven against a temp dir and an injected
// fetch, so nothing here touches the real cache or the network.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearCachedCaret,
  type FetchLike,
  isNewer,
  publishedCaretVersion,
  readCachedCaretVersion,
  upgradeVerdict,
} from "@/adapters/opencode/upgrade.ts";

const PKG = "@macintacos/caret";

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

/** A fetch stub: one canned response, and a record of the URLs it was asked for. */
function fetching(response: { ok: boolean; body: unknown }): {
  fetchImpl: FetchLike;
  urls: string[];
} {
  const urls: string[] = [];
  return {
    urls,
    fetchImpl: async (url) => {
      urls.push(url);
      return {
        ok: response.ok,
        json: async () => {
          if (response.body === undefined) throw new SyntaxError("malformed JSON");
          return response.body;
        },
      };
    },
  };
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

// --- the effects: reading the cache, clearing it, asking npm ---------------------

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

test("the published version comes from npm's latest dist-tag document", async () => {
  const { fetchImpl, urls } = fetching({ ok: true, body: { version: "0.8.1" } });
  expect(await publishedCaretVersion(fetchImpl)).toBe("0.8.1");
  // npm's `latest`, not GitHub releases: it is what OpenCode actually re-resolves to.
  expect(urls).toEqual([`https://registry.npmjs.org/${PKG}/latest`]);
});

test("a non-200, a malformed body, and a thrown request all degrade to null", async () => {
  expect(await publishedCaretVersion(fetching({ ok: false, body: {} }).fetchImpl)).toBeNull();
  expect(await publishedCaretVersion(fetching({ ok: true, body: undefined }).fetchImpl)).toBeNull();
  expect(
    await publishedCaretVersion(fetching({ ok: true, body: { version: 7 } }).fetchImpl),
  ).toBeNull();
  const offline: FetchLike = async () => {
    throw new Error("getaddrinfo ENOTFOUND");
  };
  expect(await publishedCaretVersion(offline)).toBeNull();
});

test("isNewer compares semver triples, and refuses to guess on junk", () => {
  expect(isNewer("0.8.1", "0.2.0")).toBe(true);
  expect(isNewer("1.0.0", "0.9.9")).toBe(true);
  expect(isNewer("0.8.1", "0.8.1")).toBe(false);
  expect(isNewer("0.2.0", "0.8.1")).toBe(false);
  expect(isNewer("v0.8.1", "0.2.0")).toBe(true);
  expect(isNewer("latest", "0.2.0")).toBe(false);
  expect(isNewer("0.8.1", "not-a-version")).toBe(false);
});
