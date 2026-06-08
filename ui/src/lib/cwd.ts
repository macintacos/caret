// Working-directory display helper. Pure TS (no DOM/node imports) so it stays
// node-free and unit-testable.

/**
 * Abbreviates a cwd for display: a path of two or fewer segments is shown in
 * full; a deeper path collapses to `…/<parent>/<leaf>` (its last two segments).
 */
export function shortCwd(cwd: string): string {
  const parts = cwd.split("/").filter(Boolean);
  return parts.length <= 2 ? cwd : `…/${parts.slice(-2).join("/")}`;
}
