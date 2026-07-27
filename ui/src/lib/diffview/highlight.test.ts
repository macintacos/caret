import { expect, test } from "bun:test";

import { highlightExcerpt } from "$lib/diffview/highlight.ts";

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
// in caret's colors at the matching scheme. Pinned on Dracula's own pink keyword
// (EXC-896) rather than on a caret hue: caret's named color set carries no pink at
// all, so only the upstream theme can put it in the HTML.
test("highlights the excerpt in the named theme", async () => {
  const html = await highlightExcerpt("const x = 1;", "typescript", "dracula");
  expect(html.toLowerCase()).toContain("#ff79c6");
});
