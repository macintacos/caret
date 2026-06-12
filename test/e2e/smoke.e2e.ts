// Smoke: a seeded plan renders — headings, TOC, and body content visible.

import { expect, test } from "./support/fixtures.ts";

test("a seeded plan renders headings, TOC, and body content", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");

  const article = page.locator("article.plan");
  await expect(
    article.getByRole("heading", { name: "Widget Cache Refactor", level: 1 }),
  ).toBeVisible();
  await expect(article.getByRole("heading", { name: "Background", level: 2 })).toBeVisible();

  // Body paragraph and the shiki-highlighted code block.
  await expect(article.getByText("warm copy of each manifest")).toBeVisible();
  await expect(article.locator("pre")).toBeVisible();

  // The contents rail: hover to expand the panel (it reveals on :hover), then
  // assert the per-heading links.
  const toc = page.getByRole("navigation", { name: "Plan contents" });
  await toc.hover();
  await expect(toc.getByRole("link", { name: "Approach" })).toBeVisible();
  await expect(toc.getByRole("link", { name: "Verification" })).toBeVisible();
});
