// The one-time reference-hint badge (EXC-1061). A plan's path tokens already open
// something on click — an excerpt preview for a file, the folder tree for a
// directory — but nothing advertises either, so a reviewer who never happens to
// click one never learns those surfaces exist. One badge sits over the first
// on-screen file reference and one over the first directory reference; opening a
// reference of that kind retires its badge for good, per browser and per kind.
//
// Everything here needs a real browser. WHICH token gets badged is decided by real
// layout — the picker walks the shadow-root rows and keeps the first token whose
// client rect intersects the scroller's viewport — and happy-dom lays nothing out,
// so a mounted component would measure every rect as zero and badge nothing. The
// kinds themselves come from a daemon round trip against a real cwd, the tokens are
// tagged inside @pierre/diffs's shadow root on a MutationObserver frame, retirement
// is a real click through the library's own token handling, and persistence is real
// localStorage surviving a real reload. The pure halves stay units: the dismissal
// flags and the anchor arithmetic in refHint.test.ts, the badge's own render and
// callback wiring in RefHintBadge.test.ts.
//
// The daemon is a real subprocess reading the local filesystem, so each test writes
// a synthetic project dir and seeds a review whose cwd points at it. The content is
// throwaway, non-identifying scaffolding — never a real plan.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "@playwright/test";

import { makeProject } from "@test/e2e/support/file-refs.ts";
import { expect, test, waitForTwoPollTicks } from "@test/e2e/support/fixtures.ts";
import { PLAN_SURFACE, planSurface } from "@test/e2e/support/source-view.ts";

/** A project whose paths resolve to two files and two directories, so a plan can
 * cite several of each kind and the "first of each" claim has something to be
 * first among. */
const PROJECT = {
  "src/cache.ts": "export const cache = new Map();\n",
  "src/lib/util.ts": "export {};\n",
  "src/lib/deep/leaf.ts": "export {};\n",
};

// Two file references and two directory ones, the first of each on the same line
// so reading order is unambiguous: `src/cache.ts` then `src/lib`.
const PLAN = [
  "# Refs",
  "",
  "The cache lives in `src/cache.ts` and the tree under `src/lib` matters.",
  "",
  "Later, `src/lib/util.ts` sits beside `src/lib/deep`.",
  "",
].join("\n");

// The same references, pushed past the first screenful behind enough prose to
// guarantee a scroll. Real plans look like this — citations live in the body, not
// the opening paragraph — which is why the badge cannot only look once at load.
const DEEP_PLAN = [
  "# Refs",
  "",
  ...Array.from(
    { length: 120 },
    (_, i) => `Paragraph ${i + 1} of scaffolding, holding no path of any kind.\n`,
  ),
  "The cache lives in `src/cache.ts` and the tree under `src/lib` matters.",
  "",
].join("\n");

const FILE_BADGE = "Preview this file";
const DIR_BADGE = "Browse this folder";

const fileBadge = (page: Page) => page.getByRole("button", { name: FILE_BADGE });
const dirBadge = (page: Page) => page.getByRole("button", { name: DIR_BADGE });

/**
 * The top-right of the PILL the first token matching `selector` is drawn as, read
 * from inside the plan's shadow root.
 *
 * The pill, not the token: a backticked path — the repo's commonest citation —
 * renders as three tokens sharing one chip, and the reference in the middle gives
 * up its own fill, inline padding and radius to the group (coreStyles.ts § the
 * citation carve-out). Its right edge is therefore a point INSIDE the pill, where
 * the path text stops and the closing backtick begins, and a badge sitting there
 * reads as floating in the middle of the chip. Only the group's last member
 * reaches the corner the reader sees.
 *
 * The FIRST rect rather than the bounding box: a wrapped path has two fragments
 * and a union box whose corner the text never occupies.
 */
function pillTopRight(page: Page, selector: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((sel) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const tok = sh?.querySelector(sel) ?? null;
    if (tok === null) return null;
    let end = tok;
    if (tok.hasAttribute("data-md-cite")) {
      while (end.nextElementSibling?.hasAttribute("data-md-cite") === true) {
        end = end.nextElementSibling;
      }
    }
    const top = tok.getClientRects()[0];
    const right = end.getClientRects()[0];
    if (top === undefined || right === undefined) return null;
    // A pill that wrapped leaves its closing token on the next row, which the
    // badge does not follow.
    return { x: Math.abs(right.top - top.top) < 1 ? right.right : top.right, y: top.top };
  }, selector);
}

