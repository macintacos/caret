// Everything the folder popover (EXC-918) knows that is not a rune: the path
// arithmetic, the card's per-level bookkeeping, what a dismissed card leaves
// behind for the next time it is opened (EXC-1138), and what a re-read of the
// levels it has open makes of that (EXC-1139). All of it is kept out of the
// component so it is unit-testable without a tree, a shadow root, or a daemon.
//
// Two coordinate systems meet here and are easy to confuse. @pierre/trees is
// path-first and models the popover's tree ROOTED AT the referenced directory, so
// its paths are relative to that directory — "lib/util.ts" under a card opened on
// `src`. The daemon's /dir route speaks the review's CWD, so the same file is
// "src/lib/util.ts" there. `levelPaths` builds the first vocabulary from a served
// level; `cwdPath` converts a row back into the second to ask for the next one.

import type { DirEntry, DirListing } from "@core/lib/types";
import type { DrawerEdge } from "$lib/fileDrawer.ts";

/**
 * A path the tree reported, reduced to the single spelling this module and the
 * card index by.
 *
 * The slash is the whole reason this exists. @pierre/trees reads a trailing slash
 * as "this path is a directory" on the way in, and materializes a directory's
 * path with that same slash on the way out — so a row reports `references/` for
 * the directory `levelPaths` fed it as `references/`. Used raw, that string is a
 * second spelling of one directory: prefixing the next level with it yields
 * `references//x.md`, and every `loaded` / `skipped` / `elidedBy` lookup misses,
 * so the level is fetched again and lands somewhere nothing will look for it.
 */
export function treeKey(path: string): string {
  return path.replace(/\/+$/, "");
}

/**
 * One served level as the tree-relative path strings @pierre/trees takes, under
 * the tree-relative directory `parent` ("" for the card's own root).
 *
 * A directory carries a trailing slash and a file does not. That is load-bearing
 * rather than tidy: `normalizeInputPath` reads the slash as "this path IS a
 * directory", and a lazily-loaded folder has no children yet to imply it — so
 * without the slash an unopened folder would join the tree as a file, with no
 * chevron and nothing to expand.
 */
export function levelPaths(parent: string, entries: readonly DirEntry[]): string[] {
  const base = treeKey(parent);
  const prefix = base === "" ? "" : `${base}/`;
  return entries.map((e) => `${prefix}${e.name}${e.kind === "directory" ? "/" : ""}`);
}

/**
 * The cwd-relative path the /dir route's `path` parameter wants for a tree row:
 * the card's root as the daemon itself reported it (`DirListing.path`) joined
 * with the row's tree-relative path. An empty `treePath` asks for the root.
 *
 * The empty-`rootPath` case is a review whose cwd is the referenced directory:
 * the daemon reports that listing's path as "", and joining naively would yield
 * a leading "/" — an absolute path, which `resolveInCwd` refuses outright.
 */
export function cwdPath(rootPath: string, treePath: string): string {
  const rel = treeKey(treePath);
  if (rel === "") return rootPath;
  return rootPath === "" ? rel : `${rootPath}/${rel}`;
}

/** The gap between a reference and the card it opens, in px. */
const ANCHOR_GAP = 6;

/** How close to a viewport edge the card may sit, in px. */
export const CARD_MARGIN = 12;

/**
 * The open preview lane as `cardBounds` wants it: its docked edge, and the inner
 * edge the card must stay clear of, in viewport coordinates.
 *
 * Arithmetic rather than the lane's own rect because the rect lies while the
 * lane is opening. FileDrawer wipes in from `width: 0` over `--dur-enter`, so a
 * lane measured in that window reports a sliver and narrows nothing — which is
 * exactly the instant a file opened FROM the card (EXC-1137) is measured at. Its
 * DOCKED edge is the flex surface's own and does not move through the wipe (the
 * same invariant FileDrawer's own drag math leans on), so the settled inner edge
 * is that edge less the size the lane is animating toward.
 *
 * `settledSize` is FileDrawer's inline `--fd-size`, which it always sets;
 * non-finite falls back to the rect's own extent, which is right for a settled
 * lane and is what the card measured before this existed.
 */
export function laneEdge(
  edge: DrawerEdge,
  rect: { top: number; right: number; bottom: number; left: number },
  settledSize: number,
): { edge: DrawerEdge; top: number; left: number } {
  const drawn = edge === "right" ? rect.right - rect.left : rect.bottom - rect.top;
  const size = Number.isFinite(settledSize) ? settledSize : drawn;
  return edge === "right"
    ? { edge, top: rect.top, left: rect.right - size }
    : { edge, top: rect.bottom - size, left: rect.left };
}

