import { afterEach, expect, test } from "bun:test";

import pkg from "@root/package.json" with { type: "json" };
import { makeFakeUiAssets } from "@test/support/fake-ui-assets.ts";
import {
  buildHash,
  buildKind,
  computeBuildId,
  IDENTITY,
  isCompiledBinary,
  resolveCommit,
  VERSION,
} from "@/lib/build-id.ts";

// `paths` is sorted to match buildHash's contract (the digest folds assets in
// sorted-path order).
const { fakeAssets, cleanup } = makeFakeUiAssets();
afterEach(cleanup);

// The static identity surface plus the build fingerprint and commit resolver.

test("VERSION reflects package.json (honest identity, not the stale 0.0.1 hardcode)", () => {
  expect(VERSION).toBe(pkg.version);
});

test("IDENTITY names the caret service at the current version", () => {
  expect(IDENTITY).toEqual({ service: "caret", version: pkg.version });
});

// ---- isCompiledBinary: the one dev-vs-compiled signal ----

test("buildKind classifies the runtime off argv[1]'s extension", () => {
  // The signal daemonCommand / currentBuildId / isCompiledBinary key off: a
  // `.ts` entry is `bun run` dev; a `.js` entry is the npm bundle (under bun);
  // anything else is the self-contained compiled binary.
  expect(buildKind("/some/path/src/cli.ts")).toBe("dev");
  expect(buildKind("/cache/dist/cli.js")).toBe("bundle");
  expect(buildKind("review")).toBe("binary"); // a subcommand, the compiled case
  // (Passing undefined would trigger the process.argv[1] default, not a real
  // undefined, so the "no argv" path is exercised via the compiled case above.)
});

test("isCompiledBinary is true for both compiled and bundle (production), false only in dev", () => {
  // It gates production-vs-dev (dev settings, isDev, discovery label), so the
  // npm bundle — production, though it runs under bun — must read as true.
  const saved = process.argv.slice();
  try {
    process.argv[1] = "/some/path/src/cli.ts";
    expect(isCompiledBinary()).toBe(false); // dev
    process.argv[1] = "/usr/local/bin/caret";
    expect(isCompiledBinary()).toBe(true); // compiled binary
    process.argv[1] = "/cache/dist/cli.js";
    expect(isCompiledBinary()).toBe(true); // npm bundle is production, not dev
  } finally {
    process.argv = saved;
  }
});

// ---- buildHash: the UI asset-set digest (the daemon's staleness signal) ----

test("buildHash is deterministic across re-invocations of the same asset set", async () => {
  // daemon-lifecycle.ts reuse-if-same-build depends on this: a dev daemon that
  // re-digests the same dist must produce the same id, or it would retire and
  // respawn itself endlessly.
  const files = { "/index.html": "<html>a</html>", "/assets/app-AB12.js": "console.log(1)" };
  expect(await buildHash(fakeAssets(files))).toBe(await buildHash(fakeAssets(files)));
});

test("buildHash is order-independent (digest folds in sorted-path order)", async () => {
  const a = fakeAssets({ "/index.html": "x", "/assets/app.js": "y" });
  const b = fakeAssets({ "/assets/app.js": "y", "/index.html": "x" });
  expect(await buildHash(a)).toBe(await buildHash(b));
});

test("buildHash differs when any asset's bytes change", async () => {
  const base = await buildHash(fakeAssets({ "/index.html": "<html>a</html>" }));
  expect(await buildHash(fakeAssets({ "/index.html": "<html>b</html>" }))).not.toBe(base);
});

test("buildHash differs when an asset's URL path changes (path is folded in)", async () => {
  const a = await buildHash(fakeAssets({ "/assets/app-AB12.js": "code" }));
  const b = await buildHash(fakeAssets({ "/assets/app-CD34.js": "code" }));
  expect(a).not.toBe(b);
});

test("buildHash differs when an asset is added", async () => {
  const one = await buildHash(fakeAssets({ "/index.html": "x" }));
  const two = await buildHash(fakeAssets({ "/index.html": "x", "/assets/app.js": "y" }));
  expect(one).not.toBe(two);
});

test("buildHash returns 'no-ui' when there is no UI (undefined or empty set)", async () => {
  expect(await buildHash(undefined)).toBe("no-ui");
  expect(await buildHash({ paths: [], file: () => undefined })).toBe("no-ui");
});

// ---- computeBuildId: any local rebuild supersedes a running daemon ----

test("computeBuildId hashes the file when running compiled (any rebuild wins)", async () => {
  const id = await computeBuildId({
    kind: "binary",
    hashFile: async () => "binhash123",
    uiHash: async () => "uihash",
  });
  expect(id).toBe("binhash123");
});

test("computeBuildId hashes the bundle script for the bun bundle (each release wins)", async () => {
  const id = await computeBuildId({
    kind: "bundle",
    hashFile: async () => "bundlehash456",
    uiHash: async () => "uihash",
  });
  expect(id).toBe("bundlehash456");
});

test("computeBuildId falls back to the UI hash when the build file is unreadable", async () => {
  const id = await computeBuildId({
    kind: "binary",
    hashFile: async () => null,
    uiHash: async () => "uihash",
  });
  expect(id).toBe("uihash");
});

test("computeBuildId uses the UI hash in dev (never reads the build file)", async () => {
  let fileReads = 0;
  const id = await computeBuildId({
    kind: "dev",
    hashFile: async () => {
      fileReads++;
      return "binhash";
    },
    uiHash: async () => "uihash",
  });
  expect(id).toBe("uihash");
  expect(fileReads).toBe(0);
});

// ---- resolveCommit: the commit the daemon reports at startup ----

test("resolveCommit prefers the baked build-time commit and never asks git", () => {
  let gitCalls = 0;
  const sha = resolveCommit({
    baked: "a".repeat(40),
    gitHead: () => {
      gitCalls++;
      return "f".repeat(40);
    },
  });
  expect(sha).toBe("a".repeat(40));
  expect(gitCalls).toBe(0);
});

test("resolveCommit falls back to the source checkout's git HEAD in dev", () => {
  const sha = resolveCommit({ baked: undefined, gitHead: () => "f".repeat(40) });
  expect(sha).toBe("f".repeat(40));
});

test("resolveCommit treats a degenerate empty bake as unset", () => {
  const sha = resolveCommit({ baked: "", gitHead: () => "f".repeat(40) });
  expect(sha).toBe("f".repeat(40));
});

test("resolveCommit reports unknown when nothing is baked and git is unavailable", () => {
  const sha = resolveCommit({ baked: undefined, gitHead: () => null });
  expect(sha).toBe("unknown");
});

test("resolveCommit maps a degenerate empty gitHead to unknown", () => {
  const sha = resolveCommit({ baked: undefined, gitHead: () => "" });
  expect(sha).toBe("unknown");
});
