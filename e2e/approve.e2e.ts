// Approve: approving resolves the review — observable in the UI (the review
// leaves the pending set) and via the API (the list no longer carries it).

import { expect, test } from "./support/fixtures.ts";

test("approving resolves the review in UI and API", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator("article.plan h1")).toBeVisible();

  // Primary approve button ("Approve" in the remembered default mode); exact
  // match so the split-toggle's "Approve options" doesn't collide.
  await page.getByRole("button", { name: "Approve", exact: true }).click();

  // UI: the pending set is empty.
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();

  // API: GET /api/reviews no longer lists the id (an allow removes the review
  // from the pending set).
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
});
