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

import type { Page } from "@playwright/test";

import { makeProject } from "@test/e2e/support/file-refs.ts";
import { expect, test, waitForTwoPollTicks } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

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

const FILE_BADGE = "Preview this file";
const DIR_BADGE = "Browse this folder";

const fileBadge = (page: Page) => page.getByRole("button", { name: FILE_BADGE });
const dirBadge = (page: Page) => page.getByRole("button", { name: DIR_BADGE });

/** The first client rect's top-right of the first token matching `selector`, read
 * from inside the plan's shadow root. The FIRST rect rather than the bounding box:
 * a wrapped path has two fragments and a union box whose corner the text never
 * occupies, which is the corner the badge deliberately does not use. */
function tokenTopRight(page: Page, selector: string): Promise<{ x: number; y: number } | null> {
  return page.evaluate((sel) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const rect = sh?.querySelector(sel)?.getClientRects()[0];
    return rect === undefined ? null : { x: rect.right, y: rect.top };
  }, selector);
}

/** The badge's own center — it is translated onto the anchor, so this is the point
 * that must land on the token's corner. */
async function badgeCenter(page: Page, name: string): Promise<{ x: number; y: number }> {
  const box = await page.getByRole("button", { name }).boundingBox();
  if (box === null) throw new Error(`badge "${name}" has no box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
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

test("each badge sits on its token's top-right corner", async ({ daemon, page }) => {
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
    const fileCorner = await tokenTopRight(page, '[data-file-ref=""]');
    const dirCorner = await tokenTopRight(page, '[data-file-ref="directory"]');
    expect(fileCorner).not.toBeNull();
    expect(dirCorner).not.toBeNull();

    // A pixel of slack for sub-pixel glyph metrics; anything larger would mean the
    // badge is anchored to the wrong token or to a union box.
    const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(1.5);
    const fileAt = await badgeCenter(page, FILE_BADGE);
    near(fileAt.x, fileCorner!.x);
    near(fileAt.y, fileCorner!.y);
    const dirAt = await badgeCenter(page, DIR_BADGE);
    near(dirAt.x, dirCorner!.x);
    near(dirAt.y, dirCorner!.y);
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

    await page.keyboard.press("Enter");
    await expect(page.locator("[data-file-preview]")).toBeVisible();
    await expect(fileBadge(page)).toHaveCount(0);
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
      const corner = await tokenTopRight(page, '[data-file-ref=""]');
      expect(corner).not.toBeNull();
      const at = await badgeCenter(page, FILE_BADGE);
      expect(Math.abs(at.y - corner!.y)).toBeLessThanOrEqual(1.5);
      expect(at.y).not.toBe(before.y);
    }).toPass();
    await expect(fileBadge(page)).toHaveCount(1);
    await expect(dirBadge(page)).toHaveCount(1);
  } finally {
    await proj.cleanup();
  }
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

    const compare = page.getByRole("button", { name: "Compare versions" });
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