/** The badge's own center — it is translated onto the anchor, so this is the point
 * that must land on the pill's corner. */
async function badgeCenter(page: Page, name: string): Promise<{ x: number; y: number }> {
  const box = await page.getByRole("button", { name }).boundingBox();
  if (box === null) throw new Error(`badge "${name}" has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Wait out the view's painted-row frame budget (PAINT_RETRY_FRAMES = 30 in
 * DiffPlanView), so an assertion after it cannot be satisfied by that retry still
 * running. Counted in FRAMES rather than milliseconds because frames are the unit
 * the app's own deadline is written in — a ms sleep here would be the fixed wait
 * browser-testing.md rules out, and would race the very budget it means to outlast.
 */
function spendFrameBudget(page: Page): Promise<void> {
  return page.evaluate(
    (n) =>
      new Promise<void>((resolve) => {
        let seen = 0;
        const step = () => (++seen >= n ? resolve() : requestAnimationFrame(step));
        requestAnimationFrame(step);
      }),
    40,
  );
}

/**
 * Assert a badge sits ON the top-right corner of the pill its reference is drawn as.
 *
 * Not an exact-point match, deliberately: the dot is pulled back inside the corner
 * so it bites into the rounded chip rather than floating off a curve. What has to
 * hold is that the badge still COVERS the corner and stays centred within a glyph's
 * reach of it — every failure this guards against (anchored to the wrong token, to
 * the path token rather than the pill it shares with its backticks, to a wrapped
 * path's union box, or to a row that has since moved) misses by a whole glyph or
 * more rather than by a few pixels.
 */
async function expectOnCorner(page: Page, name: string, selector: string): Promise<void> {
  const corner = await pillTopRight(page, selector);
  expect(corner).not.toBeNull();
  const box = await page.getByRole("button", { name }).boundingBox();
  expect(box).not.toBeNull();
  expect(corner!.x).toBeGreaterThanOrEqual(box!.x);
  expect(corner!.x).toBeLessThanOrEqual(box!.x + box!.width);
  expect(corner!.y).toBeGreaterThanOrEqual(box!.y);
  expect(corner!.y).toBeLessThanOrEqual(box!.y + box!.height);
  const at = { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
  expect(Math.abs(at.x - corner!.x)).toBeLessThanOrEqual(6);
  expect(Math.abs(at.y - corner!.y)).toBeLessThanOrEqual(6);
}

/** Open the plan and wait for the daemon resolve to tag all four references. The
 * badges are measured a frame or two after that, so each test still awaits its own
 * badge — this is the sync point for the resolve, not for the placement. */
async function openPlan(page: Page): Promise<void> {
  await page.goto("/");
  await planSurface(page);
  await expect(page.locator("[data-file-ref]")).toHaveCount(4);
}

test("exactly one badge per kind, however many references the plan cites", async ({
  daemon,
  page,
}) => {
  // The hint teaches the affordance, not each path — four references, two badges.
  const proj = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: proj.dir, plan: PLAN });
    await openPlan(page);

    await expect(fileBadge(page)).toHaveCount(1);
    await expect(dirBadge(page)).toHaveCount(1);
  } finally {
    await proj.cleanup();
  }
});

test("each badge sits on the top-right corner of its reference's pill", async ({
  daemon,
  page,
}) => {
  // The whole point of measuring in content coordinates: the badge marks a specific
  // reference rather than floating somewhere over the plan. Only real layout can say
  // whether it landed, which is why this claim cannot be a unit.
  const proj = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: proj.dir, plan: PLAN });
    await openPlan(page);
    await expect(fileBadge(page)).toHaveCount(1);

    // The first of each kind in reading order — `src/cache.ts` and `src/lib`, both
    // on line 3. The file's tag is valueless and the directory's carries its kind.
    await expectOnCorner(page, FILE_BADGE, '[data-file-ref=""]');
    await expectOnCorner(page, DIR_BADGE, '[data-file-ref="directory"]');
  } finally {
    await proj.cleanup();
  }
});

test("opening a file retires only the file badge, and the reload keeps it retired", async ({
  daemon,
  page,
}) => {
  // Retirement hangs off openFileRef, the funnel both the token click and the
  // badge's own activation pass through — so clicking the TOKEN is what proves the
  // hook is on the funnel rather than on the badge. Per kind: learning that a
  // filename opens an excerpt teaches nothing about the folder tree.
  const proj = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: proj.dir, plan: PLAN });
    await openPlan(page);
    await expect(fileBadge(page)).toHaveCount(1);
    await expect(dirBadge(page)).toHaveCount(1);

    await page.locator('[data-file-ref=""]').first().click();
    await expect(page.locator("[data-file-preview]")).toBeVisible();
    await expect(fileBadge(page)).toHaveCount(0);
    await expect(dirBadge(page)).toHaveCount(1);

    // The dismissal is localStorage, so it has to survive the origin being loaded
    // again — a hint that came back on the next visit would not be one-time.
    await page.reload();
    await openPlan(page);
    await expect(dirBadge(page)).toHaveCount(1);
    await expect(fileBadge(page)).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("the folder badge retires on its own and leaves nothing behind", async ({ daemon, page }) => {
  const proj = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: proj.dir, plan: PLAN });
    await openPlan(page);
    await expect(dirBadge(page)).toHaveCount(1);

    await page.locator('[data-file-ref="directory"]').first().click();
    await expect(page.locator("[data-folder-tree]")).toBeVisible();
    await expect(dirBadge(page)).toHaveCount(0);
    await expect(fileBadge(page)).toHaveCount(1);

    // Both retired now, and the reload brings neither back.
    await page.locator('[data-file-ref=""]').first().click();
    await expect(fileBadge(page)).toHaveCount(0);
    await page.reload();
    await openPlan(page);
    await expect(page.getByRole("button", { name: /^(Preview|Browse) this/ })).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("the badge itself opens the reference it teaches", async ({ daemon, page }) => {
  // The tests above click the TOKEN, which is the funnel; this is the other half —
  // the badge's own onActivate, the one line of wiring the render site adds. The
  // folder card is placed from the token's rect, so a card at the viewport origin
  // is the signature of a stale, detached token. (That a REPAINT does not strand
  // the token is a unit — refHint.test.ts's refHintToken cases — because forcing a
  // library repaint here would prove less than the direct DOM swap does.)
  const proj = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: proj.dir, plan: PLAN });
    await openPlan(page);
    await expect(dirBadge(page)).toHaveCount(1);

    await dirBadge(page).click();
    const card = page.locator("[data-folder-tree]");
    await expect(card).toBeVisible();
    await expect(card.locator(".ft-path")).toHaveText("src/lib");
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThan(0);
    expect(box!.y).toBeGreaterThan(0);
    // Activating retires it, exactly as the token click does.
    await expect(dirBadge(page)).toHaveCount(0);

    await fileBadge(page).click();
    await expect(page.locator("[data-file-preview]")).toBeVisible();
    await expect(fileBadge(page)).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("the badge is reachable and operable from the keyboard", async ({ daemon, page }) => {
  // The design's central accessibility call: the badge is a real focusable button
  // rather than aria-hidden decoration, because the token it teaches is a classless
  // shiki span in a shadow root with no role and no tab stop — so this is the only
  // route to the affordance without a mouse. Focus, tab order, tooltip-on-focus and
  // key activation are all real-browser behaviour.
  const proj = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: proj.dir, plan: PLAN });
    await openPlan(page);
    await expect(fileBadge(page)).toHaveCount(1);

    await fileBadge(page).focus();
    await expect(fileBadge(page)).toBeFocused();
    // The tooltip opens on FOCUS, not just hover, and it is where the path is
    // named — the accessible name is deliberately the stable half. Located by
    // data-slot rather than by role: bits-ui's tooltip content publishes no
    // `role="tooltip"` at all (it wires the trigger's aria-describedby to the
    // content's id instead), so a role query here can never match.
    await expect(page.locator('[data-slot="tooltip-content"]')).toContainText("src/cache.ts");

    // Retried, like the folder card's Escape spec: Safe Mode swallows every key
    // event for 2s when one lands within 300ms of the view arming, and focusing the
    // badge re-arms it — so this first press can be eaten. The inner budget is
    // deliberately LOWERED so the loop can press again instead of sitting out the
    // suite's assertion timeout on a keystroke that was never delivered.
    await expect(async () => {
      await page.keyboard.press("Enter");
      await expect(page.locator("[data-file-preview]")).toBeVisible({ timeout: 500 });
    }).toPass();
    await expect(fileBadge(page)).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("a reference below the fold is badged once the reviewer scrolls to it", async ({
  daemon,
  page,
}) => {
  // The badge only ever anchors to something on screen, so a plan whose citations
  // sit in the body has nothing to badge at load. Looking only once there would mean
  // the hint never teaches on a realistic plan at all — so the pick keeps running on
  // scroll until a placement lands, and stops for good once one has.
  const proj = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: proj.dir, plan: DEEP_PLAN });
    await page.goto("/");
    await planSurface(page);
    // The references resolve and tag while off screen; the badges wait for a view.
    await expect(page.locator("[data-file-ref]")).toHaveCount(2);
    // Spend the frame budget FIRST, so what follows proves the scroll placed the
    // badge rather than the initial retry happening to still be alive.
    await spendFrameBudget(page);
    await expect(fileBadge(page)).toHaveCount(0);
    await expect(dirBadge(page)).toHaveCount(0);

    await page
      .locator(PLAN_SURFACE)
      .evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "instant" }));

    await expect(fileBadge(page)).toHaveCount(1);
    await expect(dirBadge(page)).toHaveCount(1);
    // And it landed on its token rather than anywhere the scroll happened to stop.
    await expectOnCorner(page, FILE_BADGE, '[data-file-ref=""]');
  } finally {
    await proj.cleanup();
  }
});

test("a placed badge is never re-anchored by a later scroll", async ({ daemon, page }) => {
  // The other half of the same rule: looking continues only until a placement
  // lands. Once a badge is on its token, scrolling must move it with the rows —
  // content coordinates — and never re-pick a different reference to sit on.
  const proj = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: proj.dir, plan: `${PLAN}\n${"\nFiller line.\n".repeat(60)}` });
    await openPlan(page);
    await expect(fileBadge(page)).toHaveCount(1);
    const corner = await pillTopRight(page, '[data-file-ref=""]');
    const at = await badgeCenter(page, FILE_BADGE);
    const offset = { x: at.x - corner!.x, y: at.y - corner!.y };

    await page.locator(PLAN_SURFACE).evaluate((el) => el.scrollBy({ top: 200 }));

    // Same token, same offset from it — it travelled with the row.
    await expect(fileBadge(page)).toHaveCount(1);
    const movedCorner = await pillTopRight(page, '[data-file-ref=""]');
    expect(movedCorner!.y).not.toBe(corner!.y);
    const movedAt = await badgeCenter(page, FILE_BADGE);
    expect(Math.abs(movedAt.x - movedCorner!.x - offset.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(movedAt.y - movedCorner!.y - offset.y)).toBeLessThanOrEqual(1.5);
  } finally {
    await proj.cleanup();
  }
});

test("the badges hold their place across the poll", async ({ daemon, page }) => {
  // The 2s poll re-delivers the same version and the library repaints its shadow
  // rows; the badges are keyed on their kind, so their instances — and the ping
  // animation running on them — must survive that untouched rather than being
  // re-measured or remounted on every tick.
  const proj = await makeProject(PROJECT);
  try {
    await daemon.seed({ cwd: proj.dir, plan: PLAN });
    await openPlan(page);
    await expect(fileBadge(page)).toHaveCount(1);
    const before = await badgeCenter(page, FILE_BADGE);

    await waitForTwoPollTicks(page);

    await expect(fileBadge(page)).toHaveCount(1);
    await expect(dirBadge(page)).toHaveCount(1);
    expect(await badgeCenter(page, FILE_BADGE)).toEqual(before);
  } finally {
    await proj.cleanup();
  }
});

test("a new version re-measures the badges against the document it delivered", async ({
  daemon,
  page,
}) => {
  // The surface is NOT remounted for a version switch — the library re-renders into
  // the very same container element, so the host the badges were measured against is
  // unchanged and only the content key moves. A guard watching the host alone would
  // return early here and leave v1's badges hanging at v1's coordinates over v2,
  // holding tokens v2's re-render detached. The second plan pushes its references
  // down the page precisely so stale coordinates cannot pass.
  const proj = await makeProject(PROJECT);
  try {
    const id = await daemon.seed({ cwd: proj.dir, plan: PLAN });
    await openPlan(page);
    await expect(fileBadge(page)).toHaveCount(1);
    const before = await badgeCenter(page, FILE_BADGE);

    await daemon.addVersion(id, `# Refs\n\nA paragraph that pushes the references down.\n${PLAN}`);
    await expect(page.locator(".diffview")).toContainText("pushes the references down");

    // Re-measured against v2: the badge tracks its token to the new position rather
    // than staying where v1 put it. Retried, because the measure lands a frame or
    // two after the rows repaint.
    await expect(async () => {
      await expectOnCorner(page, FILE_BADGE, '[data-file-ref=""]');
      expect((await badgeCenter(page, FILE_BADGE)).y).not.toBe(before.y);
    }).toPass();
    await expect(fileBadge(page)).toHaveCount(1);
    await expect(dirBadge(page)).toHaveCount(1);
  } finally {
    await proj.cleanup();
  }
});

