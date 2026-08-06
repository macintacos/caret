// Revision comments in the compare view (EXC-872, EXC-1041). The docked panel
// lists every comment left on the compared version range, each badged with the
// version it came from. The status strip's tally is its only entry point in both
// modes — entering compare mode never opens it unasked. A comment left on either
// rendered version scrolls the diff to that line on that comment's side; one from
// a version in the range but on neither side lists non-interactively, and a
// general comment retained at deny lists with no line at all.

import type { Page } from "@playwright/test";

import { type Daemon, expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";

// Three versions whose bodies each carry a unique, greppable line, with a blank
// line between them so line 3 and line 5 are real anchors in every version.
const V1 = "# Plan\n\nalpha line one\n\nalpha line two\n";
const V2 = "# Plan\n\nbeta line one\n\nbeta line two\n";
const V3 = "# Plan\n\ngamma line one\n\ngamma line two\n";

// Long versions for the scroll assertions, tall enough that revealing anything
// past the fold has to scroll. Body lines are blank-separated like the fixtures
// above, so each is a real anchor: line 2k+1 holds body line k, and the plan text
// survives ingest unrewrapped.
//
// Two properties let the unified test name which side resolved a line. Every body
// line differs, so each renders as a change rather than shared context. And v2
// carries an extra leading paragraph, shifting its numbering by two — so a single
// line number names DIFFERENT content on the two sides, and the row the view lands
// on says which side was used without the assertion having to inspect the row's
// column or type.
const body = (tag: string) =>
  Array.from({ length: 60 }, (_, i) => `${tag} body line ${i + 1}`).join("\n\n");
const LONG_V1 = `# Plan\n\n${body("alpha")}\n`;
const LONG_V2 = `# Plan\n\nbeta preamble paragraph\n\n${body("beta")}\n`;

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

/**
 * A two-version review with a comment anchored deep in each version, far enough
 * down that revealing either has to scroll. v1 is the diff's before side and v2
 * its after side, and both anchors are on line 41 deliberately: v2's extra
 * leading paragraph means that one number names "alpha body line 20" on the
 * before side and "beta body line 19" on the after side, so the row the view
 * lands on says unambiguously which side resolved it.
 */
async function seedSideAnchors(daemon: Daemon): Promise<void> {
  const id = await daemon.seed({ plan: LONG_V1 });
  await daemon.putDraft(id, { annotations: [ann("a1", 41, "before-side anchor")] });
  await daemon.addVersion(id, LONG_V2);
  await daemon.putDraft(id, { annotations: [ann("b1", 41, "after-side anchor")] });
}

/**
 * The text of every rendered diff row currently parked at the top of the scroll
 * container, joined for a substring assertion. The rows live in the view's shadow
 * root; in split, both columns have a row at the same offset, so this returns
 * what is at the top on EITHER side and the caller names the content it expects.
 * The band brackets the reveal's target offset (SCROLL_OFFSET_TOP = 12px) by
 * under a row's height, so a row one off the target falls outside it.
 */
async function rowsAtTop(page: Page): Promise<string> {
  return page.evaluate(() => {
    const view = document.querySelector(".diffview");
    const scroller = document.querySelector(".diff-plan");
    if (view?.shadowRoot == null || scroller == null) return "";
    const top = scroller.getBoundingClientRect().top;
    return [...view.shadowRoot.querySelectorAll("[data-line]")]
      .filter((row) => {
        const offset = row.getBoundingClientRect().top - top;
        return offset >= 4 && offset <= 20;
      })
      .map((row) => row.textContent ?? "")
      .join(" | ");
  });
}

/** Enter compare mode and open the comment panel through the status-strip tally
 * — the only way in, now that entering compare mode opens nothing by itself. */
async function openComparePanel(page: Page) {
  await expect(page.locator(".diff-plan")).toBeVisible();
  await page.getByRole("button", { name: "Compare versions" }).click();
  await page.locator("button.comments-toggle").click();
  const nav = page.locator(".comment-navigator");
  await expect(nav).toBeVisible();
  return nav;
}

test("entering compare mode leaves the panel closed; the tally opens it", async ({
  daemon,
  page,
}) => {
  await seedCommentedVersions(daemon);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const nav = page.locator(".comment-navigator");
  const toggle = page.locator("button.comments-toggle");

  // The tally is the entry point in the single-version view…
  await toggle.click();
  await expect(nav).toBeVisible();
  await toggle.click();
  await expect(nav).toBeHidden();

  // …and entering compare mode does not change that: the diff comes up with the
  // panel still shut, and the same tally opens it on the compared range.
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(page.locator(".diffview pre").first()).toHaveAttribute("data-diff-type", "split");
  await expect(nav).toBeHidden();

  await toggle.click();
  await expect(nav).toBeVisible();
  await expect(nav.locator(".nav-title")).toHaveText("Comments in v2–v3");
});

/** Enter compare mode in `layout` with the side-anchor fixture, and open the panel. */
async function openSideAnchors(page: Page, layout: "Split" | "Unified") {
  await expect(page.locator(".diff-plan")).toBeVisible();
  await page.getByRole("button", { name: "Compare versions" }).click();
  await page.getByRole("radio", { name: layout }).click();
  await page.locator("button.comments-toggle").click();
  const nav = page.locator(".comment-navigator");
  await expect(nav).toBeVisible();
  return nav;
}

// Unified interleaves the two documents into ONE column, so a line number alone
// is genuinely ambiguous there and the side is what disambiguates it. That makes
// this the layout where side-awareness is observable — and this test is what pins
// it: reveal the wrong side and the view parks on the wrong row.
test("resolves a compare comment's line against its own side (unified)", async ({
  daemon,
  page,
}) => {
  await seedSideAnchors(daemon);
  await page.goto("/");
  const nav = await openSideAnchors(page, "Unified");

  // Both comments are on line 41. On v1 — the before side — that is "alpha body
  // line 20".
  await nav.locator("button.nav-item").filter({ hasText: "before-side anchor" }).click();
  await expect.poll(() => rowsAtTop(page)).toContain("alpha body line 20");

  // On v2 — the after side — the same number is "beta body line 19", two body
  // lines earlier because of v2's extra leading paragraph. Resolving line 41 off
  // the before side would park "alpha body line 20" here instead.
  await nav.locator("button.nav-item").filter({ hasText: "after-side anchor" }).click();
  await expect.poll(() => rowsAtTop(page)).toContain("beta body line 19");
});

// Split gives each side its own column and aligns the two BY LINE NUMBER, so line
// 41 sits at the same offset in both — the sides cannot be told apart by where the
// view lands, and a scroll assertion there proves reach, not side. What it does
// pin is the split branch of the row lookup (the scoped data-deletions /
// data-additions queries), which is separate code from unified's: get it wrong and
// no row resolves, the reveal is a no-op, and the diff never leaves the top.
test("reveals a compare comment past the fold (split)", async ({ daemon, page }) => {
  await seedSideAnchors(daemon);
  await page.goto("/");
  const nav = await openSideAnchors(page, "Split");

  const scrollTop = () => page.locator(".diff-plan").evaluate((el) => el.scrollTop);
  expect(await scrollTop()).toBe(0);

  await nav.locator("button.nav-item").filter({ hasText: "before-side anchor" }).click();
  await expect.poll(() => rowsAtTop(page)).toContain("alpha body line 20");
  expect(await scrollTop()).toBeGreaterThan(0);

  // The after-side row for the same line is its column's own line 41, alongside it.
  await expect.poll(() => rowsAtTop(page)).toContain("beta body line 19");
});

test("lists every version's comments in the compared range, each badged with its version", async ({
  daemon,
  page,
}) => {
  await seedCommentedVersions(daemon);
  await page.goto("/");
  const nav = await openComparePanel(page);

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

test("marks an in-range comment from a version on neither side as not in the diff", async ({
  daemon,
  page,
}) => {
  await seedCommentedVersions(daemon);
  await page.goto("/");
  const nav = await openComparePanel(page);

  // v1 vs v3: v2 is inside the range but rendered on neither side of the diff.
  await page.getByLabel("Target version").click();
  await page.getByRole("menuitemradio", { name: "v1" }).click();
  await expect(nav.locator(".nav-item")).toHaveCount(4);

  // The two v2 rows are the only ones that carry the marker, and they are list
  // items rather than buttons — nothing offers a jump that goes nowhere.
  const stranded = nav.locator(".nav-item").filter({ has: page.locator(".nav-unlinked-tag") });
  await expect(stranded).toHaveCount(2);
  await expect(stranded.locator(".nav-version-tag")).toHaveText(["v2", "v2"]);
  await expect(stranded.locator(".nav-unlinked-tag").first()).toHaveText("not in diff");
  await expect(nav.locator("li.nav-item")).toHaveCount(2);
  await expect(nav.locator("button.nav-item")).toHaveCount(2);
});

test("lists a general comment retained at deny, with no line to jump to", async ({
  daemon,
  page,
}) => {
  // The reviewer typed general feedback against v1 and then denied it — which is
  // exactly what addVersion does internally, so this is the production path that
  // retains it on the version rather than a hand-built fixture.
  const id = await daemon.seed({ plan: V1 });
  await daemon.putDraft(id, { generalCommentDraft: "rethink the rollout before v2" });
  await daemon.addVersion(id, V2);
  await page.goto("/");
  const nav = await openComparePanel(page);

  const general = nav.locator(".nav-item").filter({ hasText: "rethink the rollout before v2" });
  await expect(general).toHaveCount(1);
  // Unanchored: labelled General in place of a line reference, and inert.
  await expect(general.locator(".nav-item-ref")).toHaveText("General");
  await expect(general.locator(".nav-version-tag")).toHaveText("v1");
  await expect(nav.locator("button.nav-item")).toHaveCount(0);
});

test("two versions commenting on the same line list as two rows", async ({ daemon, page }) => {
  await seedCommentedVersions(daemon);
  await page.goto("/");
  const nav = await openComparePanel(page);

  // v2 and v3 both comment on line 3 of their own text; the range's entries are
  // keyed per version, so neither collapses into the other.
  const onLine3 = nav.locator(".nav-item").filter({ hasText: "Line 3" });
  await expect(onLine3).toHaveCount(2);
  await expect(onLine3.locator(".nav-version-tag")).toHaveText(["v2", "v3"]);
  await expect(onLine3.nth(0)).toContainText("beta drops the rollback path");
  await expect(onLine3.nth(1)).toContainText("gamma reinstates the rollback path");
});

test("the panel is dismissable with Escape and with the status-strip tally", async ({
  daemon,
  page,
}) => {
  await seedCommentedVersions(daemon);
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await waitPastSafeModeGrace(page);
  await page.getByRole("button", { name: "Compare versions" }).click();

  // The tally counts the compared range's comments (v2's two plus v3's one).
  const nav = page.locator(".comment-navigator");
  const toggle = page.locator("button.comments-toggle");
  await expect(toggle).toContainText("3");

  await toggle.click();
  await expect(nav).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();

  await toggle.click();
  await expect(nav).toBeVisible();
  await toggle.click();
  await expect(nav).toBeHidden();
});

test("leaving compare mode restores the single-version list", async ({ daemon, page }) => {
  await seedCommentedVersions(daemon);
  await page.goto("/");
  const nav = await openComparePanel(page);
  await expect(nav.locator(".nav-item")).toHaveCount(3);

  // The panel is the reviewer's own now, so leaving compare mode leaves it up —
  // it just swaps back to the current version's own index: no version badges,
  // and the plain title.
  await page.getByRole("button", { name: "Compare versions" }).click();
  await expect(nav.locator(".nav-title")).toHaveText("Comments");
  await expect(nav.locator("button.nav-item")).toHaveCount(1);
  await expect(nav.locator("button.nav-item")).toContainText("gamma reinstates the rollback path");
  await expect(nav.locator(".nav-version-tag")).toHaveCount(0);
});
