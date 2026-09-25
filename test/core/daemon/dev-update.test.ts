import { expect, test } from "bun:test";

import { devUpdateIdentity, type SourceGit } from "@/daemon/dev-update.ts";

const BUILT = { install: "dev", version: "1.0.2", commit: "abc1234" } as const;
const OLD_TRUNK = "e".repeat(40);

/** A checkout with four release tags (plus an rc and a non-release tag) and a trunk. */
const git: SourceGit = (args) => {
  if (args[0] === "tag") return "v1.0.2\nv1.0.1\nv1.0.1-rc.1\nv1.0.0\nlatest\nv0.14.0\nv0.13.0";
  if (args[0] === "rev-parse") return OLD_TRUNK;
  return null;
};

test("a non-dev build never poses, whatever the variable says", () => {
  expect(devUpdateIdentity("release", { ...BUILT, install: "bundle" }, git)).toBe(null);
  expect(devUpdateIdentity("commit", { ...BUILT, install: "binary" }, git)).toBe(null);
});

test("a dev build judges itself when the variable is unset or unrecognized", () => {
  expect(devUpdateIdentity(undefined, BUILT, git)).toBe(null);
  expect(devUpdateIdentity("", BUILT, git)).toBe(null);
  expect(devUpdateIdentity("releases", BUILT, git)).toBe(null);
});

test("release: a bundle three releases back, skipping tags that aren't releases", () => {
  expect(devUpdateIdentity("release", BUILT, git)).toEqual({
    install: "bundle",
    version: "0.14.0",
    commit: BUILT.commit,
  });
});

test("commit: a binary built at an older trunk commit", () => {
  expect(devUpdateIdentity("commit", BUILT, git)).toEqual({
    install: "binary",
    version: BUILT.version,
    commit: OLD_TRUNK,
  });
});

test("nothing to pose as — too few tags, or no trunk ref — leaves the build as is", () => {
  const bare: SourceGit = (args) => (args[0] === "tag" ? "v1.0.2\nv1.0.1" : null);
  expect(devUpdateIdentity("release", BUILT, bare)).toBe(null);
  expect(devUpdateIdentity("commit", BUILT, bare)).toBe(null);
});
