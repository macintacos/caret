import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import {
  buildHash,
  buildHashTarget,
  computeBuildId,
  IDENTITY,
  isCompiledBinary,
  resolveCommit,
  VERSION,
} from "../../src/build-id.ts";
import type { UiAssets } from "../../src/ui-assets.ts";

// A UiAssets handle over real temp files, so buildHash reads bytes through
// Bun.file exactly as it does in production. `paths` is sorted to match the
// resolver's contract (the digest folds assets in sorted-path order).
const assetDirs: string[] = [];
function fakeAssets(files: Record<string, string>): UiAssets {
  const root = mkdtempSync(join(tmpdir(), "caret-assets-"));
  assetDirs.push(root);
  const map: Record<string, string> = {};
  for (const [urlPath, content] of Object.entries(files)) {
    const safe = join(root, urlPath.replace(/[^A-Za-z0-9]/g, "_"));
    writeFileSync(safe, content);
    map[urlPath] = safe;
  }
  return {
    paths: Object.keys(map).sort(),
    file: (urlPath) => (map[urlPath] ? Bun.file(map[urlPath]) : undefined),
  };
}

afterEach(() => {
  for (const d of assetDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

// The static identity surface plus the build fingerprint and commit resolver.

test("VERSION reflects package.json (honest identity, not the stale 0.0.1 hardcode)", () => {
  expect(VERSION).toBe(pkg.version);
});

test("IDENTITY names the caret service at the current version", () => {
  expect(IDENTITY).toEqual({ service: "caret", version: pkg.version });
});

// ---- isCompiledBinary: the one dev-vs-compiled signal ----

test("isCompiledBinary reads the runtime kind off argv[1]'s extension", () => {
  // The single heuristic daemonCommand / currentBuildId / discovery all key off:
  // a `.ts` entry script means `bun run` dev; anything else is the compiled
  // binary (process.execPath IS caret).
  const saved = process.argv.slice();
  try {
    process.argv[1] = "/some/path/src/cli.ts";
    expect(isCompiledBinary()).toBe(false);
    process.argv[1] = "/usr/local/bin/caret";
    expect(isCompiledBinary()).toBe(true);
  } finally {
    process.argv = saved;
  }
});

test("buildHashTarget hashes the bundle script, not the shared bun, for the bun bundle", () => {
  // Compiled binary: argv[1] is a subcommand, execPath IS caret → hash execPath.
  expect(buildHashTarget("review", "/cache/bin/caret-native")).toBe("/cache/bin/caret-native");
  // Run-from-source bundle (`bun dist/cli.js`): execPath is the shared bun, so
  // hashing it would make every caret version look identical and never supersede
  // a running daemon on upgrade — hash the version-bearing bundle (argv[1]).
  expect(buildHashTarget("/cache/dist/cli.js", "/opt/bun/bin/bun")).toBe("/cache/dist/cli.js");
  // No argv[1] (defensive): fall back to execPath.
  expect(buildHashTarget(undefined, "/cache/bin/caret-native")).toBe("/cache/bin/caret-native");
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

test("computeBuildId hashes the binary when running compiled (any rebuild wins)", async () => {
  const id = await computeBuildId({
    isCompiled: true,
    hashBinary: async () => "binhash123",
    uiHash: async () => "uihash",
  });
  expect(id).toBe("binhash123");
});

test("computeBuildId falls back to the UI hash when the binary is unreadable", async () => {
  const id = await computeBuildId({
    isCompiled: true,
    hashBinary: async () => null,
    uiHash: async () => "uihash",
  });
  expect(id).toBe("uihash");
});

test("computeBuildId uses the UI hash in dev (not compiled, never reads the binary)", async () => {
  let binaryReads = 0;
  const id = await computeBuildId({
    isCompiled: false,
    hashBinary: async () => {
      binaryReads++;
      return "binhash";
    },
    uiHash: async () => "uihash",
  });
  expect(id).toBe("uihash");
  expect(binaryReads).toBe(0);
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
