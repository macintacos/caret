// Clickable links on the source-view surface. The plan renders as markdown
// source through @pierre/diffs; the link layer simplifies `[label](url)` to its
// label and records a clickable span carrying the http(s) href. A target that is
// a path rather than a URL also simplifies, but emits a file reference instead of
// a clickable span (EXC-954) — that path is covered by file-refs.e2e.ts, not
// here, and nothing in it can reach window.open. A real token
// click runs through the library's per-token pointer pipeline (which only exists
// in a real browser — see SourceViewLinks.test.ts), so the click-opens-a-tab
// path and the dangerous-scheme guard are exercised here as e2e, while the pure
// transform and hit-test stay units (links.test.ts, linkInteractions.test.ts).
//
// window.open is stubbed in-page so the assertion reads the exact arguments the
// production opener (openLinkInNewTab) passes, with no real cross-origin
// navigation: the test owns the seam the daemon serves, not the wider web.

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

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

/** Viewport points on the link's row: the centre of the link label itself, and a
 * spot on the same row well past the label but still over its rendered text.
 *
 * The decoration pass (inlineDecorate.ts) cuts the row at the link's own columns,
 * so the label and the prose after it are separate token elements. Both still route
 * through the library's one per-token pointer pipeline, so what separates them is
 * still the pointer position rather than two different handlers — which is what
 * these points exist to drive. The label's box comes from that element itself — the
 * one the chip paints (EXC-859) — so the point is measured off the thing being
 * clicked; the off-label point sits just inside the end of the row's rendered text. */
async function rowPoints(
  page: import("@playwright/test").Page,
): Promise<{ onLabel: { x: number; y: number }; offLabel: { x: number; y: number } }> {
  // The row is tagged a frame after it renders; wait for the element rather than
  // measure before the decoration pass has run.
  await page.waitForFunction(() => {
    const root = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return (root?.querySelectorAll('[data-md~="link"]').length ?? 0) > 0;
  });
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement).shadowRoot!;
    const label = sh.querySelector('[data-md~="link"]')!.getBoundingClientRect();
    const token = [...sh.querySelectorAll("[data-char]")].find((el) =>
      el.textContent?.includes("warm-restart"),
    )!;
    const line = token.getBoundingClientRect();
    const y = label.top + label.height / 2;
    return {
      onLabel: { x: label.left + label.width / 2, y },
      offLabel: { x: line.right - 4, y },
    };
  });
}

test("clicking a link token opens its http URL in a new tab", async ({ daemon, page }) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await planSurface(page);

  // The inline link renders as its label only; the raw URL syntax is gone.
  await expect(page.getByText("the cache docs")).toBeVisible();
  await stubWindowOpen(page);

  // A real click on the label runs the library's pointer pipeline, which
  // hit-tests the pointer against the link span and calls the new-tab opener.
  // Aimed at the label's own columns. The row is split at those columns, so this
  // is the label's own element rather than a point inside a sentence-wide token.
  const { onLabel } = await rowPoints(page);
  await page.mouse.click(onLabel.x, onLabel.y);

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
  await planSurface(page);

  // The read-write source view wires BOTH the link layer and row-click
  // commenting, so a single event reaches the token-click handler (which opens
  // the link) and then the line-click handler (which would open a composer). The
  // composition's link-click/row-click race coordination makes the line stand
  // down: the library fires the token click first, the composed handler records
  // that event, and the row-click handler sees it was consumed and does nothing.
  await expect(page.getByText("the cache docs")).toBeVisible();
  await stubWindowOpen(page);
  const { onLabel } = await rowPoints(page);
  await page.mouse.click(onLabel.x, onLabel.y);

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

test("clicking the link's row away from its label opens no tab, only the composer", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("the cache docs")).toBeVisible();
  await stubWindowOpen(page);

  // Past the label. This still reaches the same per-token pointer handler the
  // label's click does — the row is split, but the library routes every token
  // through one pipeline — and only the pointer position says it is not on the
  // link. It must fall through to the row, exactly as a click on a row with no
  // link at all does.
  const { offLabel } = await rowPoints(page);
  await page.mouse.click(offLabel.x, offLabel.y);

  // The row's own affordance ran…
  await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
  // …and no tab was opened for a link the pointer was never over.
  expect(await openCalls(page)).toEqual([]);
});

test("hovering the link's row away from its label reveals no tooltip", async ({ daemon, page }) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("the cache docs")).toBeVisible();

  const { onLabel, offLabel } = await rowPoints(page);
  // Enter the token over the label (the tooltip shows), then travel along the
  // same token past the label's columns: the pointer never leaves the token, so
  // only in-token tracking can retract the tooltip and the pointer cursor.
  await page.mouse.move(onLabel.x, onLabel.y);
  await expect.poll(() => tooltipHref(page)).toBe(SAFE_URL);
  await page.mouse.move(offLabel.x, offLabel.y);
  await expect.poll(() => tooltipHref(page)).toBeNull();
});

test("hovering a link token reveals a caret tooltip with the full href, not a native title", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await planSurface(page);

  const link = page.getByText("the cache docs");
  await expect(link).toBeVisible();
  // No tooltip until the pointer is over the link.
  expect(await tooltipHref(page)).toBeNull();

  // A real hover runs the library's per-token pointer pipeline, which hit-tests
  // the pointer against the link span and reveals the caret tooltip carrying the
  // full URL — inside the shadow root, on caret's surface. Aimed at the label's
  // own columns, which after the decoration pass are its own element.
  const { onLabel } = await rowPoints(page);
  await page.mouse.move(onLabel.x, onLabel.y);
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

test("a link wears its chip before any hover, over its label only", async ({ daemon, page }) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await planSurface(page);
  await expect(page.getByText("the cache docs")).toBeVisible();

  // The collapse leaves the bare label as the only thing on the row saying a link is
  // there, so the chip is its whole resting appearance. Tagged over the label ONLY:
  // the decoration pass cuts the row at the link's own columns, so a tag that leaked
  // past them would chip the sentence around it. The javascript:-scheme link is
  // refused before the chip is ever consulted and so carries no tag either — a chip
  // there would imply a target the reader can follow.
  const tagged = () =>
    page.evaluate(() => {
      const root = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
      return [...(root?.querySelectorAll('[data-md~="link"]') ?? [])].map((el) => el.textContent);
    });
  await expect.poll(tagged).toEqual(["the cache docs"]);

  // And it really paints in the real browser. The chip rides an element rather than a
  // ::highlight() pseudo, whose styling getComputedStyle cannot see at all, so this can
  // assert the resolved paint rather than only the region it was aimed at: at least one
  // background layer serializes as something other than a fully transparent gradient,
  // the pill closes with a real radius, and the label carries its dotted underline.
  const painted = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement).shadowRoot!;
    const style = getComputedStyle(sh.querySelector('[data-md~="link"]') as HTMLElement);
    return {
      layers: style.backgroundImage.split(/,\s*(?=linear-gradient)/),
      radius: style.borderStartStartRadius,
      decoration: style.textDecorationLine,
    };
  });
  expect(painted.layers.some((layer) => !layer.includes("rgba(0, 0, 0, 0)"))).toBe(true);
  expect(painted.radius).not.toBe("0px");
  expect(painted.decoration).toContain("underline");
});

test("hovering an ordinary code token reveals no tooltip", async ({ daemon, page }) => {
  await daemon.seed({ plan: LINK_PLAN });
  await page.goto("/");
  await planSurface(page);

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
  await planSurface(page);

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
