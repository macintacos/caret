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

import { expect, test } from "@test/e2e/support/fixtures.ts";

const SAFE_URL = "https://docs.example.test/widget-cache";
// An http link (display collapses to its label), a plain-prose row with no link
// at all (for the "ordinary token" hover check, kept off any link's line so it's
// robust to the canonical wrap width), and a javascript:-scheme inline link the
// layer must NOT make clickable.
const LINK_PLAN = `# Link Plan

See [the cache docs](${SAFE_URL}) for the warm-restart design.

Plain prose on its own row names the cold-standby token, nothing clickable.

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

test("clicking a link token does not also open the line's comment composer", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // The read-write source view wires BOTH the link layer and row-click
  // commenting, so a single event reaches the token-click handler (which opens
  // the link) and then the line-click handler (which would open a composer). The
  // composition's link-click/row-click race coordination makes the line stand
  // down: the library fires the token click first, the composed handler records
  // that event, and the row-click handler sees it was consumed and does nothing.
  await expect(page.getByText("the cache docs")).toBeVisible();
  await stubWindowOpen(page);
  await page.getByText("the cache docs").click();

  // The link opened in a new tab…
  await expect
    .poll(async () => (await openCalls(page))[0])
    .toEqual([SAFE_URL, "_blank", "noopener,noreferrer"]);

  // …and the line it sits on did NOT also open a comment composer. Give any
  // (incorrect) composer a beat to appear, then assert it never did.
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => performance.now() > t + 300, t0);
  await expect(composer).toHaveCount(0);
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

test("a link is marked before any hover, over its label only", async ({ daemon, page }) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();
  await expect(page.getByText("the cache docs")).toBeVisible();

  // The display collapse leaves a link tokenized as ordinary prose, so
  // its resting appearance comes from the caret-link CSS Custom Highlight — the
  // only marker there is with the pointer elsewhere. Assert the painted ranges,
  // not a computed style: ::highlight() styling is unreachable from
  // getComputedStyle, and it is the RANGES that carry the fix (coreStyles.test.ts
  // pins the tint + dotted underline the rule paints them with).
  const marked = () =>
    page.evaluate(() => [...(CSS.highlights.get("caret-link") ?? [])].map((r) => r.toString()));
  await expect.poll(marked).toContain("the cache docs");

  // Over the label ONLY. The line is one shiki token, so a mark that leaked to
  // the token would underline the whole sentence — the reason this is a highlight
  // and not a data-attribute tag like data-file-ref.
  expect(await marked()).not.toContain("See the cache docs for the warm-restart design.");

  // The javascript:-scheme link is not clickable, so it is not marked either —
  // the mark tracks the same spans the click handler does.
  expect((await marked()).join("\n")).not.toContain("this control");
});

test("hovering an ordinary code token reveals no tooltip", async ({ daemon, page }) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // "cold-standby" is plain prose on a row with no link at all; hovering it
  // produces no tooltip. Kept off the link's line so the check is about the
  // hovered token, not line layout under the canonical wrap width. Scope to the
  // diff surface so it doesn't collide with the titlebar, and target it uniquely.
  const plain = page.locator(".diffview").getByText("cold-standby", { exact: false });
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
