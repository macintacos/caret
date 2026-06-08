// First paint: the plan renders before the shiki highlighter finishes building.
//
// main.ts kicks off initHighlighter() OFF the critical path, so the app mounts
// and paints the plan immediately (plain <pre> for code), then repaints the
// code block with syntax highlighting once shiki is ready. This spec proves the
// ordering: the plan body is visible first, and the shiki-highlighted <pre>
// (`pre.shiki`) arrives afterward via the repaint — it cannot have gated the
// first paint.

import { expect, test } from "./support/fixtures.ts";

test("plan paints before shiki highlighting is ready", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");

  const article = page.locator("article.plan");

  // First paint: the plan heading and body are on screen.
  await expect(
    article.getByRole("heading", { name: "Widget Cache Refactor", level: 1 }),
  ).toBeVisible();
  await expect(article.getByText("warm copy of each manifest")).toBeVisible();

  // The fixture's language-tagged code block is present from the first paint
  // (as a plain <pre>, since the highlighter is still building).
  await expect(article.locator("pre")).toBeVisible();

  // After the off-critical-path init resolves, the code block repaints with
  // shiki's dual-theme highlighting (`pre.shiki` with per-token CSS variables).
  // Its arrival AFTER the heading/body proves it did not gate first paint.
  const shiki = article.locator("pre.shiki");
  await expect(shiki).toBeVisible();
  // A repaint with real highlighting emits the per-token --shiki-light variable
  // on at least one token span.
  await expect
    .poll(() => shiki.evaluate((el) => el.innerHTML.includes("--shiki-light:")))
    .toBe(true);
});
