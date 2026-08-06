// Revision comments in the compare view (EXC-872). Entering compare mode points
// the docked comment panel at every comment left on the compared version range —
// read-only rows, each badged with the version it came from — and auto-opens it
// without a click and without taking focus off the diff. Leaving compare mode
// hands the panel back to the single-version list the reviewer had before.

import { type Daemon, expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";

// Three versions whose bodies each carry a unique, greppable line, with a blank
// line between them so line 3 and line 5 are real anchors in every version.
const V1 = "# Plan\n\nalpha line one\n\nalpha line two\n";
const V2 = "# Plan\n\nbeta line one\n\nbeta line two\n";
const V3 = "# Plan\n\ngamma line one\n\ngamma line two\n";

const ann = (id: string, line: number, comment: string) => ({
  id,
  startLine: line,
  endLine: line,
  comment,
});

/**
 * A three-version review carrying comments on each version: one on v1, two on v2
 * (one of them on the same line v3's comment anchors to), one on v3. Composed
 * from the harness's existing seed/putDraft/addVersion — a draft PUT lands on
 * whichever version is current when it is written, so interleaving the two
 * leaves each version with its own annotations.
 */
async function seedCommentedVersions(daemon: Daemon): Promise<void> {
  const id = await daemon.seed({ plan: V1 });
  await daemon.putDraft(id, { annotations: [ann("a1", 3, "alpha needs a rollback path")] });
  await daemon.addVersion(id, V2);
  await daemon.putDraft(id, {
    annotations: [
      ann("b1", 3, "beta drops the rollback path"),
      ann("b2", 5, "beta retry budget looks thin"),
    ],
  });
  await daemon.addVersion(id, V3);
  await daemon.putDraft(id, { annotations: [ann("c1", 3, "gamma reinstates the rollback path")] });
}

test("entering compare mode opens the comment panel with no click", async ({ daemon, page }) => {
  await seedCommentedVersions(daemon);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const nav = page.locator(".comment-navigator");
  await expect(nav).toBeHidden();

  await page.getByRole("button", { name: "Compare versions" }).click();

  // The default pair is base = current (v3) vs previous (v2), and that range
  // carries comments — so the panel opens on its own, titled with the range.
  await expect(nav).toBeVisible();
  await expect(nav.locator(".nav-title")).toHaveText("Comments in v2–v3");
  await expect(page.locator("button.comments-toggle")).toHaveAttribute("aria-expanded", "true");
});

test("lists every version's comments in the compared range, each badged with its version", async ({
  daemon,
  page,
}) => {
  await seedCommentedVersions(daemon);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await page.getByRole("button", { name: "Compare versions" }).click();

  const nav = page.locator(".comment-navigator");
  await expect(nav).toBeVisible();

  // Widen the pair to base v3 / target v1 so the range spans all three versions.
  await page.getByLabel("Target version").click();
  await page.getByRole("menuitemradio", { name: "v1" }).click();
  await expect(nav.locator(".nav-title")).toHaveText("Comments in v1–v3");

  // Every comment on v1, v2 and v3, ordered by version then by line, each row
  // tagged with the version it was left on.
  await expect(nav.locator(".nav-item")).toHaveCount(4);
  await expect(nav.locator(".nav-version-tag")).toHaveText(["v1", "v2", "v2", "v3"]);
  await expect(nav.locator(".nav-item").nth(0)).toContainText("alpha needs a rollback path");
  await expect(nav.locator(".nav-item").nth(1)).toContainText("beta drops the rollback path");
  await expect(nav.locator(".nav-item").nth(2)).toContainText("beta retry budget looks thin");
  await expect(nav.locator(".nav-item").nth(3)).toContainText("gamma reinstates the rollback path");
});

test("two versions commenting on the same line list as two rows", async ({ daemon, page }) => {
  await seedCommentedVersions(daemon);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await page.getByRole("button", { name: "Compare versions" }).click();

  const nav = page.locator(".comment-navigator");
  await expect(nav).toBeVisible();

  // v2 and v3 both comment on line 3 of their own text; the range's entries are
  // keyed per version, so neither collapses into the other.
  const onLine3 = nav.locator(".nav-item").filter({ hasText: "Line 3" });
  await expect(onLine3).toHaveCount(2);
  await expect(onLine3.locator(".nav-version-tag")).toHaveText(["v2", "v3"]);
  await expect(onLine3.nth(0)).toContainText("beta drops the rollback path");
  await expect(onLine3.nth(1)).toContainText("gamma reinstates the rollback path");
});

test("the auto-opened panel is dismissable with Escape and with the status-strip tally", async ({
  daemon,
  page,
}) => {
  await seedCommentedVersions(daemon);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);
  await page.getByRole("button", { name: "Compare versions" }).click();

  const nav = page.locator(".comment-navigator");
  await expect(nav).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();

  // The tally counts the compared range's comments (v2's two plus v3's one) and
  // still toggles the panel while comparing.
  const toggle = page.locator("button.comments-toggle");
  await expect(toggle).toContainText("3");
  await toggle.click();
  await expect(nav).toBeVisible();
  await toggle.click();
  await expect(nav).toBeHidden();
});

