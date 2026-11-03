// The working-directory pill in the status bar. It shows the review's cwd from `~` (the
// harness daemon reports a synthetic home of /Users/dev, in daemon-entry.ts), gives up
// whole middle segments when the bar is too narrow, and a click copies the FULL absolute
// path and confirms on the pill itself. Clipboard access, layout and transitions are
// real-browser behaviour, so they are proven here rather than in the happy-dom unit suite
// (per doc/agents/browser-testing.md).

import type { Locator, Page } from "@playwright/test";

import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

const CWD = "/Users/dev/GitLocal/Play/caret";

/** The cwd control, in the status bar. */
const cwdIn = (page: Page): Locator =>
  page.locator("footer.status-bar").getByRole("button", { name: /^Copy path / });

/** The path the pill shows. */
const shownPath = (cwd: Locator): Locator => cwd.locator(".path");

/** Seed with `cwd`, grant clipboard permissions, load the plan, and return the cwd
 * control. */
async function openCwdControl(page: Page, daemon: Daemon, cwd = CWD): Promise<Locator> {
  await daemon.seed({ cwd });
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await planSurface(page);
  return cwdIn(page);
}

/** Records the properties whose transitions start anywhere inside the pill. */
const recordTransitions = (cwd: Locator) =>
  cwd.evaluate((el) => {
    const runs: string[] = [];
    (window as unknown as { cwdRuns: string[] }).cwdRuns = runs;
    el.addEventListener("transitionrun", (e) => {
      if (e instanceof TransitionEvent) runs.push(e.propertyName);
    });
  });

const transitionsRun = (page: Page) =>
  page.evaluate(() => (window as unknown as { cwdRuns: string[] }).cwdRuns);

/** The opacity of the path and of the "Copied" label once their transitions have run. */
const settledOpacities = (cwd: Locator) =>
  cwd.evaluate(async (el) => {
    await Promise.all(
      el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined)),
    );
    const opacity = (selector: string) =>
      Number(getComputedStyle(el.querySelector(selector) as Element).opacity);
    return { path: opacity(".path"), copied: opacity(".copied") };
  });

test("the cwd path reads from ~ and a click copies the absolute path", async ({ daemon, page }) => {
  const cwd = await openCwdControl(page, daemon);
  await expect(shownPath(cwd)).toHaveText("~/GitLocal/Play/caret");

  await cwd.click();

  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe(CWD);
});

test("a path outside home reads as its absolute path", async ({ daemon, page }) => {
  const cwd = await openCwdControl(page, daemon, "/opt/work/proj");
  await expect(shownPath(cwd)).toHaveText("/opt/work/proj");
});

test("a path already written from ~ reads as given", async ({ daemon, page }) => {
  const cwd = await openCwdControl(page, daemon, "~/acme-web");
  await expect(shownPath(cwd)).toHaveText("~/acme-web");
});

test("a copy rolls 'Copied' into the pill, then rolls the path back", async ({ daemon, page }) => {
  const cwd = await openCwdControl(page, daemon);
  await recordTransitions(cwd);

  await cwd.click();

  await expect(cwd).toHaveAttribute("data-copied");
  expect(await settledOpacities(cwd)).toEqual({ path: 0, copied: 1 });
  expect(await transitionsRun(page)).toEqual(expect.arrayContaining(["opacity", "transform"]));

  await expect(cwd).not.toHaveAttribute("data-copied");
  expect(await settledOpacities(cwd)).toEqual({ path: 1, copied: 0 });
});

test("under reduced motion a copy still shows 'Copied' on the pill", async ({ daemon, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const cwd = await openCwdControl(page, daemon);

  await cwd.click();

  await expect(cwd).toHaveAttribute("data-copied");
  expect(await settledOpacities(cwd)).toEqual({ path: 0, copied: 1 });
});

/** The cwd control's box, its status bar's, and the boxes of the bar's other two
 * segments. */
const barBoxes = (cwd: Locator) =>
  cwd.evaluate((el) => {
    const box = (node: Element | null | undefined) => {
      const r = node?.getBoundingClientRect();
      return { left: r?.left ?? 0, right: r?.right ?? 0 };
    };
    const bar = el.closest(".status-bar");
    return {
      bar: box(bar),
      own: box(el),
      start: box(bar?.firstElementChild),
      end: box(bar?.lastElementChild),
    };
  });

/** The path the pill shows, and whether that text overflows its box. */
const fitOf = (cwd: Locator) =>
  shownPath(cwd).evaluate((el) => ({
    text: el.textContent ?? "",
    overflows: el.scrollWidth > el.clientWidth,
  }));

test("the cwd path sits centred on the status bar", async ({ daemon, page }) => {
  const cwd = await openCwdControl(page, daemon);
  const { bar, own } = await barBoxes(cwd);
  // Within the pixel the bar's uneven side insets, which line up with the plan pane, leave.
  expect(Math.abs((own.left + own.right) / 2 - (bar.left + bar.right) / 2)).toBeLessThanOrEqual(1);
});

test("a narrow bar cuts whole middle segments, keeping ~ and the leaf", async ({
  daemon,
  page,
}) => {
  const full = "/Users/dev/GitLocal/Play/clients/acme/services/billing-gateway";
  await page.setViewportSize({ width: 720, height: 800 });
  const cwd = await openCwdControl(page, daemon, full);

  const { text, overflows } = await fitOf(cwd);
  expect(text.startsWith("~/…/")).toBe(true);
  // What follows the ellipsis is the path's own tail, cut at a segment boundary.
  expect(full.endsWith(text.slice("~/…".length))).toBe(true);
  expect(text.endsWith("/billing-gateway")).toBe(true);
  expect(overflows).toBe(false);

  const { own, start, end } = await barBoxes(cwd);
  expect(own.left).toBeGreaterThanOrEqual(start.right);
  expect(own.right).toBeLessThanOrEqual(end.left);
});

test("widening the bar gives the cut segments back", async ({ daemon, page }) => {
  const full = "/Users/dev/GitLocal/Play/clients/acme/services/billing-gateway";
  await page.setViewportSize({ width: 720, height: 800 });
  const cwd = await openCwdControl(page, daemon, full);
  await expect(shownPath(cwd)).toContainText("…");

  await page.setViewportSize({ width: 1600, height: 800 });

  await expect(shownPath(cwd)).toHaveText("~/GitLocal/Play/clients/acme/services/billing-gateway");
});
