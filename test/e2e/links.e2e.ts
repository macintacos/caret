// Clickable links on the source-view surface. The plan renders as markdown
// source through @pierre/diffs; the link layer simplifies `[label](url)` to its
// label and records a clickable span carrying the http(s) href. A real token
// click runs through the library's per-token pointer pipeline (which only exists
// in a real browser — see SourceViewLinks.test.ts), so the click-opens-a-tab
// path and the dangerous-scheme guard are exercised here as e2e, while the pure
// transform and hit-test stay units (links.test.ts, linkInteractions.test.ts).
//
// window.open is stubbed in-page so the assertion reads the exact arguments the
// production opener (openLinkInNewTab) passes, with no real cross-origin
// navigation: the test owns the seam the daemon serves, not the wider web.

import { expect, test } from "./support/fixtures.ts";

const SAFE_URL = "https://docs.example.test/widget-cache";
// An http link (display collapses to its label) and, on a later line, a
// javascript:-scheme inline link the layer must NOT make clickable.
const LINK_PLAN = `# Link Plan

See [the cache docs](${SAFE_URL}) for the warm-restart design.

Do not trust [this control](javascript:alert(1)) — it is not a link.
`;

/** Replace window.open with a recorder and return a reader for its calls. */
async function stubWindowOpen(page: import("@playwright/test").Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { __open: unknown[][] }).__open = [];
    window.open = ((...args: unknown[]) => {
      (window as unknown as { __open: unknown[][] }).__open.push(args);
      return null;
    }) as typeof window.open;
  });
}

function openCalls(page: import("@playwright/test").Page): Promise<unknown[][]> {
  return page.evaluate(() => (window as unknown as { __open: unknown[][] }).__open);
}

test("clicking a link token opens its http URL in a new tab", async ({ daemon, page }) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // The inline link renders as its label only; the raw URL syntax is gone.
  await expect(page.getByText("the cache docs")).toBeVisible();
  await stubWindowOpen(page);

  // A real click on the label token runs the library's pointer pipeline, which
  // hit-tests the token against the link span and calls the new-tab opener.
  await page.getByText("the cache docs").click();

  await expect
    .poll(async () => (await openCalls(page))[0])
    .toEqual([SAFE_URL, "_blank", "noopener,noreferrer"]);
});

/** The full href text of the caret hover tooltip mounted in the diff shadow
 * root, or null when none is shown. */
function tooltipHref(page: import("@playwright/test").Page): Promise<string | null> {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    return sh?.querySelector("[data-link-tooltip]")?.textContent ?? null;
  });
}

test("hovering a link token reveals a caret tooltip with the full href, not a native title", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const link = page.getByText("the cache docs");
  await expect(link).toBeVisible();
  // No tooltip until the pointer is over the link.
  expect(await tooltipHref(page)).toBeNull();

  // A real hover runs the library's per-token pointer pipeline, which hit-tests
  // the token against the link span and reveals the caret tooltip carrying the
  // full URL — inside the shadow root, on caret's surface.
  await link.hover();
  await expect.poll(() => tooltipHref(page)).toBe(SAFE_URL);

  // The reveal is the caret tooltip, not the native browser chrome: the token
  // carries no `title` attribute, and the tooltip's background resolves to an
  // opaque caret surface (the --diffs-link-tooltip-bg bridge var took effect in
  // the real Chromium build, not just the static stylesheet).
  expect(await link.getAttribute("title")).toBeNull();
  const bg = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    const tip = sh?.querySelector("[data-link-tooltip]") as HTMLElement | null;
    return tip ? getComputedStyle(tip).backgroundColor : null;
  });
  expect(bg).not.toBeNull();
  expect(bg).not.toBe("rgba(0, 0, 0, 0)");

  // Moving the pointer off the link dismisses the tooltip — no scroll listener,
  // no residue: onTokenLeave removes it.
  await page.mouse.move(0, 0);
  await expect.poll(() => tooltipHref(page)).toBeNull();
});

test("hovering an ordinary code token reveals no tooltip", async ({ daemon, page }) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // "warm-restart" is plain prose in the diff body carrying no link span;
  // hovering it produces no tooltip. Scope to the diff surface so it doesn't
  // collide with the titlebar, and target the token uniquely.
  const plain = page.locator(".diffview").getByText("warm-restart", { exact: false });
  await expect(plain.first()).toBeVisible();
  await plain.first().hover();

  // No positive event to await — give the pointer pipeline a beat, then assert
  // the tooltip never appeared.
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => performance.now() > t + 300, t0);
  expect(await tooltipHref(page)).toBeNull();
});

test("clicking a dangerous-scheme token opens no tab", async ({ daemon, page }) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // The javascript:-scheme link is left as literal markdown source with no
  // clickable span, so its label token "this control" carries no link.
  const label = page.getByText("this control", { exact: true });
  await expect(label).toBeVisible();
  await stubWindowOpen(page);
  await label.click();

  // Give any (incorrect) open a beat to land, then assert none did — there is no
  // positive event to await, so poll the condition that must stay empty.
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => performance.now() > t + 500, t0);
  expect(await openCalls(page)).toEqual([]);
});