test("a compared range with no comments leaves the panel closed", async ({ daemon, page }) => {
  // Only v1 carries a comment, so the default pair (v2–v3) has nothing to show.
  const id = await daemon.seed({ plan: V1 });
  await daemon.putDraft(id, { annotations: [ann("a1", 3, "alpha needs a rollback path")] });
  await daemon.addVersion(id, V2);
  await daemon.addVersion(id, V3);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  await page.getByRole("button", { name: "Compare versions" }).click();

  // Compare mode really is on — `.diffview` wraps the single-version reader too,
  // so prove it by the diff layout the library renders. The panel simply had no
  // reason to open.
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "split");
  await expect(page.locator(".comment-navigator")).toBeHidden();
});

test("auto-opening the panel leaves focus outside it", async ({ daemon, page }) => {
  await seedCommentedVersions(daemon);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const compare = page.getByRole("button", { name: "Compare versions" });
  await compare.click();
  await expect(page.locator(".comment-navigator")).toBeVisible();

  // The panel opened without a gesture aimed at it, so it must not steal focus:
  // it stays on the compare toggle the reviewer actually pressed.
  const insidePanel = await page.evaluate(
    () => document.getElementById("comment-navigator")?.contains(document.activeElement) ?? null,
  );
  expect(insidePanel).toBe(false);
  await expect(compare).toBeFocused();
});

test("a panel the reviewer opened while comparing survives leaving compare mode", async ({
  daemon,
  page,
}) => {
  // Only v1 carries a comment, so the default pair (v2–v3) auto-opens nothing —
  // the reviewer opens the panel themselves. Leaving compare mode must undo only
  // what the auto-open did, which here is nothing.
  const id = await daemon.seed({ plan: V1 });
  await daemon.putDraft(id, { annotations: [ann("a1", 3, "alpha needs a rollback path")] });
  await daemon.addVersion(id, V2);
  await daemon.addVersion(id, V3);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const nav = page.locator(".comment-navigator");
  const compare = page.getByRole("button", { name: "Compare versions" });
  await compare.click();
  await expect(nav).toBeHidden();

  await page.locator("button.comments-toggle").click();
  await expect(nav).toBeVisible();

  await compare.click();
  await expect(nav).toBeVisible();
});

test("below --w-narrow the panel stays a toggle rather than auto-opening", async ({
  daemon,
  page,
}) => {
  // At this width the panel is a bottom sheet over the diff, so opening it
  // unasked would bury what the reviewer came to compare.
  await page.setViewportSize({ width: 800, height: 900 });
  await seedCommentedVersions(daemon);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const nav = page.locator(".comment-navigator");
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "single");
  await expect(nav).toBeHidden();

  // The tally still opens it on request, listing the range's comments.
  await page.locator("button.comments-toggle").click();
  await expect(nav.locator(".nav-title")).toHaveText("Comments in v2–v3");
  await expect(nav.locator(".nav-item")).toHaveCount(3);
});

test("leaving compare mode restores the single-version list", async ({ daemon, page }) => {
  await seedCommentedVersions(daemon);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const nav = page.locator(".comment-navigator");
  const compare = page.getByRole("button", { name: "Compare versions" });
  await compare.click();
  await expect(nav.locator(".nav-item")).toHaveCount(3);

  // Leaving restores what the reviewer had before entering (the panel was shut).
  await compare.click();
  await expect(nav).toBeHidden();

  // Reopened, it is the current version's own index again: interactive rows, no
  // version badges, and the plain title.
  await page.locator("button.comments-toggle").click();
  await expect(nav.locator(".nav-title")).toHaveText("Comments");
  await expect(nav.locator("button.nav-item")).toHaveCount(1);
  await expect(nav.locator("button.nav-item")).toContainText("gamma reinstates the rollback path");
  await expect(nav.locator(".nav-version-tag")).toHaveCount(0);
});
