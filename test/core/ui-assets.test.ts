// The UI asset resolver's disk-enumeration source (src/ui-assets.ts
// assetsFromDist): the dev/e2e path that serves ui/dist/ off disk when no embed
// manifest is present, and the absent-dir case that degrades to the daemon's
// placeholder. The embedded-manifest source is exercised end-to-end by the
// compiled-binary check; the daemon's serving behavior is pinned in daemon.test.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetsFromDist } from "../../src/ui/assets.ts";

function fakeDist(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "caret-ui-dist-"));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

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
