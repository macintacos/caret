// Standing gate for the exact-pin rationale (EXC-1081). An exact pin in package.json is a
// decision — "`bun update` must never move this on its own" — that nothing surfaces: it is
// invisible to an upgrade sweep by construction, so a dependency sitting at a trust
// boundary can fall minors behind with nothing saying so. package.json's `pinned` block
// records that decision per package, and its `//` key states the policy behind it.
//
// This suite makes the record falsifiable in three directions — an exact pin added with no
// reason, an empty reason added to quiet the gate, and a reason left behind after its
// dependency was de-pinned — so it cannot rot back into the silence it exists to end.
import { expect, test } from "bun:test";

import semver from "semver";

import pkg from "@root/package.json" with { type: "json" };

/** Exactness is "the range names one concrete version", which is precisely what
 * `semver.valid` tests: unlike a leading-digit check it rejects npm's bare shorthand
 * ranges (`1`, `1.2`, `1.x`), every one of which is caret-equivalent. */
const exact = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
  .filter(([, range]) => semver.valid(range) !== null)
  .map(([name]) => name)
  .sort();

/** The documented pins. `//` carries the policy rather than a package, and a blank reason
 * is no reason — excluding both keeps either from satisfying the gate. */
const documented = Object.entries(pkg.pinned)
  .filter(([name, reason]) => name !== "//" && reason.trim() !== "")
  .map(([name]) => name)
  .sort();

test("every exact-pinned dependency states why in `pinned`", () => {
  expect(exact.filter((name) => !documented.includes(name))).toEqual([]);
});

test("every `pinned` entry still names an exact-pinned dependency", () => {
  expect(documented.filter((name) => !exact.includes(name))).toEqual([]);
});
