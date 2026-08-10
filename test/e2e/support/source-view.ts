// Shared source-view gestures for the e2e specs. @pierre/diffs renders every
// source line inside the .diffview host's open shadow root, keyed by
// data-line-index on the row and data-line-number-content on its gutter cell.
// That DOM contract is the library's, not caret's — it moves when the library
// moves — so the specs that drive the gutter read it from here rather than each
// re-deriving it (typescript-rules.md § Shared-helper policy).

import { expect, type Locator, type Page } from "@playwright/test";

import { waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";

/**
 * The plan's scroll container.
 *
 * `DiffPlanView` marks it `role="presentation"` deliberately, so it is out of the
 * accessibility tree and there is no role to query — an attribute anchor is the
 * correct locator here, not a fallback. Naming it once means a class rename is one
 * edit rather than every spec that waits for the plan.
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
 * source view's gutter sits at the left of the .diff-plan scroll container — so
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
  await page.locator(".plan-breadcrumbs button.crumb.current").click();
  await expect(page.locator("[data-slot='dropdown-menu-content']")).toBeVisible();
  await page.keyboard.press("/");
  await page.locator("input[aria-label='Filter headings']").fill(heading);
  await page.keyboard.press("Enter");
}
