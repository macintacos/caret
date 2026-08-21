// Path arithmetic for the folder popover (EXC-918), kept out of the component so
// it is unit-testable without a tree, a shadow root, or a daemon.
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
 * The box the card must stay inside: the viewport, less the docked preview lane
 * (EXC-1129).
 *
 * The lane is a full-edge strip, so "clear of the lane" is exactly the viewport
 * narrowed — a right dock caps the width at the lane's left edge, a bottom dock
 * caps the height at its top. That means `anchorCard` needs no new concept: its
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
   * card is the retry. */
  fail(treePath: string): void;
  /** The row's note, or null when it has nothing to add. */
  note(row: LevelRow): LevelNote | null;
}

export function createLevels(): Levels {
  const loaded = new Set<string>();
  const pending = new Set<string>();
  const skipped = new Set<string>();
  const failed = new Set<string>();
  const elided = new Map<string, number>();

  const join = (parent: string, name: string) => (parent === "" ? name : `${parent}/${name}`);

  return {
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
      return levelPaths(key, listing.entries);
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
  };
}
