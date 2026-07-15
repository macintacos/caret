import { expect, test } from "bun:test";

import { assertInSync, editVersion, extractVersion } from "@/tasks/release/manifest.ts";

// A package.json-shaped fixture: 2-space indent, trailing newline.
const PKG = `{
  "name": "caret",
  "version": "0.0.1",
  "private": true
}
`;

// A marketplace.json-shaped fixture: the only "version" is nested at
// plugins[0].version with 6-space indent.
const MARKETPLACE = `{
  "name": "caret",
  "owner": { "name": "macintacos" },
  "plugins": [
    {
      "name": "caret",
      "version": "0.0.1",
      "source": "./"
    }
  ]
}
`;

test("extractVersion reads the single root version key", () => {
  expect(extractVersion(PKG)).toBe("0.0.1");
});

test("extractVersion reads the single nested version key", () => {
  expect(extractVersion(MARKETPLACE)).toBe("0.0.1");
});

test("extractVersion throws when there is no version key", () => {
  expect(() => extractVersion(`{ "name": "caret" }`)).toThrow();
});

test("extractVersion throws when there is more than one version key", () => {
  const two = `{ "version": "1.0.0", "dep": { "version": "2.0.0" } }`;
  expect(() => extractVersion(two)).toThrow();
});

test("editVersion changes only the value, preserving 2-space formatting", () => {
  const expected = `{
  "name": "caret",
  "version": "0.1.0",
  "private": true
}
`;
  expect(editVersion(PKG, "0.0.1", "0.1.0")).toBe(expected);
});

test("editVersion preserves 6-space nested indentation and key order", () => {
  const out = editVersion(MARKETPLACE, "0.0.1", "0.1.0");
  expect(out).toBe(MARKETPLACE.replace(`"version": "0.0.1"`, `"version": "0.1.0"`));
  // The only delta is the value: byte length differs only by the version change.
  expect(out.endsWith("\n")).toBe(true);
});

test("editVersion throws when the old version is not present (already bumped)", () => {
  expect(() => editVersion(PKG, "9.9.9", "0.1.0")).toThrow();
});

test("editVersion throws when the old version matches more than once", () => {
  const two = `{ "version": "0.0.1", "dep": { "version": "0.0.1" } }`;
  expect(() => editVersion(two, "0.0.1", "0.1.0")).toThrow();
});

test("assertInSync returns the common version when all match", () => {
  expect(
    assertInSync([
      { file: "package.json", version: "0.0.1" },
      { file: "plugin.json", version: "0.0.1" },
      { file: "marketplace.json", version: "0.0.1" },
    ]),
  ).toBe("0.0.1");
});

test("assertInSync throws on drift and names the offenders", () => {
  expect(() =>
    assertInSync([
      { file: "package.json", version: "0.0.1" },
      { file: "plugin.json", version: "0.0.2" },
    ]),
  ).toThrow(/0\.0\.2/);
});
