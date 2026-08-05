import { expect, test } from "bun:test";

import type { DirEntry } from "@core/lib/types";
import { cwdPath, levelPaths } from "$lib/folderTree.ts";

// The two bits of path arithmetic the folder popover stands on: turning one
// daemon-served level into the path strings @pierre/trees models a tree from,
// and turning a row in that tree back into the cwd-relative path the /dir route
// wants. Both are pure, so they are pinned here rather than through the card.

const dir = (name: string): DirEntry => ({ name, kind: "directory" });
const file = (name: string): DirEntry => ({ name, kind: "file" });

test("gives a directory a trailing slash and a file none", () => {
  // The slash is not cosmetic: normalizeInputPath is what tells @pierre/trees a
  // path is a directory, and a lazily-loaded folder has no children yet to imply
  // it. Without the slash an unopened folder would arrive as a file and there
  // would be nothing to expand.
  expect(levelPaths("", [dir("lib"), file("index.ts")])).toEqual(["lib/", "index.ts"]);
});

test("roots the first level directly, with no leading separator", () => {
  expect(levelPaths("", [file("README.md")])).toEqual(["README.md"]);
});

test("prefixes a nested level with its parent", () => {
  expect(levelPaths("lib", [dir("deep"), file("util.ts")])).toEqual(["lib/deep/", "lib/util.ts"]);
});

test("prefixes a level several parents down", () => {
  expect(levelPaths("lib/deep", [file("x.ts")])).toEqual(["lib/deep/x.ts"]);
});

test("returns nothing for an empty level", () => {
  expect(levelPaths("lib", [])).toEqual([]);
});

test("asks for the root itself with the root's own path", () => {
  expect(cwdPath("src/lib", "")).toBe("src/lib");
});

test("joins a row's tree path onto the root", () => {
  expect(cwdPath("src/lib", "deep")).toBe("src/lib/deep");
});

test("joins a row several levels down", () => {
  expect(cwdPath("src/lib", "deep/deeper")).toBe("src/lib/deep/deeper");
});

test("addresses a row under the cwd itself without a leading separator", () => {
  // The daemon reports the cwd's own listing path as "", so a naive join would
  // produce "/src" — an absolute path, which resolveInCwd refuses outright.
  expect(cwdPath("", "src")).toBe("src");
});

test("addresses the cwd itself as the empty path", () => {
  expect(cwdPath("", "")).toBe("");
});
