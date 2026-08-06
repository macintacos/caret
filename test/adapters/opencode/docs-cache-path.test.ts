// The doc ↔ cache-path coupling (EXC-910). doc/ARCHITECTURE.md prints an `rm -rf` a reader
// pastes into a shell, and the path it names is the one opencodeCachePackageDir()
// produces. The two drifted once already: the docs quoted
// ~/.cache/opencode/node_modules/@macintacos/caret, a path caret has never written, so
// `rm -rf` on it exited 0 and the documented update was a silent no-op. Prose cannot hold
// that coupling; this suite reads the doc and fails when the printed path stops matching.

import { expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import { withEnv } from "@test/support/env.ts";
import { opencodeCachePackageDir } from "@/adapters/opencode/paths.ts";

const ARCHITECTURE_MD = join(import.meta.dir, "../../../doc/ARCHITECTURE.md");

/** The by-hand cache path the doc prints, minus its trailing glob. Requires exactly one
 * such line, so dropping it (the state this issue found) or adding a second one fails
 * here rather than silently passing. */
function quotedCachePath(text: string): string {
  const found = [...text.matchAll(/rm -rf (\S+?)\*/g)];
  const path = found.length === 1 ? found[0]?.[1] : undefined;
  if (path === undefined) {
    throw new Error(
      `expected one \`rm -rf <cache path>*\` in ARCHITECTURE.md, found ${found.length}`,
    );
  }
  return path;
}

/** What opencodeCachePackageDir() resolves to for a reader with no XDG_CACHE_HOME,
 * written the way a doc writes a home-relative path. */
function documentedForm(): string {
  let resolved = "";
  withEnv({ XDG_CACHE_HOME: undefined }, () => {
    resolved = opencodeCachePackageDir();
  });
  return resolved.replace(homedir(), "~");
}

test("doc/ARCHITECTURE.md prints the cache path opencodeCachePackageDir() produces", async () => {
  expect(quotedCachePath(await Bun.file(ARCHITECTURE_MD).text())).toBe(documentedForm());
});
