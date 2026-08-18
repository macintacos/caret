// Unread markers (EXC-411): a plan that arrives while another one is being read
// is marked unread — the switcher trigger grows an --attention dot, and that
// plan's dropdown row carries one of its own until the reviewer opens it. Two
// halves need a real browser and nothing else here does. The mark is raised by
// the 2s decision poll delivering a plan into a page that is ALREADY open, which
// is state no mounted component can be handed as props; and the row markers are
// portalled bits-ui menu content, out of the happy-dom unit's reach. The pure
// half — which merges mark, and what a select or an expiry clears — is
// ui/src/state/polling.test.ts, and the trigger's own dot and accessible
// description are ui/src/components/ReviewSwitcher.test.ts.

import { reviewSwitcher } from "@test/e2e/support/chrome.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

test("marks a plan arriving mid-review, and clears the mark on opening it", async ({
  daemon,
  page,
}) => {
  // Plans already pending when the page opens are not news — the first poll
  // snapshot seeds silently — so nothing is marked at load.
  await daemon.seed({ title: "Plan Alpha", cwd: "/tmp/proj-alpha" });
  await daemon.seed({ title: "Plan Beta", cwd: "/tmp/proj-beta" });

  await page.goto("/");
  await planSurface(page);

  const trigger = reviewSwitcher(page);
  const dot = trigger.locator(".unread-dot");
  await expect(trigger).toHaveAccessibleDescription("2 reviews pending");
  await expect(dot).toHaveCount(0);

  // seed() defaults to a fresh session per call, which is what makes this a third
  // pending plan rather than a supersede of one already on screen.
  await daemon.seed({ title: "Plan Gamma", cwd: "/tmp/proj-gamma" });

  // The 2s poll delivers it into the open page; the web-first assertions absorb
  // that window rather than sleeping through it.
  await expect(trigger).toHaveAccessibleDescription("3 reviews pending, 1 unread");
  // toBeVisible, not toHaveCount(1): the marker is a bare styled span, so its
  // non-empty box is the half of "it appeared" that a node count cannot prove.
  await expect(dot).toBeVisible();

  // In the menu the mark is per row, and only the arrival carries one.
  const rowMark = (name: string) =>
    page.getByRole("menuitem", { name }).locator(".opt-unread .dot");
  await trigger.click();
  await expect(rowMark("Plan Gamma")).toBeVisible();
  await expect(rowMark("Plan Alpha")).toHaveCount(0);
  await expect(rowMark("Plan Beta")).toHaveCount(0);

  // Making a plan active is what reads it, so picking the row clears its mark.
  await page.getByRole("menuitem", { name: "Plan Gamma" }).click();
  await expect(trigger.locator(".title")).toHaveText("Plan Gamma");
  await expect(trigger).toHaveAccessibleDescription("3 reviews pending");
  await expect(dot).toHaveCount(0);
});
