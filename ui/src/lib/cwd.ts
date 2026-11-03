// Working-directory display helpers. Pure TS (no DOM/node imports) so it stays
// node-free and unit-testable.

/**
 * Abbreviates a cwd for display: a path of two or fewer segments is shown in
 * full; a deeper path collapses to `…/<parent>/<leaf>` (its last two segments).
 */
export function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts.length <= 2 ? cwd : `…/${parts.slice(-2).join("/")}`;
}

/**
 * Writes `cwd` from `~` when it lies inside `home`, and leaves any other path, or any
 * path when `home` is unknown, as given.
 */
export function homeRelative(cwd: string, home: string | undefined): string {
  const root = home?.replace(/\/+$/, "");
  if (!root) return cwd;
  if (cwd === root) return "~";
  return cwd.startsWith(`${root}/`) ? `~${cwd.slice(root.length)}` : cwd;
}

/**
 * The ways to show `path` in less room, longest first: the whole path, then with one
 * more whole segment after its start given up to `…` each time. The start (`~`, or an
 * absolute path's first directory) and the leaf always stay.
 */
export function middleCuts(path: string): string[] {
  const parts = path.split("/");
  const startLength = parts[0] === "" ? 2 : 1;
  const start = parts.slice(0, startLength).join("/");
  const rest = parts.slice(startLength);
  const cuts = [path];
  for (let drop = 1; drop < rest.length; drop++) {
    cuts.push([start, "…", ...rest.slice(drop)].join("/"));
  }
  return cuts;
}
