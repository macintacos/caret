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
  const prefix = parent === "" ? "" : `${parent}/`;
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
  if (treePath === "") return rootPath;
  return rootPath === "" ? treePath : `${rootPath}/${treePath}`;
}
