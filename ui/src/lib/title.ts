// Post-title display helper. Pure TS (no DOM/node imports) so it stays
// node-free and unit-testable, mirroring shortCwd in ./cwd.ts.

/**
 * Strips inline markdown links from a title, leaving the link text in place:
 * `[EXC-562](https://…)` becomes `EXC-562`. The titlebar renders titles as
 * plain text, so without this a title carrying a link shows its raw markdown
 * syntax (brackets, parens, and the full URL) instead of the readable text.
 */
export function stripTitleLinks(title: string): string {
  return title.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}
