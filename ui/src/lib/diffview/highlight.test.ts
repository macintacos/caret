import { expect, test } from "bun:test";

import { highlightExcerpt } from "$lib/diffview/highlight.ts";
import { THEMES } from "$lib/theme.ts";

// Thin glue over shiki; the full visual render is covered by e2e. These pin the
// contract: highlighted HTML for a known grammar, plain fallback otherwise.
test("returns shiki HTML for a known grammar, preserving the code text", async () => {
  const html = await highlightExcerpt("const x = 1;", "typescript", "caret-dark");
  expect(html).toContain("<pre");
  expect(html).toContain("const");
});

test("falls back to plain text for an unknown grammar (still renders the code)", async () => {
  const html = await highlightExcerpt("hello world", "not-a-real-lang", "caret-light");
  expect(html).toContain("hello world");
});

// The excerpt popover opens over the plan view, so it has to read as the same
// palette — a vendor theme's excerpt is highlighted in that theme (EXC-752), not
// in caret's colors at the matching scheme.
test("highlights the excerpt in the named theme", async () => {
  const html = await highlightExcerpt("const x = 1;", "typescript", "dracula");
  expect(html).toContain(THEMES.dracula.tokens["--paper-sunk"]);
});
