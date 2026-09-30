// The doc ↔ cache-path coupling (EXC-910). doc/ARCHITECTURE.md prints an `rm -rf` per
// OpenCode cache layout for a reader to paste into a shell, and each path must be one the
// paths.ts helpers produce. The two drifted once already: the docs quoted
// ~/.cache/opencode/node_modules/@macintacos/caret, a path caret has never written, so
// `rm -rf` on it exited 0 and the documented update was a silent no-op. Prose cannot hold
// that coupling; this suite reads the doc and fails when a printed path stops matching.

import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { withEnv } from "@test/support/env.ts";
import {
  CARET_PACKAGE,
  opencodeCachePackageDir,
  opencodeNpmCacheDir,
} from "@/adapters/opencode/paths.ts";

const ARCHITECTURE_MD = join(import.meta.dir, "../../../doc/ARCHITECTURE.md");

/** The by-hand cache path the doc prints under `layoutDir` (`packages` or `npm`), minus
 * its trailing glob. Requires exactly one such line per layout, so dropping it or adding a
 * second one fails here rather than silently passing. */
function quotedCachePath(text: string, layoutDir: string): string {
  const found = [...text.matchAll(/rm -rf (\S+?)\*/g)].filter((m) =>
    m[1]?.includes(`/opencode/${layoutDir}/`),
  );
  const path = found.length === 1 ? found[0]?.[1] : undefined;
  if (path === undefined) {
    throw new Error(
      `expected one \`rm -rf <${layoutDir} cache path>*\` in ARCHITECTURE.md, found ${found.length}`,
    );
  }
  return path;
}

/** `resolve()` for a reader with no XDG_CACHE_HOME, written the way a doc writes a
 * home-relative path. */
function documentedForm(resolve: () => string): string {
  let resolved = "";
  withEnv({ XDG_CACHE_HOME: undefined }, () => {
    resolved = resolve();
  });
  return resolved.replace(homedir(), "~");
}

test("doc/ARCHITECTURE.md prints the v1 cache path opencodeCachePackageDir() produces", async () => {
  const quoted = quotedCachePath(await Bun.file(ARCHITECTURE_MD).text(), "packages");
  expect(quoted).toBe(documentedForm(() => opencodeCachePackageDir()));
});

test("doc/ARCHITECTURE.md's v2 cache glob matches every opencodeNpmCacheDir() spec dir", async () => {
  const quoted = quotedCachePath(await Bun.file(ARCHITECTURE_MD).text(), "npm");
  const bare = documentedForm(() => opencodeNpmCacheDir(CARET_PACKAGE, null));
  const pinned = documentedForm(() => opencodeNpmCacheDir(CARET_PACKAGE, "1.2.3"));
  expect(dirname(quoted)).toBe(dirname(bare));
  expect(bare.startsWith(quoted)).toBe(true);
  expect(pinned.startsWith(quoted)).toBe(true);
});
