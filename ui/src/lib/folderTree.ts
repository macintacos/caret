// Path arithmetic for the folder popover (EXC-918), kept out of the component so
// it is unit-testable without a tree, a shadow root, or a daemon.
//
// Two coordinate systems meet here and are easy to confuse. @pierre/trees is
// path-first and models the popover's tree ROOTED AT the referenced directory, so
// its paths are relative to that directory — "lib/util.ts" under a card opened on
// `src`. The daemon's /dir route speaks the review's CWD, so the same file is
// "src/lib/util.ts" there. `levelPaths` builds the first vocabulary from a served
// level; `cwdPath` converts a row back into the second to ask for the next one.

import type { DirEntry } from "@core/lib/types";

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

/**
 * Where the viewport-fixed card sits when opened from `anchor`: hanging below it
 * when there is room, flipped above when there is not, and always inside the
 * viewport by `margin`. Measured once, at open — the card is dismissed by the
 * next click or Escape, so it does not track the plan scrolling underneath it.
 *
 * The top clamp is what covers a viewport too short for the card either way: the
 * flip lands at the margin and the tree pages inside itself, rather than the card
 * starting off-screen with its header out of reach.
 */
export function anchorCard(
  anchor: { top: number; bottom: number; left: number },
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  margin: number,
): { top: number; left: number } {
  const below = anchor.bottom + ANCHOR_GAP;
  const top =
    below + card.height + margin <= viewport.height
      ? below
      : Math.max(margin, anchor.top - ANCHOR_GAP - card.height);
  const left = Math.min(
    Math.max(margin, anchor.left),
    Math.max(margin, viewport.width - card.width - margin),
  );
  return { top, left };
}
