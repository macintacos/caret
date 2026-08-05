import { expect, test } from "bun:test";

import type { DirEntry } from "@core/lib/types";
import { anchorCard, cwdPath, levelPaths, treeKey } from "$lib/folderTree.ts";

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

// The library reports a directory row's path with the SAME trailing slash it
// takes on input — "references/" goes in and "references/" comes back — so a row
// path used raw is a second spelling of the same directory. Both conversions
// below take a row path directly, so both have to reduce it, or a level lands
// under "references//" and every bookkeeping key misses.
test("reduces a reported directory path to its key form", () => {
  expect(treeKey("references/")).toBe("references");
});

test("leaves a path with no trailing slash alone", () => {
  expect(treeKey("references")).toBe("references");
});

test("reduces the tree's own root to the empty key", () => {
  expect(treeKey("/")).toBe("");
});

test("prefixes a level under a parent reported with its trailing slash", () => {
  expect(levelPaths("lib/", [file("util.ts")])).toEqual(["lib/util.ts"]);
});

test("addresses a row reported with its trailing slash", () => {
  expect(cwdPath("src/lib", "deep/")).toBe("src/lib/deep");
});

// Placing the card. The reference it opens from can sit anywhere in the plan,
// including hard against an edge, so the flip and both clamps are arithmetic
// worth pinning without a layout engine.
const VIEWPORT = { width: 1000, height: 800 };
const CARD = { width: 400, height: 300 };

test("hangs the card below its reference when there is room", () => {
  expect(anchorCard({ top: 100, bottom: 120, left: 200 }, CARD, VIEWPORT, 16)).toEqual({
    top: 126,
    left: 200,
  });
});

test("flips the card above a reference too near the bottom", () => {
  // Below would put the card's foot at 726 + 300, well past the viewport.
  expect(anchorCard({ top: 700, bottom: 720, left: 200 }, CARD, VIEWPORT, 16)).toEqual({
    top: 394,
    left: 200,
  });
});

test("pulls the card back inside when its reference sits near the right edge", () => {
  expect(anchorCard({ top: 100, bottom: 120, left: 900 }, CARD, VIEWPORT, 16).left).toBe(584);
});

test("keeps the card off the left edge by the margin", () => {
  expect(anchorCard({ top: 100, bottom: 120, left: 2 }, CARD, VIEWPORT, 16).left).toBe(16);
});

test("parks the card at the top margin when it fits neither below nor above", () => {
  // A viewport shorter than the card: the flip has nowhere to go either, so the
  // card starts at the margin and pages inside itself rather than off-screen.
  expect(
    anchorCard({ top: 150, bottom: 170, left: 20 }, CARD, { width: 1000, height: 260 }, 16).top,
  ).toBe(16);
});
