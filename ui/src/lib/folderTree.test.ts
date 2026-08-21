import { expect, test } from "bun:test";

import type { DirEntry, DirListing } from "@core/lib/types";
import {
  anchorCard,
  cardBounds,
  createLevels,
  cwdPath,
  type LevelRow,
  levelPaths,
  treeKey,
} from "$lib/folderTree.ts";

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

// The box the card is placed inside (EXC-1129). The preview lane can now sit open
// beside the card, and a card placed against the whole viewport would land under
// it — so the lane narrows the box `anchorCard` already clamps to.
test("with no lane open, the card's bounds are the whole viewport", () => {
  expect(cardBounds(VIEWPORT, undefined)).toEqual(VIEWPORT);
});

test("a right-docked lane caps the bounds at its left edge", () => {
  expect(cardBounds(VIEWPORT, { edge: "right", top: 0, left: 640 })).toEqual({
    width: 640,
    height: 800,
  });
});

test("a bottom-docked lane caps the bounds at its top edge", () => {
  expect(cardBounds(VIEWPORT, { edge: "bottom", top: 500, left: 0 })).toEqual({
    width: 1000,
    height: 500,
  });
});

test("a card too large for the narrowed bounds still lands inside the real viewport", () => {
  // Containment wins over clearing the lane: `anchorCard`'s margin floors put a
  // card wider than the box back at the viewport's own margin, overlapping the
  // lane rather than hanging off-screen where its header is out of reach.
  const bounds = cardBounds(VIEWPORT, { edge: "right", top: 0, left: 300 });
  expect(anchorCard({ top: 100, bottom: 120, left: 200 }, CARD, bounds, 16).left).toBe(16);
});

// The card's per-level bookkeeping. This is where the decisions live — what is
// worth fetching, and what a row is allowed to say about itself — so it is
// pinned here rather than through a mounted card behind a shadow root.

const dirRow = (path: string, isExpanded = true): LevelRow => ({
  kind: "directory",
  path,
  isExpanded,
});
const fileRow = (path: string): LevelRow => ({ kind: "file", path, isExpanded: false });
const listing = (entries: DirEntry[], total = entries.length): DirListing => ({
  path: "src",
  entries,
  total,
});

test("claims an expanded directory whose level has not arrived", () => {
  const levels = createLevels();
  expect(levels.claim([dirRow("lib/")])).toEqual(["lib"]);
});

test("claims nothing for a collapsed directory or a file", () => {
  const levels = createLevels();
  expect(levels.claim([dirRow("lib/", false), fileRow("a.ts")])).toEqual([]);
});

test("does not claim the same level twice while it is in flight", () => {
  // The controller emits on focus and selection as well as expansion, so the
  // walk runs several times per click; only the first may take the work.
  const levels = createLevels();
  expect(levels.claim([dirRow("lib/")])).toEqual(["lib"]);
  expect(levels.claim([dirRow("lib/")])).toEqual([]);
});

test("does not re-claim a level that has arrived", () => {
  const levels = createLevels();
  levels.claim([dirRow("lib/")]);
  levels.record("lib", listing([{ name: "a.ts", kind: "file" }]));
  expect(levels.claim([dirRow("lib/")])).toEqual([]);
});

test("never claims a directory the daemon declines to enumerate", () => {
  const levels = createLevels();
  levels.record("", listing([{ name: "node_modules", kind: "directory", skipped: true }]));
  expect(levels.claim([dirRow("node_modules/")])).toEqual([]);
});

test("does not re-claim a level the daemon refused", () => {
  // The route answers a permanent refusal — a descent past its depth guard —
  // with the same 404 as a transient one, and the walk runs on every emit. So a
  // failed level that stayed claimable would re-ask for the rest of the card's
  // life.
  const levels = createLevels();
  levels.claim([dirRow("deep/")]);
  levels.fail("deep");
  expect(levels.claim([dirRow("deep/")])).toEqual([]);
});

test("records a level as the tree paths to add", () => {
  const levels = createLevels();
  expect(
    levels.record(
      "lib",
      listing([
        { name: "deep", kind: "directory" },
        { name: "a.ts", kind: "file" },
      ]),
    ),
  ).toEqual(["lib/deep/", "lib/a.ts"]);
});

test("says nothing about a directory with nothing to report", () => {
  const levels = createLevels();
  levels.record("", listing([{ name: "lib", kind: "directory" }]));
  expect(levels.note(dirRow("lib/"))).toBeNull();
});

test("says nothing about a file row", () => {
  const levels = createLevels();
  expect(levels.note(fileRow("a.ts"))).toBeNull();
});

test("reports a skipped directory only once it is opened", () => {
  const levels = createLevels();
  levels.record("", listing([{ name: "dist", kind: "directory", skipped: true }]));
  expect(levels.note(dirRow("dist/", false))).toBeNull();
  expect(levels.note(dirRow("dist/"))).toEqual({ text: "not listed" });
});

test("reports a refused level on its own row", () => {
  const levels = createLevels();
  levels.fail("deep");
  expect(levels.note(dirRow("deep/"))).toEqual({ text: "couldn't load" });
});

test("reports how many rows a capped level elided", () => {
  const levels = createLevels();
  levels.record("wide", listing([{ name: "a.ts", kind: "file" }], 9));
  expect(levels.note(dirRow("wide/"))).toEqual({ text: "+8 more" });
});

test("keys a skipped child off its parent, so a row's own path finds it", () => {
  // The two spellings meeting: `record` builds the key from a parent plus a
  // name, `note` reduces the row's reported path. They have to agree.
  const levels = createLevels();
  levels.record("lib/", listing([{ name: ".git", kind: "directory", skipped: true }]));
  expect(levels.note(dirRow("lib/.git/"))).toEqual({ text: "not listed" });
});
