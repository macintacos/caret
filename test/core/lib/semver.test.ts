// Semver comparison for caret's own version numbers: the `X.Y.Z` triple parse and
// the strictly-newer comparison every upgrade check decides on. Pure, so the whole
// suite is a table over the two functions.

import { expect, test } from "bun:test";

import { isNewer } from "@/lib/semver.ts";

test("isNewer compares semver triples, and refuses to guess on junk", () => {
  expect(isNewer("0.8.1", "0.2.0")).toBe(true);
  expect(isNewer("1.0.0", "0.9.9")).toBe(true);
  expect(isNewer("0.8.1", "0.8.1")).toBe(false);
  expect(isNewer("0.2.0", "0.8.1")).toBe(false);
  expect(isNewer("v0.8.1", "0.2.0")).toBe(true);
  expect(isNewer("latest", "0.2.0")).toBe(false);
  expect(isNewer("0.8.1", "not-a-version")).toBe(false);
});
