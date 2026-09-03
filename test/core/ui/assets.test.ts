// The UI asset resolver's disk-enumeration source (src/ui/assets.ts
// assetsFromDist): the dev/e2e path that serves ui/dist/ off disk when no embed
// manifest is present, and the absent-dir case that degrades to the daemon's
// placeholder. The embedded-manifest source is exercised end-to-end by the
// compiled-binary check; the daemon's serving behavior is pinned in daemon.test.
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fakeDistDir } from "@test/support/fs-tree.ts";
import { assetsFromDist, uiDistCandidates } from "@/ui/assets.ts";

const fakeDist = (files: Record<string, string>): string => fakeDistDir("caret-ui-dist-", files);

test("assetsFromDist enumerates a dist tree into URL paths, sorted", () => {
  const dist = fakeDist({
    "index.html": "<html></html>",
    "assets/index-AB12.js": "x",
    "assets/index-CD34.css": "y",
  });
  try {
    const assets = assetsFromDist(dist);
    expect(assets?.paths).toEqual([
      "/assets/index-AB12.js",
      "/assets/index-CD34.css",
      "/index.html",
    ]);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("assetsFromDist serves a file by URL path, with its MIME via Bun.file", async () => {
  const dist = fakeDist({ "assets/index-AB12.js": "export const x = 1;\n" });
  try {
    const file = assetsFromDist(dist)?.file("/assets/index-AB12.js");
    expect(file).toBeDefined();
    expect(file?.type).toContain("javascript");
    expect(await file?.text()).toBe("export const x = 1;\n");
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("assetsFromDist returns undefined for a path that isn't in the dist (exact match)", () => {
  const dist = fakeDist({ "index.html": "x" });
  try {
    const assets = assetsFromDist(dist);
    expect(assets?.file("/assets/missing.js")).toBeUndefined();
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

// Traversal safety is load-bearing at this layer: file() is a raw map lookup, no
// URL normalization runs first (unlike the daemon, where new URL() collapses
// "..", masking the guard). "/assets/../index.html" is the falsifiable case — it
// names a real fixture file by an escaping path. Exact-match returns undefined;
// a filesystem-joining implementation (Bun.file(join(dist, urlPath))) would
// resolve it to dist/index.html and serve it. So this test fails if anyone
// replaces the exact-match map lookup with a path join.
test("assetsFromDist never resolves a traversal path against the filesystem", () => {
  const dist = fakeDist({ "index.html": "secret", "assets/index-AB12.js": "x" });
  try {
    const assets = assetsFromDist(dist);
    expect(assets?.file("/assets/../index.html")).toBeUndefined();
    expect(assets?.file("/../src/cli.ts")).toBeUndefined();
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("assetsFromDist returns undefined for a missing dir (daemon then serves placeholder)", () => {
  expect(assetsFromDist(join(tmpdir(), "caret-no-such-dist-xyz"))).toBeUndefined();
});

test("assetsFromDist returns undefined for an empty dir", () => {
  const dist = mkdtempSync(join(tmpdir(), "caret-empty-dist-"));
  try {
    expect(assetsFromDist(dist)).toBeUndefined();
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

// The two distributions that read a dist tree off disk put this module at
// different depths under the caret root, and no single relative path reaches
// ui/dist from both: the run-from-source bundle collapses to <root>/dist/cli.js
// (bun leaves import.meta.url pointing at the OUTPUT file), while a checkout
// keeps it at <root>/src/ui/assets.ts. Each layout is pinned on its own — a
// resolver offering one candidate serves the daemon's placeholder for whichever
// layout it isn't. `mise run smoke bundle` is the end-to-end counterpart.
test("uiDistCandidates reaches <root>/ui/dist from the bundle layout", () => {
  expect(uiDistCandidates("file:///pkg/dist/cli.js")).toContain("/pkg/ui/dist");
});

test("uiDistCandidates reaches <root>/ui/dist from the source layout", () => {
  expect(uiDistCandidates("file:///repo/src/ui/assets.ts")).toContain("/repo/ui/dist");
});

// Order is load-bearing, not cosmetic: in a checkout the bundle candidate names
// <root>/src/ui/dist, which does not exist, so the source candidate must still be
// reached. Nearest-first keeps the bundle — the layout with no other fallback,
// since its execPath is bun's own bin dir — from depending on a miss upstream.
test("uiDistCandidates offers the bundle candidate before the source one", () => {
  expect(uiDistCandidates("file:///repo/src/ui/assets.ts")).toEqual([
    "/repo/src/ui/dist",
    "/repo/ui/dist",
  ]);
});
