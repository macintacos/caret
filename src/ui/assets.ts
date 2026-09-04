// Resolves the built UI's assets for the daemon to serve (EXC-522). The result
// is a UiAssets handle: the set of request URL paths the build emitted, and a
// Bun.file lookup per path (Bun.file carries the MIME type and reads the bytes,
// embedded or on disk). The daemon serves index documents and hashed assets from
// this one seam; build-id.ts digests it into the staleness fingerprint.
//
// The resolution chain degrades gracefully, each step covering a distribution
// the one before it does not:
//   1. the build-generated manifest module — the compiled binary, and a source
//      run after `mise run build bin` has emitted it;
//   2. ui/dist/ on disk relative to this module — the run-from-source bundle,
//      and dev/e2e runs that built the UI but not the manifest;
//   3. a dist tree copied beside the binary (dirname(execPath)/ui/);
//   4. undefined — no UI; the daemon serves its built-in placeholder at /.

import { readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export interface UiAssets {
  /** The request URL paths this asset set serves (e.g. "/index.html",
   * "/assets/index-AB12.js"), sorted so the build digest is order-stable. */
  paths: string[];
  /** The BunFile for a URL path, or undefined if the path isn't served. Exact
   * match against `paths` — request paths are never resolved against the
   * filesystem, so traversal is impossible by construction. */
  file(urlPath: string): Bun.BunFile | undefined;
}

/** Build a UiAssets handle over a URL-path → absolute-file-path map. */
function fromPathMap(map: Record<string, string>): UiAssets {
  const paths = Object.keys(map).sort();
  return {
    paths,
    file(urlPath) {
      const filePath = map[urlPath];
      return filePath ? Bun.file(filePath) : undefined;
    },
  };
}

/** Every file under `distDir`, paired with the request URL path it serves at:
 * the file's dist-relative path, slash-normalized, with a leading slash. Throws
 * if the directory is absent. Shared with the embed-manifest generator
 * (scripts/generate-ui-manifest.ts), so the served set and the embedded set are
 * enumerated the same way. */
export function walkDist(distDir: string): Array<{ urlPath: string; full: string }> {
  const found: Array<{ urlPath: string; full: string }> = [];
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile())
        found.push({ urlPath: `/${relative(distDir, full).split("\\").join("/")}`, full });
    }
  };
  walk(distDir);
  return found;
}

/** Enumerate a dist directory into a UiAssets handle, or undefined when the
 * directory is absent or empty. */
export function assetsFromDist(distDir: string): UiAssets | undefined {
  const map: Record<string, string> = {};
  try {
    for (const { urlPath, full } of walkDist(distDir)) map[urlPath] = full;
  } catch {
    return undefined; // dist tree absent — fall through to the next source.
  }
  return Object.keys(map).length > 0 ? fromPathMap(map) : undefined;
}

/** The ui/dist directories to try for the module at `moduleUrl`, nearest first.
 * No single relative path reaches ui/dist from both disk layouts: bun leaves
 * `import.meta.url` pointing at the OUTPUT file, so the run-from-source bundle
 * sees <root>/dist/cli.js where a checkout sees <root>/src/ui/assets.ts. The
 * candidate that does not match names a directory that does not exist, so
 * offering both costs a failed stat rather than risking the wrong tree. */
export function uiDistCandidates(moduleUrl: string): string[] {
  return [
    fileURLToPath(new URL("../ui/dist", moduleUrl)), // bundle: <root>/dist/cli.js
    fileURLToPath(new URL("../../ui/dist", moduleUrl)), // checkout: <root>/src/ui/assets.ts
  ];
}

/** Resolve the UI assets, or undefined when no UI is available (the daemon then
 * serves its placeholder). */
export async function loadUiAssets(): Promise<UiAssets | undefined> {
  try {
    const mod = await import("@/ui-manifest.generated.ts");
    if (mod.UI_MANIFEST && Object.keys(mod.UI_MANIFEST).length > 0) {
      return fromPathMap(mod.UI_MANIFEST);
    }
  } catch {
    // No generated manifest (dev / fresh checkout) — fall through.
  }
  for (const dir of uiDistCandidates(import.meta.url)) {
    const fromDist = assetsFromDist(dir);
    if (fromDist) return fromDist;
  }
  const besideDist = join(dirname(process.execPath), "ui");
  return assetsFromDist(besideDist);
}
