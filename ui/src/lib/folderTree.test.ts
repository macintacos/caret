import { expect, test } from "bun:test";

import type { DirEntry, DirListing } from "@core/lib/types";
import {
  anchorCard,
  captureCard,
  cardBounds,
  createFolderMemory,
  createLevels,
  cwdPath,
  type LevelRow,
  laneEdge,
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

// What `cardBounds` is handed, and the reason it is arithmetic rather than a
// rect: opening a file from the card (EXC-1137) is measured WHILE the lane is
// wiping open, where its rect still reads a sliver and would narrow nothing.
// The docked edge is the surface's own and does not move, so the settled inner
// edge is that one less the size the lane is animating toward.
const MID_WIPE_RIGHT = { top: 60, right: 1000, bottom: 800, left: 996 };
const MID_WIPE_BOTTOM = { top: 796, right: 1000, bottom: 800, left: 0 };

test("a settled lane's inner edge is the edge it already draws at", () => {
  // The EXC-1129 path, unchanged: with the wipe finished the rect's own left edge
  // and `right - size` are the same number, so nothing about the pre-existing
  // directory-reference placement moved.
  expect(laneEdge("right", { top: 60, right: 1000, bottom: 800, left: 640 }, 360)).toEqual({
    edge: "right",
    top: 60,
    left: 640,
  });
});

test("a right-docked lane's inner edge is its right edge less its settled width", () => {
  expect(laneEdge("right", MID_WIPE_RIGHT, 360)).toEqual({ edge: "right", top: 60, left: 640 });
});

test("a bottom-docked lane's inner edge is its bottom edge less its settled height", () => {
  expect(laneEdge("bottom", MID_WIPE_BOTTOM, 300)).toEqual({ edge: "bottom", top: 500, left: 0 });
});

test("without a settled size, the lane is taken at the extent it currently draws", () => {
  // The size comes from FileDrawer's own inline `--fd-size`. Nothing local would
  // say so if that were ever dropped, so the fallback degrades to measuring the
  // rect — right for a settled lane, and never NaN.
  expect(laneEdge("right", MID_WIPE_RIGHT, Number.NaN)).toEqual({
    edge: "right",
    top: 60,
    left: 996,
  });
  expect(laneEdge("bottom", MID_WIPE_BOTTOM, Number.NaN)).toEqual({
    edge: "bottom",
    top: 796,
    left: 0,
  });
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

// The rehydration seam (EXC-1138). A dismissed card leaves its served state
// behind so reopening the same reference rebuilds the tree it had rather than
// refetching it a level at a time. What may be carried is exactly what the
// daemon actually answered: a level it refused, or one still in flight, is left
// out so the reopened card asks again.

/** A `Levels` that has served the root and one level under it, which is the
 * smallest card worth remembering. */
function served(): ReturnType<typeof createLevels> {
  const levels = createLevels();
  levels.record(
    "",
    listing([
      { name: "lib", kind: "directory" },
      { name: "cache.ts", kind: "file" },
    ]),
  );
  levels.record("lib", listing([{ name: "util.ts", kind: "file" }]));
  return levels;
}

test("carries every served path, in the order the levels arrived", () => {
  // The restored card is CONSTRUCTED from these rather than adding them one
  // level at a time, so the whole set has to survive — not just the root's.
  expect(served().snapshot().paths).toEqual(["lib/", "cache.ts", "lib/util.ts"]);
});

test("a rehydrated card asks for nothing it has already been served", () => {
  const levels = createLevels(served().snapshot());
  expect(levels.claim([dirRow("lib/")])).toEqual([]);
});

test("a rehydrated card still asks for a level nobody has opened", () => {
  const levels = createLevels(served().snapshot());
  expect(levels.claim([dirRow("lib/deep/")])).toEqual(["lib/deep"]);
});

test("a rehydrated card keeps what the daemon declined to enumerate", () => {
  const levels = createLevels();
  levels.record("", listing([{ name: "dist", kind: "directory", skipped: true }]));
  const rehydrated = createLevels(levels.snapshot());
  expect(rehydrated.note(dirRow("dist/"))).toEqual({ text: "not listed" });
  expect(rehydrated.claim([dirRow("dist/")])).toEqual([]);
});

test("a rehydrated card keeps what a capped level elided", () => {
  const levels = createLevels();
  levels.record("wide", listing([{ name: "a.ts", kind: "file" }], 9));
  expect(createLevels(levels.snapshot()).note(dirRow("wide/"))).toEqual({ text: "+8 more" });
});

test("a refused level is not carried, so the reopened card retries it", () => {
  // `fail` is terminal for a card, and reopening is its documented retry. A
  // cached refusal would take that retry away for the rest of the session.
  const levels = createLevels();
  levels.fail("deep");
  const rehydrated = createLevels(levels.snapshot());
  expect(rehydrated.note(dirRow("deep/"))).toBeNull();
  expect(rehydrated.claim([dirRow("deep/")])).toEqual(["deep"]);
});

test("a level still in flight is not carried, so the reopened card asks again", () => {
  const levels = createLevels();
  levels.claim([dirRow("lib/")]);
  expect(createLevels(levels.snapshot()).claim([dirRow("lib/")])).toEqual(["lib"]);
});

// What a live tree contributes on top of the served levels: which folders the
// reader had open, and which row they had at the top. The library exposes no
// scroll offset, so the second is recovered from the scroller's own pixels and
// is row-granular by construction.

const scroll = { scrollTop: 0, itemHeight: 22 };

test("remembers the directories that were open and nothing else", () => {
  const card = captureCard({
    rootPath: "src",
    levels: served(),
    rows: [dirRow("lib/"), dirRow("dist/", false), fileRow("cache.ts")],
    ...scroll,
  });
  expect(card.expanded).toEqual(["lib/"]);
});

test("remembers the daemon's own path for the card's root", () => {
  // Every deeper request is built from it, so a restored card that lost it
  // would address the next level relative to nothing.
  expect(captureCard({ rootPath: "src", levels: served(), rows: [], ...scroll }).rootPath).toBe(
    "src",
  );
});

test("remembers what the root level's cap dropped, for the header", () => {
  const levels = createLevels();
  levels.record("", listing([{ name: "a.ts", kind: "file" }], 12));
  expect(captureCard({ rootPath: "src", levels, rows: [], ...scroll }).elided).toBe(11);
});

test("remembers the row the reader had at the top of the list", () => {
  const rows = [fileRow("a.ts"), fileRow("b.ts"), fileRow("c.ts")];
  const card = captureCard({
    rootPath: "src",
    levels: served(),
    rows,
    scrollTop: 45,
    itemHeight: 22,
  });
  expect(card.topPath).toBe("c.ts");
});

test("remembers the first row for an offset of zero", () => {
  // Which is both "never scrolled" and the card's one degrade: a card that never
  // found its scroller inside the library's shadow root reports 0, and the
  // reader gets their expansion back at the top rather than nothing back at all.
  const rows = [fileRow("a.ts"), fileRow("b.ts")];
  expect(captureCard({ rootPath: "src", levels: served(), rows, ...scroll }).topPath).toBe("a.ts");
});

test("remembers no row at all for a row height it cannot divide by", () => {
  // Not reachable from the card — `getItemHeight()` returns the row height it
  // was configured with — but the arithmetic is total rather than trusting that.
  const card = captureCard({
    rootPath: "src",
    levels: served(),
    rows: [fileRow("a.ts")],
    scrollTop: 44,
    itemHeight: 0,
  });
  expect(card.topPath).toBeUndefined();
});

// The registry. Session-lived, in memory, and keyed on the pair — a cached tree
// belongs to one review's cwd and must never be restored over another. Dropping
// one review's cards is the OWNER's job rather than a method here: DiffPlanView
// discards the whole instance, which is what also takes the outgoing card's own
// late write with it.

const memoryOf = (rootPath: string) =>
  captureCard({ rootPath, levels: served(), rows: [], ...scroll });

test("keeps two folder references in one review apart", () => {
  const memory = createFolderMemory();
  memory.write("r1", "src", memoryOf("src"));
  memory.write("r1", "doc", memoryOf("doc"));
  expect(memory.read("r1", "src")?.rootPath).toBe("src");
  expect(memory.read("r1", "doc")?.rootPath).toBe("doc");
});

test("never hands one review's card to another", () => {
  const memory = createFolderMemory();
  memory.write("r1", "src", memoryOf("src"));
  expect(memory.read("r2", "src")).toBeUndefined();
});

test("has nothing for a reference nobody has opened", () => {
  expect(createFolderMemory().read("r1", "src")).toBeUndefined();
});

test("a fresh instance carries nothing over from the last one", () => {
  const before = createFolderMemory();
  before.write("r1", "src", memoryOf("src"));
  expect(createFolderMemory().read("r1", "src")).toBeUndefined();
});
