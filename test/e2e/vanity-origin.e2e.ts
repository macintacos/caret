// Vanity origin (EXC-426): the UI opens under http://caret.localhost:<port>, not
// http://localhost:<port>. Chromium computes the Origin / Sec-Fetch-Site headers
// itself, so a mutating POST (approve, deny) carries the caret.localhost origin
// the browser derives — which must pass the daemon's Host and cross-origin guards
// (isForeignHost, isCrossOrigin, src/daemon/guards.ts); the Host gate covers the
// page load too, since it applies to safe methods as well. A 403 from either would
// fail these flows, so this is committed real-browser e2e, not a unit test. Chromium
// special-cases *.localhost to loopback, so caret.localhost reaches the per-test
// fixture daemon bound on 127.0.0.1.

import {
  assertResolved,
  openApproveGuard,
  openRequestChangesDialog,
} from "@test/e2e/support/decision.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { assertRejected } from "@test/e2e/support/review-state.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

const FEEDBACK = "Please tighten the verification section.";

/** Same daemon, addressed under the caret.localhost vanity hostname. */
function vanityOrigin(url: string): string {
  const vanity = new URL(url);
  vanity.hostname = "caret.localhost";
  return vanity.origin;
}

test("approve under caret.localhost resolves the review", async ({ daemon, page }) => {
  const id = await daemon.seed();
  // The deep-link shape the hook actually opens, under the vanity origin.
  await page.goto(`${vanityOrigin(daemon.url)}/?review=${id}`);
  await planSurface(page);

  // Approve opens a confirmation (EXC-791); confirming it issues the mutating
  // POST /api/reviews/:id/resolve, which carries the browser-computed
  // caret.localhost origin — no 403 means the guard allowed it.
  const confirm = await openApproveGuard(page);
  await confirm.getByRole("button", { name: "Approve", exact: true }).click();
  await assertResolved(daemon, page, id);
});

test("request changes under caret.localhost rejects with feedback", async ({ daemon, page }) => {
  const id = await daemon.seed();
  await page.goto(`${vanityOrigin(daemon.url)}/?review=${id}`);
  await planSurface(page);
  await waitPastSafeModeGrace(page);

  const dialog = await openRequestChangesDialog(page);
  await dialog.getByRole("textbox", { name: "General comment" }).fill(FEEDBACK);
  await page.keyboard.press("ControlOrMeta+Enter");

  // The deny POST under the vanity origin resolves the review rejected, carrying
  // the typed feedback — proof the guard allowed the mutating request.
  const review = await assertRejected(page, daemon, id);
  expect(review?.decision?.feedback).toContain(FEEDBACK);
});