/**
 * The box the card must stay inside: the viewport, less the docked preview lane
 * (EXC-1129).
 *
 * The lane is a full-edge strip of the plan surface, so "clear of the lane" is
 * exactly the viewport narrowed — a right dock caps the width at the lane's left
 * edge, a bottom dock caps the height at its top. Narrowing the whole viewport
 * that way is exact where the card can actually land and merely conservative
 * above the surface, which is a band no plan token anchors into. That means
 * `anchorCard` needs no new concept: its
 * third argument already means "the box to stay inside", and this is that box
 * with one dimension short. Containment still wins over clearing when the two
 * conflict, because `anchorCard`'s margin floors put a card too large for the
 * narrowed box back at the real viewport's margin rather than off-screen.
 */
export function cardBounds(
  viewport: { width: number; height: number },
  lane: { edge: DrawerEdge; top: number; left: number } | undefined,
): { width: number; height: number } {
  if (lane === undefined) return viewport;
  return lane.edge === "right"
    ? { width: lane.left, height: viewport.height }
    : { width: viewport.width, height: lane.top };
}

/**
 * Where the viewport-fixed card sits when opened from `anchor`: hanging below it
 * when there is room, flipped above when there is not, and always inside `bounds`
 * by `margin`. Measured once, at open — the card is dismissed by the next click
 * or Escape, so it does not track the plan scrolling underneath it.
 *
 * `bounds` is the viewport, or the viewport less an open preview lane per
 * `cardBounds`. The top clamp is what covers a box too short for the card either
 * way: the flip lands at the margin and the tree pages inside itself, rather than
 * the card starting off-screen with its header out of reach.
 */
export function anchorCard(
  anchor: { top: number; bottom: number; left: number },
  card: { width: number; height: number },
  bounds: { width: number; height: number },
  margin: number,
): { top: number; left: number } {
  const below = anchor.bottom + ANCHOR_GAP;
  const top =
    below + card.height + margin <= bounds.height
      ? below
      : Math.max(margin, anchor.top - ANCHOR_GAP - card.height);
  const left = Math.min(
    Math.max(margin, anchor.left),
    Math.max(margin, bounds.width - card.width - margin),
  );
  return { top, left };
}

/** The slice of a tree row `createLevels` reads. @pierre/trees' own
 * `FileTreeVisibleRow` satisfies it structurally, so the card passes rows
 * straight through and a test builds plain objects. */
export interface LevelRow {
  kind: "directory" | "file";
  path: string;
  isExpanded: boolean;
}

/** What a directory row says beyond its name, in the shape the library's
 * `renderRowDecoration` returns. */
export interface LevelNote {
  text: string;
}

/**
 * The card's per-level bookkeeping: which levels have arrived, which are in
 * flight, which the daemon declines to enumerate, which refused, and how many
 * rows each one elided. Every key is a `treeKey` — the trailing-slash-free
 * spelling — so a row's own path and a path built from a parent agree.
 *
 * This is a factory over its own closed-over sets rather than logic inside the
 * component, because it is the part with behaviour worth pinning: the decision
 * of what to fetch, and what a row is allowed to claim about itself.
 */
export interface Levels {
  /**
   * The expanded directories whose level nobody has asked for, marked in flight
   * so a second call before the fetch lands returns nothing.
   *
   * `claim` is deliberately not idempotent — calling it IS taking the work.
   */
  claim(rows: Iterable<LevelRow>): string[];
  /** Fold in a served level; returns the tree paths to add for it. `""` records
   * the card's own root. */
  record(treePath: string, listing: DirListing): string[];
  /** Mark a level the daemon refused. Terminal for this card: `claim` will not
   * offer it again, because the route answers a permanent refusal (a descent
   * past its depth guard) with the same 404 as a transient one. Reopening the
   * card is the retry, as is a refresh — both go through `reset`, which clears
   * this. */
  fail(treePath: string): void;
  /** The row's note, or null when it has nothing to add. */
  note(row: LevelRow): LevelNote | null;
  /** Everything the daemon actually answered, in a shape that outlives the card
   * (§ LevelsSnapshot). */
  snapshot(): LevelsSnapshot;
  /**
   * Re-seed this instance from `snapshot`, discarding what it held — what a
   * refresh does with the levels it just re-read (EXC-1139).
   *
   * In place, and that is the whole point of the method existing: the card's
   * tree effect captures its `Levels` BY VALUE, so its teardown cannot file this
   * card's memory under the next card's reference. A refresh that rebound the
   * variable instead would leave that teardown filing the pre-refresh card, and
   * the cache would disagree with the tree the reader is looking at.
   *
   * `pending` and `failed` start empty, exactly as construction leaves them: a
   * refresh re-asks for every level the reader has open, so a request from
   * before it has nothing left to say.
   */
  reset(snapshot?: LevelsSnapshot): void;
}

