// Shared source-view gestures for the e2e specs. @pierre/diffs renders every
// source line inside the .diffview host's open shadow root, keyed by
// data-line-index on the row and data-line-number-content on its gutter cell.
// That DOM contract is the library's, not caret's — it moves when the library
// moves — so the specs that drive the gutter read it from here rather than each
// re-deriving it (typescript-rules.md § Shared-helper policy).

import { expect, type Locator, type Page } from "@playwright/test";

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
 * source view's gutter sits at the left of the .diff-plan scroll container, which
 * the contents pane shifts right when present — so anchor the hover to that
 * container's left edge rather than the viewport's. The 6px inset lands inside
 * the gutter column without reaching the line-number cell. */
export async function revealGutterPlus(page: Page, line: number): Promise<Locator> {
  const y = await lineCenterY(page, line);
  const x = await page.locator(".diff-plan").evaluate((el) => el.getBoundingClientRect().x + 6);
  await page.mouse.move(x, y);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  return plus;
}
