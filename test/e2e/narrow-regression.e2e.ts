// EXC-814: narrow-width cohesion regression — the integration guard for the
// EXC-770 responsive effort. The per-surface specs (toc-collapse, topbar-overflow,
// version-compare, pinned-chrome, dialog-narrow) each own one surface in detail;
// this spec asserts the *whole* review UI stays usable at the canonical breakpoints
// — the ToC toggle works, the TopBar's secondary actions stay reachable, and no
// surface pushes the document past the viewport. Width- and layout-driven behavior
// only a browser can decide (doc/agents/browser-testing.md), so it lives here.
//
// Breakpoints are imported from ui/src/lib/layout.ts — the canonical source the
// @media px literals mirror, and the same node-free constants playwright.config.ts
// already derives its viewport from — so this spec tracks the real breakpoints
// instead of hardcoding regime literals.

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { MIN_APP_WIDTH_PX, NARROW_WIDTH_PX, TIGHT_WIDTH_PX } from "@ui/src/lib/layout.ts";

test("no surface overflows the viewport horizontally across the breakpoint sweep", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // The layout is designed to fit down to MIN_APP_WIDTH_PX and only scroll
  // horizontally *below* that floor, so at each breakpoint the document must not
  // exceed the viewport. A long cwd used to blow the floor by ~50px (EXC-814); the
  // guarantee now holds whether the ToC rail is open or collapsed (the plan's wide
  // code scrolls inside its own pane, not the document). expect.poll absorbs the
  // matchMedia-driven reflow after each resize; the 1px slack covers sub-pixel
  // rounding of scrollWidth, well under any real regression.
  for (const width of [NARROW_WIDTH_PX, TIGHT_WIDTH_PX, MIN_APP_WIDTH_PX]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
        message: `document overflows the ${width}px viewport horizontally`,
      })
      .toBeLessThanOrEqual(1);
  }
});

test("the ToC toggle stays usable at a narrow width", async ({ daemon, page }) => {
  await daemon.seed();
  await page.setViewportSize({ width: TIGHT_WIDTH_PX, height: 900 });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  const toggle = page.getByRole("button", { name: "Toggle sidebar" });
  const rail = page.locator("#plan-toc");
  await expect(toggle).toBeVisible();

  // Toggling flips aria-expanded and zeroes/restores the rail lane, from whatever
  // the width-driven default is. toc-collapse.e2e.ts owns the default + persistence
  // detail; here we only guard that the control still works in the narrow regime.
  const startedExpanded = (await toggle.getAttribute("aria-expanded")) === "true";
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", String(!startedExpanded));
  if (startedExpanded) {
    await expect(rail).toHaveCSS("width", "0px");
  } else {
    await expect(rail).not.toHaveCSS("width", "0px");
  }
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", String(startedExpanded));
});

test("TopBar secondary actions stay reachable via the overflow menu at a narrow width", async ({
  daemon,
  page,
}) => {
  await daemon.seed();
  await page.setViewportSize({ width: TIGHT_WIDTH_PX, height: 900 });
  await page.goto("/");
  await expect(page.locator(".diff-plan")).toBeVisible();

  // Below --w-narrow the inline Reject / Request-changes buttons collapse into the
  // "More actions" overflow menu (EXC-810); the integration guarantee is that they
  // remain reachable there rather than disappearing. topbar-overflow.e2e.ts owns the
  // per-variant detail.
  await expect(page.locator(".reject")).toBeHidden();
  await expect(page.locator(".request")).toBeHidden();
  const overflow = page.getByRole("button", { name: "More actions" });
  await expect(overflow).toBeVisible();
  await overflow.click();
  await expect(page.getByRole("menuitem", { name: "Request changes" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Reject" })).toBeVisible();
});
