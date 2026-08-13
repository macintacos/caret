// Standing gate for the exact-pin rationale (EXC-1081). `bun.lock` is committed, so it is
// already what pins every dependency to an exact version; a range in package.json is the
// *upgrade policy* — what `bun update` may move. A bare version there therefore says "never
// move this on its own", which is a real decision that leaves no trace: `smol-toml` sat two
// minors behind on a parser reading user-authored config.toml precisely because nothing
// surfaced its pin as needing attention.
//
// package.json's `pinned` block states each such decision in prose. This suite is what
// makes it falsifiable in both directions — a new exact pin added without a reason, and a
// rationale left behind after its dependency was de-pinned — so the record cannot rot back
// into the silence it was written to end.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The suite sits at test/structure/, two levels below the repo root; resolving against
// import.meta.dir reads the real tree regardless of the runner's cwd.
const REPO_ROOT = join(import.meta.dir, "..", "..");

interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  /** Package name -> why its pin is exact, plus npm's `//` comment key for the policy. */
  pinned?: Record<string, string>;
}

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf-8")) as Manifest;

/** Exactness is "the range is a bare version": `1.0.0-beta.6` starts with a digit, every
 * range operator (`^`, `~`, `>`, `*`) and every non-registry specifier does not. */
const exact = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
  .filter(([, range]) => /^\d/.test(range))
  .map(([name]) => name)
  .sort();

/** The documented pins, minus the `//` key — that one carries the policy, not a package. */
const documented = Object.keys(pkg.pinned ?? {})
  .filter((name) => name !== "//")
  .sort();

test("every exact-pinned dependency states why in `pinned`", () => {
  expect(exact.filter((name) => !documented.includes(name))).toEqual([]);
});

test("every `pinned` entry still names an exact-pinned dependency", () => {
  expect(documented.filter((name) => !exact.includes(name))).toEqual([]);
});
