// Standing gate for the rumdl pin invariant (EXC-931). caret formats plans with
// a binary it downloads itself, described by RUMDL_VERSION and the ASSETS
// checksums in src/plan/rumdl.ts; dev, CI, and the pre-commit hook format with
// the mise-provisioned binary that mise.lock resolves. The two must be the same
// release, because the formatter suite runs the *mise* binary
// (test/support/rumdl-preload.ts) while production runs the *downloaded* one —
// so a divergence lets a plan-formatting change pass its tests against a version
// end users never receive.
//
// src/plan/rumdl.ts states that lockstep in prose ("kept in lockstep with
// mise.lock's [[tools.rumdl]]"). This suite is what makes it falsifiable: a
// `mise up rumdl` that moves the lock without bumping RUMDL_VERSION and the four
// checksums fails `bun test` on the spot rather than surfacing later as a
// formatter that behaves differently for users than it did in review.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseToml } from "smol-toml";

import { RUMDL_VERSION, rumdlAsset } from "@/plan/rumdl.ts";

// The suite sits at test/structure/, two levels below the repo root; resolving
// against import.meta.dir reads the real tree regardless of the runner's cwd.
const REPO_ROOT = join(import.meta.dir, "..", "..");

/** The `[[tools.rumdl]]` entry from mise.lock. Its per-platform sub-tables are
 * keyed by the literal string `platforms.<name>`, and each checksum is prefixed
 * with its algorithm (`sha256:<hex>`). */
interface RumdlLockEntry {
  version: string;
  [platformKey: string]: unknown;
}

const lock = (
  parseToml(readFileSync(join(REPO_ROOT, "mise.lock"), "utf-8")) as unknown as {
    tools: { rumdl?: RumdlLockEntry[] };
  }
).tools.rumdl?.[0];
if (!lock) throw new Error("mise.lock carries no [[tools.rumdl]] entry to pin against");

/** ASSETS keys (`${process.platform}-${process.arch}`) against the mise.lock
 * platform whose archive they name. mise says `macos` where node says `darwin`,
 * which is the whole reason this mapping is written out rather than derived. */
const PLATFORMS = [
  ["darwin", "arm64", "macos-arm64"],
  ["darwin", "x64", "macos-x64"],
  ["linux", "arm64", "linux-arm64"],
  ["linux", "x64", "linux-x64"],
] as const;

test("RUMDL_VERSION matches the release mise.lock resolved", () => {
  expect(lock.version).toBe(RUMDL_VERSION);
});

test("every ASSETS checksum mirrors mise.lock", () => {
  for (const [platform, arch, lockPlatform] of PLATFORMS) {
    const locked = lock[`platforms.${lockPlatform}`] as { checksum: string };
    expect(`sha256:${rumdlAsset(platform, arch).sha256}`).toBe(locked.checksum);
  }
});
