// TopBar narrow-width consolidation (EXC-810). At/below --w-narrow the Reject +
// Request-changes buttons collapse into a "More actions" overflow menu; at/below
// --w-tight the Approve label clips so the primary shrinks to its check icon.
// These are CSS width-driven swaps plus bits-ui overlay interaction — real
// browser behavior, not happy-dom units (doc/agents/browser-testing.md). The
// fixture daemon declares no adapter variants, so Approve renders as the
// split-button (WIRE_FALLBACK set), i.e. .split-primary / .split-toggle.

import { expect, test } from "./support/fixtures.ts";

test("wide: secondaries are inline and the overflow menu is hidden", async ({ daemon, page }) => {
  await daemon.seed();
  // Fixture viewport is REFERENCE_WIDTH_PX + 200 = 1600, above every breakpoint.
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await expect(page.locator(".reject")).toBeVisible();
  await expect(page.locator(".request")).toBeVisible();
  await expect(page.locator(".overflow-trigger")).toBeHidden();
  // The Approve control reads inline at wide width.
  await expect(page.locator(".approve-slot .split-primary")).toBeVisible();
});

test("narrow: secondaries collapse into the overflow menu, count preserved", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  // Two retained scratches → pendingCount 2, surfaced on the overflow trigger
  // once Request changes moves into the menu.
  await daemon.putDraft(id, {
    composerScratches: [
      { startLine: 7, endLine: 8, text: "a half-typed thought" },
      { startLine: 10, endLine: 11, text: "another" },
    ],
  });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await page.setViewportSize({ width: 500, height: 800 });

  // The inline secondaries hide; the overflow trigger takes their place.
  await expect(page.locator(".reject")).toBeHidden();
  await expect(page.locator(".request")).toBeHidden();
  const trigger = page.getByRole("button", { name: "More actions" });
  await expect(trigger).toBeVisible();
  // The pending count rides the trigger so it stays visible in the collapsed row.
  await expect(trigger.locator(".count")).toHaveText("2");

  // Opening the menu surfaces both actions.
  await trigger.click();
  await expect(page.getByRole("menuitem", { name: "Request changes" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Reject" })).toBeVisible();

  // Request changes routes through to its dialog.
  await page.getByRole("menuitem", { name: "Request changes" }).click();
  await expect(page.getByRole("dialog", { name: "Send the plan back for revision" })).toBeVisible();
});

test("narrow: the reject action still resolves from the overflow menu", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await page.setViewportSize({ width: 500, height: 800 });

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Reject" }).click();
  // Reject always confirms (EXC-685); confirming denies the plan and clears the
  // queue — proving the collapsed action is fully wired, not just visible.
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
});

test("narrow: the topbar fits with no horizontal overflow", async ({ daemon, page }) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await page.setViewportSize({ width: 500, height: 800 });

  // The header no longer forces the app wide: its content fits its own width.
  const { scrollWidth, clientWidth } = await page
    .locator(".topbar")
    .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});

test("tight: Approve moves into the overflow menu", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await page.setViewportSize({ width: 600, height: 800 }); // below --w-tight (640)

  // The inline Approve control is gone; only ⋯ + bell + settings remain right.
  await expect(page.locator(".approve-slot")).toBeHidden();

  // Approve — with its variants — is reachable in the overflow menu, and
  // approving from there resolves the review through the confirm dialog.
  await page.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Approve & accept edits" })).toBeVisible();
  await page.getByRole("menuitem", { name: "Approve & auto mode" }).click();
  const confirm = page.getByRole("dialog", { name: "Approve this plan?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
});

test("narrow: bell and settings stay visible while a long title truncates", async ({
  daemon,
  page,
}) => {
  // A long plan title that would otherwise crowd the right-hand controls.
  await daemon.seed({
    plan: `# ${"Extremely long plan title that would overflow the narrow header ".repeat(3)}\n\n## Section\n\nBody.\n`,
  });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await page.setViewportSize({ width: 500, height: 800 });

  // Every right-hand control stays on screen...
  await expect(page.getByRole("button", { name: "More actions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Notifications/ })).toBeVisible();
  // ...and the header does not overflow — the title truncated to make room.
  const { scrollWidth, clientWidth } = await page
    .locator(".topbar")
    .evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
});
