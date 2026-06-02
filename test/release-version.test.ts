import { expect, test } from "bun:test";
import {
  type BumpLevel,
  isBumpLevel,
  nextVersion,
  tagName,
  versionFromTag,
} from "../scripts/release/version.ts";

test("nextVersion bumps patch/minor/major from the baseline", () => {
  expect(nextVersion("0.0.1", "patch")).toBe("0.0.2");
  expect(nextVersion("0.0.1", "minor")).toBe("0.1.0");
  expect(nextVersion("0.0.1", "major")).toBe("1.0.0");
});

test("nextVersion resets lower components like semver", () => {
  expect(nextVersion("1.2.3", "minor")).toBe("1.3.0");
  expect(nextVersion("1.2.3", "major")).toBe("2.0.0");
  expect(nextVersion("1.2.3", "patch")).toBe("1.2.4");
});

test("nextVersion throws on an invalid current version", () => {
  expect(() => nextVersion("not-a-version", "patch")).toThrow();
  expect(() => nextVersion("1.2", "patch")).toThrow();
});

test("tagName prefixes the version with v", () => {
  expect(tagName("0.1.0")).toBe("v0.1.0");
});

test("versionFromTag strips the leading v", () => {
  expect(versionFromTag("v0.1.0")).toBe("0.1.0");
});

test("versionFromTag rejects a tag without a valid semver body", () => {
  expect(() => versionFromTag("v1.2")).toThrow();
  expect(() => versionFromTag("0.1.0")).toThrow();
});

test("isBumpLevel narrows valid bump arguments", () => {
  expect(isBumpLevel("patch")).toBe(true);
  expect(isBumpLevel("minor")).toBe(true);
  expect(isBumpLevel("major")).toBe(true);
  expect(isBumpLevel("foo")).toBe(false);
  expect(isBumpLevel("")).toBe(false);
  const value: string = "major";
  if (isBumpLevel(value)) {
    const narrowed: BumpLevel = value;
    expect(narrowed).toBe("major");
  }
});
