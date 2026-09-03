// The review decision flow's shared arrangements: seed a review carrying pending
// inline work, open it, and open the Approve / Reject / Request-changes surface
// that guards or accepts it.

import type { Locator, Page } from "@playwright/test";

import { reviewSwitcher } from "@test/e2e/support/chrome.ts";
import { type Daemon, expect } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

/** The approve confirmation/guard dialog — named so the locator never collides with
 * the Request Changes dialog, which is also role="dialog" (EXC-791). */
const APPROVE_CONFIRM = { name: "Approve this plan?" } as const;

/** Seed a review carrying one pending inline annotation on lines 7-8, the way
 * autosave persists one, open it, and wait for the plan surface. Returns the
 * review id. */
export async function openWithPendingAnnotation(
  daemon: Daemon,
  page: Page,
  comment: string,
): Promise<string> {
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment }],
  });
  await page.goto("/");
  await planSurface(page);
  return id;
}

/** Seed a review carrying one pending composer scratch on lines 7-8 — an inline
 * comment typed but never committed, the way autosave persists one — open it,
 * and wait for the plan surface. Returns the review id. */
export async function openWithPendingScratch(
  daemon: Daemon,
  page: Page,
  text: string,
): Promise<string> {
  const id = await daemon.seed();
  await daemon.putDraft(id, { composerScratches: [{ startLine: 7, endLine: 8, text }] });
  await page.goto("/");
  await planSurface(page);
  return id;
}

/** Click Approve and return the confirmation/guard dialog, already asserted visible. */
export async function openApproveGuard(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  const dialog = page.getByRole("dialog", APPROVE_CONFIRM);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Click Reject and return the guard, already asserted visible. */
export async function openRejectGuard(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  const guard = page.getByRole("alertdialog");
  await expect(guard).toBeVisible();
  return guard;
}

/** Click the top-bar Request Changes button and return the dialog, already
 * asserted visible. */
export async function openRequestChangesDialog(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Request changes" }).click();
  const dialog = page.getByRole("dialog", { name: "Send the plan back for revision" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Assert a review has resolved: the waiting-room heading is up and `id` has left
 * the pending list. */
export async function assertResolved(daemon: Daemon, page: Page, id: string): Promise<void> {
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).not.toContain(id);
}

/** Assert a dismissed guard has left the DOM and `id` is still in the pending list. */
export async function assertGuardDismissed(
  daemon: Daemon,
  guard: Locator,
  id: string,
): Promise<void> {
  await expect(guard).toHaveCount(0);
  await expect.poll(async () => (await daemon.listReviews()).map((r) => r.id)).toContain(id);
}

/** Pick `variant` from an already-open Approve variants menu, confirm the guard it
 * opens, and assert the review resolved. */
export async function approveViaVariant(
  daemon: Daemon,
  page: Page,
  variant: string,
  id: string,
): Promise<void> {
  await page.getByRole("menuitem", { name: variant }).click();
  const confirm = page.getByRole("dialog", APPROVE_CONFIRM);
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Approve", exact: true }).click();
  await assertResolved(daemon, page, id);
}

/** Seed two pending plans ("Plan Alpha" / "Plan Beta", distinct sessions), open
 * the page, and return the review switcher trigger. */
export async function seedTwoPlansAndOpen(daemon: Daemon, page: Page): Promise<Locator> {
  await daemon.seed({ title: "Plan Alpha", cwd: "/tmp/proj-alpha" });
  await daemon.seed({ title: "Plan Beta", cwd: "/tmp/proj-beta" });
  await page.goto("/");
  await planSurface(page);
  return reviewSwitcher(page);
}
