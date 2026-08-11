// The source view's DOM contracts, in one place (typescript-rules.md § Shared-helper
// policy). Two kinds live here. @pierre/diffs renders every source line inside the
// .diffview host's open shadow root, keyed by data-line-index on the row and
// data-line-number-content on its gutter cell — that contract is the library's, not
// caret's, and it moves when the library moves. And caret's own plan scroll container
// (PLAN_SURFACE) plus the readiness wait nearly every spec opens with, so a rename of
// either reaches one edit rather than every spec.
//
// Locators for the chrome AROUND the plan — the navigator, the tally, the breadcrumbs
// — live in chrome.ts, where they are named by role rather than by class.

import type { Locator, Page } from "@playwright/test";

import { currentCrumb } from "@test/e2e/support/chrome.ts";
import { expect, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";

/**
 * The plan's scroll container.
 *
 * `DiffPlanView` marks it `role="presentation"` deliberately, so the element itself
 * carries no semantics for assistive tech and there is no role to query; it has no
 * `data-*` hook either, which leaves the class as the only handle. Naming it once
 * means a rename is one edit rather than every spec that waits for the plan.
 */
export const PLAN_SURFACE = ".diff-plan";

/**
 * Resolve once the seeded plan has rendered.
 *
 * Nearly every spec opens by waiting for the plan before it does anything else, so
 * the wait lives here rather than being re-derived per spec. Returns the container
 * for the callers that go on to scroll it or scope a query inside it.
 */
export async function planSurface(page: Page): Promise<Locator> {
  const plan = page.locator(PLAN_SURFACE);
  await expect(plan).toBeVisible();
  return plan;
}

/** The vertical center (viewport px) of a 1-based source line's row. Throws when
 * the line is not rendered, so a wrong line number fails here rather than as an
 * unrelated miss on whatever the resulting coordinates happened to hit. */
export async function lineCenterY(page: Page, line: number): Promise<number> {
  const y = await page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const span = Array.from(sh?.querySelectorAll("[data-line-number-content]") ?? []).find(
      (s) => (s.parentElement as HTMLElement)?.dataset.lineIndex === String(ln - 1),
    );
    const r = (span?.parentElement as HTMLElement)?.getBoundingClientRect();
    return r ? r.y + r.height / 2 : null;
  }, line);
  if (y === null) throw new Error(`source line ${line} is not rendered`);
  return y;
}

/** Reveal the gutter `+` on `line` by moving the mouse over its left edge. The
 * source view's gutter sits at the left of the plan surface — so
 * anchor the hover to that container's left edge rather than the viewport's,
 * which keeps working wherever the pane sits. The 6px inset lands inside the
 * gutter column without reaching the line-number cell. */
export async function revealGutterPlus(page: Page, line: number): Promise<Locator> {
  const y = await lineCenterY(page, line);
  const x = await page.locator(PLAN_SURFACE).evaluate((el) => el.getBoundingClientRect().x + 6);
  await page.mouse.move(x, y);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  return plus;
}

/** Scroll the plan to any heading through the breadcrumbs bar's flat filter — the
 * surface that replaced the contents rail (EXC-949), and the only one that reaches
 * an arbitrary heading in one step. Several specs arrange a reading position this
 * way, so the gesture lives here rather than being re-derived per spec.
 *
 * Two waits are load-bearing rather than defensive. Safe mode guards keydown on
 * `window` in the CAPTURE phase and calls stopImmediatePropagation, so a `/` inside
 * its grace never reaches the menu's own handler and the filter silently never
 * opens. And `/` is handled on the menu's Content element, so it only lands once
 * bits-ui's open-auto-focus has moved focus inside the portalled panel — waiting for
 * the panel makes a miss fail here instead of 30s later on the query field.
 *
 * The query is filled rather than typed, and Enter from the field selects the first
 * result, so callers pass a heading whose text is unique within the plan. */
export async function jumpToHeading(page: Page, heading: string): Promise<void> {
  await waitPastSafeModeGrace(page);
  await currentCrumb(page).click();
  await expect(page.locator("[data-slot='dropdown-menu-content']")).toBeVisible();
  await page.keyboard.press("/");
  await page.locator("input[aria-label='Filter headings']").fill(heading);
  await page.keyboard.press("Enter");
}