/**
 * One card's served state, flattened so it can be handed back to
 * `createLevels` after the card that accumulated it is gone.
 *
 * It carries `loaded`, `skipped` and `elided` — what the daemon answered — and
 * `paths`, the tree paths those levels produced, which is the set a restored
 * card is CONSTRUCTED from rather than adding one level at a time.
 *
 * `failed` and `pending` are deliberately absent, for the same reason in both
 * cases: the level never arrived. A refusal is terminal for a card and
 * reopening is its documented retry, so caching one would take that retry away;
 * a level still in flight has nothing to cache and finishes loading after the
 * restore.
 */
export interface LevelsSnapshot {
  paths: readonly string[];
  loaded: readonly string[];
  skipped: readonly string[];
  elided: readonly (readonly [string, number])[];
}

export function createLevels(snapshot?: LevelsSnapshot): Levels {
  let paths: string[];
  let loaded: Set<string>;
  let pending: Set<string>;
  let skipped: Set<string>;
  let failed: Set<string>;
  let elided: Map<string, number>;

  // One seeding path for both entry points, so a reset instance is
  // indistinguishable from one constructed with the same snapshot.
  function seed(from?: LevelsSnapshot): void {
    paths = [...(from?.paths ?? [])];
    loaded = new Set(from?.loaded);
    pending = new Set();
    skipped = new Set(from?.skipped);
    failed = new Set();
    elided = new Map(from?.elided);
  }
  seed(snapshot);

  const join = (parent: string, name: string) => (parent === "" ? name : `${parent}/${name}`);

  return {
    reset: seed,
    claim(rows) {
      const claimed: string[] = [];
      for (const row of rows) {
        if (row.kind !== "directory" || !row.isExpanded) continue;
        const key = treeKey(row.path);
        if (loaded.has(key) || pending.has(key) || skipped.has(key) || failed.has(key)) continue;
        pending.add(key);
        claimed.push(key);
      }
      return claimed;
    },
    record(treePath, listing) {
      const key = treeKey(treePath);
      pending.delete(key);
      loaded.add(key);
      for (const e of listing.entries) {
        if (e.skipped === true) skipped.add(join(key, e.name));
      }
      // `total` counts the level before the daemon's cap, so the difference is
      // exactly what it dropped.
      const dropped = listing.total - listing.entries.length;
      if (dropped > 0) elided.set(key, dropped);
      const added = levelPaths(key, listing.entries);
      paths.push(...added);
      return added;
    },
    fail(treePath) {
      const key = treeKey(treePath);
      pending.delete(key);
      failed.add(key);
    },
    note(row) {
      if (row.kind !== "directory") return null;
      const key = treeKey(row.path);
      // At most one applies, and the order is the precedence: a skipped
      // directory is never fetched, so it can neither fail nor elide, and a
      // failed one never recorded a count to report.
      //
      // The skipped note waits for the row to be opened. Before that the row is
      // an ordinary folder, and saying "not listed" up front would read as a
      // warning about a directory nobody asked to see.
      if (skipped.has(key)) return row.isExpanded ? { text: "not listed" } : null;
      if (failed.has(key)) return { text: "couldn't load" };
      const dropped = elided.get(key);
      return dropped === undefined ? null : { text: `+${dropped} more` };
    },
    snapshot() {
      return {
        paths: [...paths],
        loaded: [...loaded],
        skipped: [...skipped],
        elided: [...elided],
      };
    },
  };
}

/**
 * What a dismissed card leaves behind, so reopening the same reference puts the
 * reader back where they were rather than at a collapsed root.
 *
 * Session-lived and in memory only — see `createFolderMemory`.
 */
export interface FolderCardMemory {
  /** The daemon's own path for the card's root (`DirListing.path`), which every
   * deeper request is built from. */
  rootPath: string;
  /** What the ROOT level's cap dropped, which is the header's line. A nested
   * level reports its own on its row, out of `levels`. */
  elided: number;
  levels: LevelsSnapshot;
  /** The open directories, spelled exactly as the tree reported them — the
   * library normalizes the trailing slash on the way back in. */
  expanded: readonly string[];
  /** The row that was at the top of the list, or undefined when the card had no
   * rows at all. */
  topPath: string | undefined;
}

/**
 * One live card reduced to what survives it: the levels it was served, the
 * folders the reader had open, and the row they had at the top.
 *
 * The top row is row-granular because it has to be. @pierre/trees exposes no
 * scroll offset — only `scrollToPath(path, { offset })` — so the anchor is a
 * path, recovered here from the scroller's own pixels.
 *
 * There is one way for that to be wrong and it degrades quietly: a card whose
 * scroller the component never found reports `scrollTop: 0`, which names the
 * first row and brings the card back at the top with its expansion intact. The
 * arithmetic's own guards are for shapes the component cannot produce today
 * (`getItemHeight()` is the configured row height, always) and cost nothing.
 */
