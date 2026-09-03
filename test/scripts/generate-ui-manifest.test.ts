// Unit coverage for the embed-manifest generator (scripts/generate-ui-manifest.ts):
// the pure renderer (renderManifestModule) and the filesystem enumerator
// (enumerateDist / writeManifest). The generator runs inline from the `build bin`
// target to emit src/ui-manifest.generated.ts before the compile;
// these tests pin its URL mapping, enumeration completeness, and emitted-module
// shape without a real build.
import { expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  enumerateDist,
  type ManifestEntry,
  renderManifestModule,
  writeManifest,
} from "@scripts/generate-ui-manifest.ts";
import { fakeDistDir } from "@test/support/fs-tree.ts";

// Lay down a representative dist tree (index plus hashed siblings under assets/)
// in a temp dir and return its root; caller cleans up.
const fakeDist = (files: Record<string, string>): string => fakeDistDir("caret-gen-dist-", files);

// ---- enumerateDist: URL mapping + enumeration completeness ----

test("enumerateDist maps every dist file to its request URL path", () => {
  const dist = fakeDist({
    "index.html": "<html></html>",
    "assets/index-AB12.js": "x",
    "assets/index-CD34.css": "y",
  });
  try {
    const entries = enumerateDist(dist, join(dist, "..", "out.ts"));
    expect(entries.map((e) => e.urlPath)).toEqual([
      "/assets/index-AB12.js",
      "/assets/index-CD34.css",
      "/index.html",
    ]);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("enumerateDist sorts by URL path so the emitted module is order-stable", () => {
  const dist = fakeDist({ "z.js": "1", "a.css": "2", "index.html": "3" });
  try {
    const a = enumerateDist(dist, join(dist, "out.ts")).map((e) => e.urlPath);
    expect(a).toEqual([...a].sort());
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

test("enumerateDist computes import paths relative to the output module's dir", () => {
  const dist = fakeDist({ "index.html": "x" });
  try {
    // outFile a sibling dir of dist: the import path is a relative specifier
    // back into dist, leading with "./" or "../".
    const [entry] = enumerateDist(dist, join(dist, "..", "src", "out.ts")) as [ManifestEntry];
    expect(entry.importPath.startsWith(".")).toBe(true);
    expect(entry.importPath.endsWith("/index.html")).toBe(true);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});

// ---- renderManifestModule: emitted-module shape ----

test("renderManifestModule emits a file-attribute import and a record entry per asset", () => {
  const out = renderManifestModule([
    { urlPath: "/index.html", importPath: "../ui/dist/index.html", varName: "asset__index_html" },
    {
      urlPath: "/assets/app.js",
      importPath: "../ui/dist/assets/app.js",
      varName: "asset__assets_app_js",
    },
  ]);
  expect(out).toContain(
    'import asset__index_html from "../ui/dist/index.html" with { type: "file" };',
  );
  expect(out).toContain(
    'import asset__assets_app_js from "../ui/dist/assets/app.js" with { type: "file" };',
  );
  // The map keys are the request URL paths; values narrow to string via String().
  expect(out).toContain('"/index.html": String(asset__index_html),');
  expect(out).toContain('"/assets/app.js": String(asset__assets_app_js),');
  expect(out).toContain("export const UI_MANIFEST: Record<string, string> = {");
});

test("renderManifestModule is pure: identical entries yield identical text", () => {
  const entries: ManifestEntry[] = [
    { urlPath: "/index.html", importPath: "./index.html", varName: "a" },
  ];
  expect(renderManifestModule(entries)).toBe(renderManifestModule(entries));
});

// ---- writeManifest: the end-to-end emit ----

test("writeManifest enumerates the dist tree and writes a parseable module", () => {
  const dist = fakeDist({ "index.html": "x", "assets/app-AB12.js": "y" });
  const outFile = join(dist, "..", "ui-manifest.generated.ts");
  try {
    const count = writeManifest(dist, outFile);
    expect(count).toBe(2);
    const text = readFileSync(outFile, "utf-8");
    expect(text).toContain('with { type: "file" }');
    expect(text).toContain('"/index.html": String(');
    expect(text).toContain('"/assets/app-AB12.js": String(');
  } finally {
    rmSync(dist, { recursive: true, force: true });
    rmSync(outFile, { force: true });
  }
});
