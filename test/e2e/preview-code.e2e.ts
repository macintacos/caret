// The preview's code blocks: highlighted for their language in the active theme, plain
// for any fence that names no bundled grammar. Computed fonts and colours, and a theme
// switch driven by the OS colour scheme, need a real browser. The pass's own logic is
// unit-tested in ui/src/lib/previewCode.test.ts and its mount in PlanPreview.test.ts.

import type { Page } from "@playwright/test";

import { previewToggle } from "@test/e2e/support/chrome.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { PLAN_PREVIEW, planSurface } from "@test/e2e/support/source-view.ts";

const TS_BODY = "const answer: number = 42;\nfunction warm() {}";

const CODE_PLAN = `# Code plan

\`\`\`ts
${TS_BODY}
\`\`\`

\`\`\`nosuchlang
plain words here
\`\`\`

\`\`\`
bare fence body
\`\`\`

\`\`\`"><img src=x onerror=alert(1)>
hostile fence body
\`\`\`
`;

async function openPreview(page: Page): Promise<void> {
  await page.goto("/");
  await planSurface(page);
  await previewToggle(page).click();
  await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
}

/** The computed colour of each token span in the preview's first code block. */
function tsColours(page: Page): Promise<string[]> {
  return page
    .locator(`${PLAN_PREVIEW} pre code`)
    .first()
    .evaluate((code) => [...code.children].map((span) => getComputedStyle(span).color));
}

test("a ts block renders monospace and highlighted with the fence's text", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: CODE_PLAN });
  await openPreview(page);

  const pre = page.locator(`${PLAN_PREVIEW} pre`).first();
  const mono = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim(),
  );
  await expect.poll(() => pre.evaluate((el) => getComputedStyle(el).fontFamily)).toBe(mono);
  await expect.poll(async () => new Set(await tsColours(page)).size).toBeGreaterThanOrEqual(2);
  expect(await pre.locator("code").evaluate((c) => c.textContent)).toBe(`${TS_BODY}\n`);
});

test("unknown, bare and hostile fences render plain with no language in markup", async ({
  daemon,
  page,
}) => {
  await daemon.seed({ plan: CODE_PLAN });
  await openPreview(page);
  const preview = page.locator(PLAN_PREVIEW);
  const codes = preview.locator("pre code");
  await expect(codes).toHaveCount(4);
  await expect.poll(async () => (await tsColours(page)).length).toBeGreaterThan(0);

  for (const i of [1, 2, 3])
    expect(await codes.nth(i).evaluate((c) => c.childElementCount)).toBe(0);
  await expect(preview.locator("img")).toHaveCount(0);
  const html = await preview.evaluate((el) => el.innerHTML);
  for (const leak of ["nosuchlang", "onerror", "language-"]) expect(html).not.toContain(leak);
});

test("switching theme re-highlights the code blocks", async ({ daemon, page }) => {
  await daemon.seed({ plan: CODE_PLAN });
  await openPreview(page);
  await expect.poll(async () => (await tsColours(page)).length).toBeGreaterThan(0);
  const dark = await tsColours(page);

  await page.emulateMedia({ colorScheme: "light" });

  await expect
    .poll(async () => {
      const now = await tsColours(page);
      return now.length > 0 && now.join() !== dark.join();
    })
    .toBe(true);
});