export function captureCard(card: {
  rootPath: string;
  levels: Levels;
  rows: readonly LevelRow[];
  scrollTop: number;
  itemHeight: number;
}): FolderCardMemory {
  const levels = card.levels.snapshot();
  return {
    rootPath: card.rootPath,
    elided: rootElision(levels),
    levels,
    expanded: card.rows.filter((r) => r.kind === "directory" && r.isExpanded).map((r) => r.path),
    topPath: card.rows[Math.max(0, Math.floor(card.scrollTop / card.itemHeight))]?.path,
  };
}

/** The root's key is `""`, the same spelling `record` files it under. */
function rootElision(levels: LevelsSnapshot): number {
  return levels.elided.find(([key]) => key === "")?.[1] ?? 0;
}

/**
 * What a refresh's answers make of the card (EXC-1139): the re-read levels
 * folded into one snapshot, with the reader's expansion and their place in the
 * list carried across.
 *
 * `answers` are `[treePath, listing]` pairs for the levels the card had OPEN —
 * its own root first, then each expanded directory, PARENTS BEFORE CHILDREN.
 * The caller gets that ordering for free by reading the open set off the tree's
 * visible rows, which the library reports in tree order. Either spelling of a
 * directory is accepted; the fold reduces each one the way `record` does.
 *
 * Three rules make it total against a working copy that moved underneath the
 * reader, and each is one of the issue's own criteria:
 *
 * - A level whose directory is not among the paths recorded so far is dropped.
 *   The daemon answers each open level independently, so a level under a
 *   directory that has since gone can still come back; folding it in would
 *   leave paths the library has to invent a parent for.
 * - `expanded` keeps the directories the refresh can honestly show as open: the
 *   ones whose level came back, plus the ones the daemon declines to enumerate,
 *   which never enter `loaded` because nothing ever enumerated them. A folder
 *   that vanished — or whose re-read the daemon refused — returns shut rather
 *   than open with nothing under it, which is also what makes clicking it the
 *   retry.
 * - `topPath` survives only while its row does, and otherwise degrades to the
 *   top of the list — the same quiet miss `captureCard` documents for a card
 *   whose scroller was never found.
 */
export function refreshCard(
  before: FolderCardMemory,
  answers: Iterable<readonly [treePath: string, listing: DirListing]>,
): FolderCardMemory {
  const levels = createLevels();
  const known = new Set<string>();
  for (const [answered, listing] of answers) {
    const treePath = treeKey(answered);
    if (treePath !== "" && !known.has(`${treePath}/`)) continue;
    for (const path of levels.record(treePath, listing)) known.add(path);
  }
  const snapshot = levels.snapshot();
  const mayStayOpen = new Set([...snapshot.loaded, ...snapshot.skipped]);
  return {
    rootPath: before.rootPath,
    elided: rootElision(snapshot),
    levels: snapshot,
    expanded: before.expanded.filter((path) => mayStayOpen.has(treeKey(path))),
    topPath: before.topPath !== undefined && known.has(before.topPath) ? before.topPath : undefined,
  };
}

/**
 * Every folder card the reader has been in, keyed on the pair (review, folder
 * reference) — two references in one review each keep their own state.
 *
 * One instance belongs to one review, because a cached tree belongs to one
 * review's cwd and the 2s poll can swap the review under a reader who left a
 * card open. DiffPlanView owns the instance and REPLACES it on a switch, which
 * is what makes the drop total rather than nearly so: dismissing the open card
 * is what files its memory, and that happens after the switch has already run —
 * a map merely emptied in place would be handed the outgoing card a moment
 * later, whereas a discarded instance takes that write with it.
 *
 * The review still rides the key, so the seam between the two components cannot
 * produce a wrong restore even if the swap were ever mis-wired.
 *
 * A plain `Map` and never `localStorage`: the memory is session-lived by
 * construction, so a reload starts the reader fresh.
 *
 * **Nothing invalidates a record on its own.** A directory that changes while
 * its card is closed is not re-read for the life of that review — which is a
 * real change from "every open refetches", in an app whose whole subject is an
 * agent writing files. It is the deliberate shape: staleness is the reader's
 * call, and the card's refresh control is where they make it (`refreshCard`).
 */
export interface FolderMemory {
  read(reviewId: string, path: string): FolderCardMemory | undefined;
  write(reviewId: string, path: string, card: FolderCardMemory): void;
}

export function createFolderMemory(): FolderMemory {
  const cards = new Map<string, FolderCardMemory>();
  // A space, because `newReviewId` is base64url and so cannot contain one — the
  // first space in a key is therefore always the separator, whatever the path.
  const key = (reviewId: string, path: string) => `${reviewId} ${path}`;
  return {
    read: (reviewId, path) => cards.get(key(reviewId, path)),
    write(reviewId, path, card) {
      cards.set(key(reviewId, path), card);
    },
  };
}
