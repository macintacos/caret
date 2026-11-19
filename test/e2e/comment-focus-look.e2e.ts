// The keyboard cursor's stop wears the stop's hover look: a focused comment card takes the
// card's hover paper, and a focused Resume marker's cap takes its hover face. Only a real
// browser resolves the painted colours, and the cursor needs the global key dispatcher.

import type { Locator, Page } from "@playwright/test";

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { awaitPlanReadyForKeys, lineOf } from "@test/e2e/support/source-view.ts";

const PLAN = ["# Look", "", "Alpha line.", "", "Bravo line.", "", "Charlie line.", ""].join("\n");

/** The painted face of `el`: its background colour and any image layered on it. */
const face = (el: Locator): Promise<string> =>
  el.evaluate((node) => {
    const s = getComputedStyle(node);
    return `${s.backgroundColor} ${s.backgroundImage}`;
  });

async function toLine(page: Page, text: string): Promise<void> {
  await page.keyboard.press("/");
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
}

test("the keyboard-focused card wears the hover paper, and rests again once left", async ({
  daemon,
  page,
}) => {
  const id = await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await awaitPlanReadyForKeys(page);
  const note = (cid: string, line: number) => ({
    id: cid,
    startLine: line,
    endLine: line,
    comment: `note ${cid}`,
  });
  await daemon.putDraft(id, {
    annotations: [
      note("a", await lineOf(page, "Alpha line.")),
      note("c", await lineOf(page, "Charlie line.")),
    ],
  });
  await page.reload();
  await awaitPlanReadyForKeys(page);
  await page.mouse.move(0, 0);
  const a = page.locator('[data-annotation-card="a"]');
  const c = page.locator('[data-annotation-card="c"]');
  await expect(c).toBeVisible();
  const rest = await face(c);

  await toLine(page, "Alpha");
  await page.keyboard.press("j");
  await expect(a).toHaveClass(/\bfocused\b/);
  await expect.poll(() => face(a)).not.toBe(rest);

  await page.keyboard.press("j");
  await expect(a).not.toHaveClass(/\bfocused\b/);
  await expect.poll(() => face(a)).toBe(rest);
});

test("the keyboard-focused Resume marker's cap wears its hover face", async ({ daemon, page }) => {
  const id = await daemon.seed({ plan: PLAN });
  await page.goto("/");
  await awaitPlanReadyForKeys(page);
  const line = await lineOf(page, "Bravo line.");
  await daemon.putDraft(id, {
    composerScratches: [{ startLine: line, endLine: line, text: "half a thought" }],
  });
  await page.reload();
  await awaitPlanReadyForKeys(page);
  await page.mouse.move(0, 0);
  const marker = page.locator("[data-scratch-marker]");
  const cap = marker.locator(".resume");
  await expect(cap).toBeVisible();
  const rest = await face(cap);

  await toLine(page, "Bravo");
  await page.keyboard.press("j");
  await expect(marker).toHaveClass(/\bfocused\b/);
  await expect.poll(() => face(cap)).not.toBe(rest);

  await page.keyboard.press("j");
  await expect(marker).not.toHaveClass(/\bfocused\b/);
  await expect.poll(() => face(cap)).toBe(rest);
});
