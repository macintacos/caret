// Approve split-button options menu (EXC-760): the primary button approves in
// the remembered mode (covered in approve.e2e.ts); the toggle opens a shadcn
// DropdownMenu of every approve variant. That menu is bits-ui overlay
// interaction (open on click, pick, Escape), so it is proven here in a real
// browser rather than in the happy-dom unit suite (doc/agents/browser-testing.md).
// The fixture daemon declares no adapter variants, so the UI renders the
// WIRE_FALLBACK set (Approve / Approve & accept edits / Approve & auto mode).

import { approveViaVariant } from "@test/e2e/support/decision.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { seedAndOpen } from "@test/e2e/support/source-view.ts";

test("the options menu approves the review in a chosen variant", async ({ daemon, page }) => {
  const id = await seedAndOpen(page, daemon);

  await page.getByRole("button", { name: "Approve options" }).click();
  await expect(page.getByRole("menuitem", { name: "Approve & accept edits" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Approve & auto mode" })).toBeVisible();

  // Picking a variant opens the approval confirmation (EXC-791); confirming
  // resolves the review on that variant's allow path — the same path the primary
  // button takes.
  await approveViaVariant(daemon, page, "Approve & auto mode", id);
});

test("Escape closes the options menu and leaves the review pending", async ({ daemon, page }) => {
  const id = await seedAndOpen(page, daemon);

  const item = page.getByRole("menuitem", { name: "Approve & auto mode" });
  await page.getByRole("button", { name: "Approve options" }).click();
  await expect(item).toBeVisible();

  // Retry Escape until the menu closes: bits-ui attaches its dismiss listener a
  // tick after the content becomes visible, so a single immediate press can race
  // it (no fixed sleep — toPass polls the web-first assertion).
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(item).toHaveCount(0, { timeout: 500 });
  }).toPass();
  // Nothing was approved — the menu is just a picker, not an action.
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);
});