// The dev fixture, against the repo it cites. Every synthetic plan above is a few
// lines long and finishes laying out in one frame, which is exactly why none of them
// caught the two defects this covers: on a real plan the content above a reference
// keeps settling after first paint (a font arriving, shiki repainting, an over-wide
// fenced block moving into its own card), and the two kinds are screenfuls apart
// rather than on one line. `mise run dev` renders this same file, so a reviewer
// eyeballing the badge and this spec are looking at the same thing.
const FAKE_PLAN_PATH = "scripts/tasks/dev/fake-plan.md";

test("the dev fake plan badges both kinds, each on its own token", async ({ daemon, page }) => {
  const repoRoot = process.cwd();
  const plan = readFileSync(join(repoRoot, FAKE_PLAN_PATH), "utf8");
  // The repo itself is the cwd, so the plan's citations resolve the way they do
  // under `mise run dev`.
  await daemon.seed({ cwd: repoRoot, plan });
  await page.goto("/");
  await planSurface(page);
  await expect(page.locator("[data-file-ref]").first()).toBeAttached();

  /** Scroll the first reference of a kind into view and assert its badge lands on
   * it. Retried: the anchor re-derives as the content settles, so the claim is
   * that it converges on the token, not that it is right on the first frame. */
  const check = async (selector: string, name: string) => {
    await page.evaluate((sel) => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      sh?.querySelector(sel)?.scrollIntoView({ block: "center" });
    }, selector);
    await expect(page.getByRole("button", { name })).toHaveCount(1);
    await expect(() => expectOnCorner(page, name, selector)).toPass();
  };

  // The file reference first, then the directory one — which lives several
  // screenfuls further down, so it can only be picked up on a later scroll.
  await check('[data-file-ref=""]', FILE_BADGE);
  await check('[data-file-ref="directory"]', DIR_BADGE);
  // And the first badge is still there, still on its own token.
  await expect(fileBadge(page)).toHaveCount(1);
});

test("compare mode shows no badge, and spends neither hint", async ({ daemon, page }) => {
  // The badges belong to the single-version surface. Compare mode is a clean diff
  // with no reference affordance to teach, so both are absent — and because nothing
  // rendered, neither flag was spent: leaving compare mode teaches as it would have.
  const proj = await makeProject(PROJECT);
  try {
    // Two versions, because the compare control is disabled with only one. Threading
    // a revision leaves the review's cwd alone (threading.ts appends to the existing
    // record), so the cited project still resolves at v2.
    const id = await daemon.seed({ cwd: proj.dir, plan: PLAN });
    await daemon.addVersion(id, `${PLAN}\nA second revision.\n`);
    await openPlan(page);
    await expect(fileBadge(page)).toHaveCount(1);

    const compare = page.getByRole("button", { name: "Versions" });
    await compare.click();
    await expect(fileBadge(page)).toHaveCount(0);
    await expect(dirBadge(page)).toHaveCount(0);

    // Back on the single-version surface the hints return, measured against the
    // freshly mounted source view rather than the one compare mode tore out.
    await compare.click();
    await expect(fileBadge(page)).toHaveCount(1);
    await expect(dirBadge(page)).toHaveCount(1);
  } finally {
    await proj.cleanup();
  }
});
