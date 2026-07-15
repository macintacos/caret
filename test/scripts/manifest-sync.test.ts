// Per-push gate for the triple-manifest version-sync invariant (EXC-546).
// The release pipeline already checks this via guards.ts -> assertInSync, but
// that runs only inside `mise run release`; this suite runs the same pure
// assertInSync over the three REAL on-disk manifests so drift fails `bun test`
// (and thus preflight) on every push, not just at release time. It reuses the
// release tooling's MANIFESTS list and extractVersion/assertInSync — no
// duplicated version-extraction logic, no touching the regex-based surgery.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { assertInSync, extractVersion } from "../../scripts/tasks/release/manifest.ts";
import { MANIFESTS } from "../../scripts/tasks/release/steps/context.ts";

// MANIFESTS holds repo-root-relative paths; this suite lives at test/scripts/,
// two levels below the root, so resolve against import.meta.dir to read the
// real files regardless of the cwd the runner is invoked from.
const REPO_ROOT = join(import.meta.dir, "..", "..");

test("the three on-disk manifests report the same version", () => {
  const entries = MANIFESTS.map((file) => ({
    file,
    version: extractVersion(readFileSync(join(REPO_ROOT, file), "utf-8")),
  }));
  expect(() => assertInSync(entries)).not.toThrow();
});
