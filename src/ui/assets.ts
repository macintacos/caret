// Resolves the built UI's assets for the daemon to serve (EXC-522). The result
// is a UiAssets handle: the set of request URL paths the build emitted, and a
// Bun.file lookup per path (Bun.file carries the MIME type and reads the bytes,
// embedded or on disk). The daemon serves index documents and hashed assets from
// this one seam; build-id.ts digests it into the staleness fingerprint.
//
// Resolution preserves today's graceful-degradation chain:
//   1. the build-generated manifest module — the compiled binary, and a source
//      run after `mise run build bin` has emitted it;
//   2. ui/dist/ enumerated on disk relative to the source tree — dev/e2e runs
//      that built the UI but not the manifest;
//   3. a dist tree copied beside the binary (dirname(execPath)/ui/) — the
//      safety-net analogue of the former bin/index.html fallback;
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

/** Enumerate a dist directory into a UiAssets handle, or undefined when the
 * directory is absent or empty. The URL path is each file's dist-relative path
 * with a leading slash. */
export function assetsFromDist(distDir: string): UiAssets | undefined {
  const map: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.isFile()) map[`/${relative(distDir, full).split("\\").join("/")}`] = full;
    }
  };
  try {
    walk(distDir);
  } catch {
    return undefined; // dist tree absent — fall through to the next source.
  }
  return Object.keys(map).length > 0 ? fromPathMap(map) : undefined;
}

/** Resolve the UI assets, or undefined when no UI is available (the daemon then
 * serves its placeholder). Tries the embedded manifest, then ui/dist/ in the
 * source tree, then a dist tree beside the binary. */
export async function loadUiAssets(): Promise<UiAssets | undefined> {
  try {
    const mod = await import("@/ui-manifest.generated.ts");
    if (mod.UI_MANIFEST && Object.keys(mod.UI_MANIFEST).length > 0) {
      return fromPathMap(mod.UI_MANIFEST);
    }
  } catch {
    // No generated manifest (dev / fresh checkout) — fall through.
  }
  const srcDist = fileURLToPath(new URL("../../ui/dist", import.meta.url));
  const fromSrc = assetsFromDist(srcDist);
  if (fromSrc) return fromSrc;
  const besideDist = join(dirname(process.execPath), "ui");
  return assetsFromDist(besideDist);
}
