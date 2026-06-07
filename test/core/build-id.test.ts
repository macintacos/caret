import { expect, test } from "bun:test";
import pkg from "../../package.json" with { type: "json" };
import {
  buildHash,
  computeBuildId,
  IDENTITY,
  isCompiledBinary,
  resolveCommit,
  VERSION,
} from "../../src/build-id.ts";

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

test("buildHash is stable for identical input and differs for changed input", () => {
  expect(buildHash("<html>a</html>")).toBe(buildHash("<html>a</html>"));
  expect(buildHash("<html>a</html>")).not.toBe(buildHash("<html>b</html>"));
});

test("buildHash returns 'no-ui' when the UI is undefined", () => {
  expect(buildHash(undefined)).toBe("no-ui");
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
