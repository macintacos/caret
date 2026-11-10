// Where the eye takes the Unsent row's edges on dark paper. The row centres its content in
// its box, so it reads centred only while its visible edges sit on that box. Dark paper is
// darker than the row's tinted floor, so a shade drawn under the top edge can sink that
// edge into the paper, and a lit lip under the row adds an edge below it; on light paper
// the floor is the darker of the two and the same shade only firms the edge. Only a real
// browser paints the shadows, so each edge is read off a screenshot. The floor's tint and
// its ink's contrast are theme.test.ts's.

import type { Locator, Page } from "@playwright/test";

import { sourceToggle } from "@test/e2e/support/chrome.ts";
import { openWithPendingScratch } from "@test/e2e/support/decision.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { bundledThemes } from "@test/support/theme.ts";

test.use({ deviceScaleFactor: 2 });

/** How far, in CSS px, the visible row's centre may sit below its box's. */
const MAX_SAG = 0.5;
/** How far above and below the row's box the paper is read, in CSS px. */
const PAPER_GAP = 5;

/** The CIELAB lightness of each pixel down the first column of a PNG. */
function columnLightness(page: Page, png: string): Promise<number[]> {
  return page.evaluate(async (data) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("no 2d context");
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, 1, image.height).data;
    const linear = (c: number) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    const lightness: number[] = [];
    for (let i = 0; i < pixels.length; i += 4) {
      const y =
        0.2126 * linear(pixels[i] ?? 0) +
        0.7152 * linear(pixels[i + 1] ?? 0) +
        0.0722 * linear(pixels[i + 2] ?? 0);
      lightness.push(y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y);
    }
    return lightness;
  }, png);
}

/** How far the visible row's centre sits below its box's, in CSS px, read down a column of
 * floor clear of its content. A pixel is part of the visible row once it stands off the
 * paper by half what the floor does. */
async function sag(page: Page, row: Locator): Promise<number> {
  await expect(row).toBeVisible();
  await row.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
  );
  const box = await row.boundingBox();
  if (box === null) throw new Error("the Unsent row is not rendered");
  const clip = {
    x: Math.round(box.x + box.width * 0.6),
    y: Math.floor(box.y) - PAPER_GAP,
    width: 1,
    height: Math.ceil(box.height) + 2 * PAPER_GAP + 1,
  };
  const lightness = await columnLightness(
    page,
    (await page.screenshot({ clip })).toString("base64"),
  );
  const scale = lightness.length / clip.height;
  const top = (box.y - clip.y) * scale;
  const bottom = (box.y + box.height - clip.y) * scale;
  const paper = ((lightness[0] ?? 0) + (lightness.at(-1) ?? 0)) / 2;
  const floor = lightness[Math.floor((top + bottom) / 2)] ?? paper;
  const seen = lightness.flatMap((l, i) =>
    Math.abs(l - paper) >= Math.abs(floor - paper) / 2 ? [i] : [],
  );
  const seenTop = seen[0] ?? top;
  const seenBottom = (seen.at(-1) ?? bottom - 1) + 1;
  return (seenTop - top - (bottom - seenBottom)) / 2 / scale;
}

for (const theme of bundledThemes().filter(({ scheme }) => scheme === "dark")) {
  test(`the Unsent row reads centred on ${theme.id}'s paper, in either view`, async ({
    daemon,
    page,
  }) => {
    await page.addInitScript((id) => {
      localStorage.setItem("caret.theme.mode", "dark");
      localStorage.setItem("caret.theme.dark", id);
    }, theme.id);
    await openWithPendingScratch(daemon, page, "an unsent thought");
    await page.mouse.move(0, 0);
    const row = page.getByRole("button", { name: "Resume unsent comment" });
    expect(await sag(page, row), "source").toBeLessThanOrEqual(MAX_SAG);
    await sourceToggle(page).click();
    expect(await sag(page, row), "preview").toBeLessThanOrEqual(MAX_SAG);
  });
}
