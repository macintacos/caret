// Standing gate for the exact-pin rationale (EXC-1081). An exact pin in package.json is a
// decision — "`bun update` must never move this on its own" — that nothing surfaces: it is
// invisible to an upgrade sweep by construction, so a dependency sitting at a trust
// boundary can fall minors behind with nothing saying so. package.json's `pinned` block
// records that decision per package, and its `//` key states the policy behind it.
//
// This suite makes the record falsifiable in three directions — an exact pin added with no
// reason, an empty reason added to quiet the gate, and a reason left behind after its
// dependency was de-pinned — so it cannot rot back into the silence it exists to end. It
// scans four sections — `dependencies`, `devDependencies`, `overrides`, and `resolutions`;
// `SCANNED` below records why the list stops there.
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
 * Exactness is "the range names one concrete version", which is what `semver.valid` tests:
 * unlike a leading-digit check it rejects npm's bare shorthand ranges (`1`, `1.2`, `1.x`),
 * every one of which is caret-equivalent. It also rejects two forms that *do* name one
 * version — `=1.2.3`, and an `npm:` alias such as `npm:typescript@7.0.2` — so a pin written
 * either way goes uncaught. The alias gap is live rather than theoretical: `@typescript/native`
 * is an alias today.
 *
 * An npm-style nested override is unwrapped rather than dropped, because bun honours the
 * `"."` pin nested beside the entry's sub-dependency overrides — its "does not support
 * nested overrides" warning covers only that sub-dependency half, so a pin written this way
 * is in force and would otherwise be invisible. A `$dep` back-reference names no version and
 * drops out on its own terms. A yarn-style `resolutions` path key (`react-dom/scheduler`) is
 * reported by the key that spells it, which is the string a `pinned` entry has to name; a
 * name appearing in two scanned sections is reported once.
 *
 * On the documented side, `//` carries the policy rather than a package, and a reason that is
 * not a non-blank string is no reason — excluding those keeps any of them from satisfying the
 * gate.
 */
function audit(manifest: Record<string, unknown>): { undocumented: string[]; stale: string[] } {
  const exact = [
    ...new Set(
      SCANNED.flatMap((section) =>
        Object.entries((manifest[section] ?? {}) as Record<string, unknown>),
      )
        .filter(([, value]) => {
          const range =
            typeof value === "object" && value !== null ? Reflect.get(value, ".") : value;
          return typeof range === "string" && semver.valid(range) !== null;
        })
        .map(([name]) => name),
    ),
  ].sort();

  const documented = Object.entries((manifest.pinned ?? {}) as Record<string, unknown>)
    .filter(([name, reason]) => name !== "//" && typeof reason === "string" && reason.trim() !== "")
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

// Every section in `SCANNED` is named here, so deleting one from that list reds rather
// than passing vacuously — `dependencies` carries no exact pin today, so nothing else in
// this suite would notice its loss.
test("an exact pin is checked in every scanned section", () => {
  expect(
    audit({
      dependencies: { alpha: "1.0.0" },
      devDependencies: { bravo: "1.0.0" },
      overrides: { lodash: "4.17.21" },
      resolutions: { minimist: "1.2.8" },
      pinned: {},
    }).undocumented,
  ).toEqual(["alpha", "bravo", "lodash", "minimist"]);
});

test("a `pinned` entry backed only by `overrides` is live, not stale", () => {
  expect(audit({ overrides: { lodash: "4.17.21" }, pinned: { lodash: "why" } }).stale).toEqual([]);
});

test("an npm-style nested override puts its `.` pin in force", () => {
  expect(
    audit({ overrides: { lodash: { ".": "4.17.21", chalk: "5.0.0" } }, pinned: {} }).undocumented,
  ).toEqual(["lodash"]);
});

test("a value naming no single version is not a pin", () => {
  expect(
    audit({
      overrides: {
        ranged: "^1.0.0",
        shorthand: "1.x",
        backReference: "$backReference",
        aliased: "npm:typescript@7.0.2",
        nestedWithoutRoot: { chalk: "5.0.0" },
      },
      pinned: {},
    }).undocumented,
  ).toEqual([]);
});

test("a package pinned in two scanned sections is reported once", () => {
  expect(
    audit({ devDependencies: { lodash: "4.17.21" }, overrides: { lodash: "4.17.21" }, pinned: {} })
      .undocumented,
  ).toEqual(["lodash"]);
});

test("a `pinned` reason that is not a string is no reason", () => {
  expect(
    audit({ overrides: { lodash: "4.17.21" }, pinned: { lodash: { why: "structured" } } })
      .undocumented,
  ).toEqual(["lodash"]);
});
