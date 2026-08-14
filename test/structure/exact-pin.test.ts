// Standing gate for the exact-pin rationale (EXC-1081). An exact pin in package.json is a
// decision — "`bun update` must never move this on its own" — that nothing surfaces: it is
// invisible to an upgrade sweep by construction, so a dependency sitting at a trust
// boundary can fall minors behind with nothing saying so. package.json's `pinned` block
// records that decision per package, and its `//` key states the policy behind it.
//
// This suite makes the record falsifiable in three directions — an exact pin added with no
// reason, an empty reason added to quiet the gate, and a reason left behind after its
// dependency was de-pinned — so it cannot rot back into the silence it exists to end. It
// scans the four sections a concrete version can arrive through: `dependencies`,
// `devDependencies`, `overrides`, and `resolutions`.
import { expect, test } from "bun:test";

import semver from "semver";

import pkg from "@root/package.json" with { type: "json" };

/** The sections a range can arrive through. bun honours `overrides` and `resolutions`
 * alongside the obvious two, and both take a concrete version. Neither ends in
 * `Dependencies`, so dependency-placement.test.ts's "`dependencies` is the only section a
 * consumer's install pulls" assertion does not see them — it already reds on
 * `optionalDependencies` or `peerDependencies`, which is why this list stops here. */
const SCANNED = ["dependencies", "devDependencies", "overrides", "resolutions"] as const;

/**
 * The two directions this suite checks, derived from one manifest so a test can hand it a
 * synthetic one: `undocumented` is an exact pin with no reason, `stale` a reason whose pin
 * is gone.
 *
 * Exactness is "the range names one concrete version", which is precisely what
 * `semver.valid` tests: unlike a leading-digit check it rejects npm's bare shorthand ranges
 * (`1`, `1.2`, `1.x`), every one of which is caret-equivalent. It is also what keeps a
 * value that is not a version out — an npm-style nested override object, a `$dep`
 * back-reference — since neither names one concrete version. A yarn-style `resolutions`
 * path key (`react-dom/scheduler`) is reported by the key that spells it, which is the
 * string a `pinned` entry has to name.
 *
 * On the documented side, `//` carries the policy rather than a package and a blank reason
 * is no reason — excluding both keeps either from satisfying the gate.
 */
function audit(manifest: Record<string, unknown>): { undocumented: string[]; stale: string[] } {
  const exact = SCANNED.flatMap((section) =>
    Object.entries((manifest[section] ?? {}) as Record<string, string>),
  )
    .filter(([, range]) => semver.valid(range) !== null)
    .map(([name]) => name)
    .sort();

  const documented = Object.entries((manifest.pinned ?? {}) as Record<string, string>)
    .filter(([name, reason]) => name !== "//" && reason.trim() !== "")
    .map(([name]) => name)
    .sort();

  return {
    undocumented: exact.filter((name) => !documented.includes(name)),
    stale: documented.filter((name) => !exact.includes(name)),
  };
}

const real = audit(pkg);

test("every exact-pinned dependency states why in `pinned`", () => {
  expect(real.undocumented).toEqual([]);
});

test("every `pinned` entry still names an exact-pinned dependency", () => {
  expect(real.stale).toEqual([]);
});

test("a pin arriving through `overrides` or `resolutions` is checked like any other", () => {
  expect(
    audit({ overrides: { lodash: "4.17.21" }, resolutions: { minimist: "1.2.8" }, pinned: {} })
      .undocumented,
  ).toEqual(["lodash", "minimist"]);
});

test("a `pinned` entry backed only by `overrides` is live, not stale", () => {
  expect(audit({ overrides: { lodash: "4.17.21" }, pinned: { lodash: "why" } }).stale).toEqual([]);
});
