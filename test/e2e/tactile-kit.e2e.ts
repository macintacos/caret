// The tactile kit's one structural invariant: every rubber cap sits in a well. A cap's
// tray usually lives in a parent component (TopBar's .actions holds SplitButton), so no
// single .svelte file can show it; the rendered DOM can.

import type { Locator, Page } from "@playwright/test";

import { openSettings, previewToggle } from "@test/e2e/support/chrome.ts";
import { colorDistance, toLab } from "@test/e2e/support/color.ts";
import { openWithPendingScratch } from "@test/e2e/support/decision.ts";
import { type Daemon, expect, test } from "@test/e2e/support/fixtures.ts";
import {
  jumpToHeading,
  planSurface,
  revealGutterPlus,
  seedAndOpen,
} from "@test/e2e/support/source-view.ts";

/** The review page with one kept scratch, so the gate also reaches its marker's cap. */
async function openWithScratchMarker(daemon: Daemon, page: Page): Promise<void> {
  await openWithPendingScratch(daemon, page, "an unsent thought");
  await expect(page.getByRole("button", { name: "Resume unsent comment" })).toBeVisible();
}

/** The rendered caps, and an outline of each that sits outside any tray. */
function capsOutsideTrays(page: Page): Promise<{ total: number; outside: string[] }> {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll<HTMLElement>("button.float-chip, .cap")].filter(
      (el) => el.getClientRects().length > 0,
    );
    return {
      total: all.length,
      outside: all.filter((el) => !el.closest(".tray")).map((el) => el.outerHTML.slice(0, 120)),
    };
  });
}

/** An outline of each rendered cap whose corner isn't its tray's corner less the bezel. A
 * split half squares its seam side, so the cap's roundest corner is the one compared. */
function capsOffTrayCurve(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const px = (value: string) => Number.parseFloat(value) || 0;
    const corner = (style: CSSStyleDeclaration) =>
      Math.max(
        px(style.borderTopLeftRadius),
        px(style.borderTopRightRadius),
        px(style.borderBottomRightRadius),
        px(style.borderBottomLeftRadius),
      );
    return [...document.querySelectorAll<HTMLElement>("button.float-chip, .cap")]
      .filter((el) => el.getClientRects().length > 0)
      .flatMap((el) => {
        const tray = el.closest<HTMLElement>(".tray");
        if (tray === null) return [];
        const trayStyle = getComputedStyle(tray);
        const expected = corner(trayStyle) - px(trayStyle.paddingLeft);
        const actual = corner(getComputedStyle(el));
        return actual === expected
          ? []
          : [`${actual}px, want ${expected}px: ${el.outerHTML.slice(0, 120)}`];
      });
  });
}

/** An outline of each resting cap that draws a crisp line inside its face: an inset shadow
 * layer with no blur that paints something, which reads as a border rather than the face
 * rolling away into its well. */
function capsWithCrispEdges(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const visible = (layer: string) => {
      const alpha = /rgba\([^)]*,\s*([\d.]+)\)/.exec(layer);
      return !layer.startsWith("transparent") && (alpha === null || Number(alpha[1]) > 0);
    };
    const crisp = (layer: string) => {
      const [x = 0, y = 0, blur = 0, spread = 0] = (layer.match(/-?[\d.]+px/g) ?? []).map(
        Number.parseFloat,
      );
      return layer.includes("inset") && blur === 0 && (x !== 0 || y !== 0 || spread > 0);
    };
    return [...document.querySelectorAll<HTMLElement>("button.float-chip, .cap")]
      .filter((el) => el.getClientRects().length > 0 && !el.matches("[aria-pressed='true']"))
      .filter((el) =>
        getComputedStyle(el)
          .boxShadow.split(/,(?![^(]*\))/)
          .some((layer) => visible(layer.trim()) && crisp(layer.trim())),
      )
      .map((el) => el.outerHTML.slice(0, 120));
  });
}

/** Each rendered key lettered with one glyph, as its text and its border box's size. */
function singleGlyphKeys(page: Page): Promise<{ key: string; width: number; height: number }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("[data-slot='kbd']")]
      .filter((el) => el.getClientRects().length > 0 && el.querySelector("svg") === null)
      .filter((el) => [...(el.textContent ?? "").trim()].length === 1)
      .map((el) => {
        const { width, height } = el.getBoundingClientRect();
        return { key: el.textContent?.trim() ?? "", width, height };
      }),
  );
}

/** How far a key's border box sits inside its well's, above and below. */
async function keyInset(well: Locator, key: Locator): Promise<{ top: number; bottom: number }> {
  const [w, k] = await Promise.all([well.boundingBox(), key.boundingBox()]);
  if (w === null || k === null) throw new Error("well or key not rendered");
  return { top: k.y - w.y, bottom: w.y + w.height - k.y - k.height };
}

/** How far a key's inset in its well strays from `want`, above or below. A bar landing on
 * a fractional offset rounds each box, so a match is within a few tenths of a pixel. */
async function insetOff(
  well: Locator,
  key: Locator,
  want: { top: number; bottom: number },
): Promise<number> {
  const got = await keyInset(well, key);
  return Math.max(Math.abs(got.top - want.top), Math.abs(got.bottom - want.bottom));
}

/** How far a latched toggle sits inside its tray, read off the control row's Preview. */
async function latchedTrayInset(page: Page): Promise<{ top: number; bottom: number }> {
  const key = previewToggle(page);
  await key.click();
  await expect(key).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(0, 0);
  // The latch travels on a transition; an inset read mid-travel is not the latched one.
  await key.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return keyInset(page.locator(".tray").filter({ has: key }), key);
}

/** The gap round the keys of each rendered bed — a tray or a segmented control — as the
 * distance from the bed's box to its resting keys' union, with the key's rubber side,
 * which shows below its face, taken off the bottom; to the half pixel. */
function bedGaps(page: Page): Promise<{ bed: string; gaps: number[] }[]> {
  return page.evaluate(() => {
    const side = Number.parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue("--key-side"),
    );
    const half = (n: number) => Math.round(n * 2) / 2;
    return [...document.querySelectorAll<HTMLElement>(".tray, [data-slot='toggle-group']")]
      .filter((bed) => bed.getClientRects().length > 0)
      .flatMap((bed) => {
        // A latched or disabled key sits lower than a resting one, so only resting keys
        // set the top and bottom gaps; every key sets the side gaps.
        const all = [
          ...bed.querySelectorAll<HTMLElement>(
            "button.float-chip, .cap, [data-slot='toggle-group-item']",
          ),
        ].filter((key) => key.getClientRects().length > 0);
        const keys = all.filter(
          (key) => !key.matches("[aria-pressed='true'], [data-state='on'], :disabled"),
        );
        if (keys.length === 0) return [];
        const b = bed.getBoundingClientRect();
        const boxes = keys.map((key) => key.getBoundingClientRect());
        const sides = all.map((key) => key.getBoundingClientRect());
        const top = Math.min(...boxes.map((k) => k.top));
        const bottom = Math.max(...boxes.map((k) => k.bottom));
        const left = Math.min(...sides.map((k) => k.left));
        const right = Math.max(...sides.map((k) => k.right));
        return [
          {
            bed: bed.outerHTML.slice(0, 80),
            // The scratch marker's bed spans its row with its key at the end, so the
            // key's start has no gap to match.
            gaps: [top - b.top, b.bottom - bottom - side, b.right - right]
              .concat(bed.matches("button.tray") ? [] : [left - b.left])
              .map(half),
          },
        ];
      });
  });
}

/** A segmented control's chosen segment. */
function chosenKey(well: Locator): Locator {
  return well.locator("[data-state='on']").first();
}

test("the compare bar's chosen segments sit latched down, as a latched toggle does", async ({
  daemon,
  page,
}) => {
  await daemon.seedVersions(2, ["# Plan\n\nalpha line\n", "# Plan\n\nbeta line\n"]);
  await page.goto("/");
  await planSurface(page);
  const want = await latchedTrayInset(page);
  await page.getByRole("button", { name: "Versions" }).click();
  const wells = page.locator(".compare-picker [data-slot='toggle-group']");
  await expect(wells).toHaveCount(2);
  await page.mouse.move(0, 0);
  for (const well of await wells.all()) {
    await expect.poll(() => insetOff(well, chosenKey(well), want)).toBeLessThan(0.3);
  }
});

test("the settings' chosen segment sits latched down, as a latched toggle does", async ({
  daemon,
  page,
}) => {
  await seedAndOpen(page, daemon);
  const want = await latchedTrayInset(page);
  const dialog = await openSettings(page);
  const well = dialog.locator("[data-slot='toggle-group']").first();
  await page.mouse.move(0, 0);
  await expect.poll(() => insetOff(well, chosenKey(well), want)).toBeLessThan(0.3);
});

test("every bed shows the same gap round its resting keys", async ({ daemon, page }) => {
  await openWithScratchMarker(daemon, page);
  await page.mouse.move(0, 0);
  for (const { bed, gaps } of await bedGaps(page)) {
    expect(new Set(gaps).size, `${gaps.join("/")}: ${bed}`).toBe(1);
  }
});

test("every key in the top bar stands the same height", async ({ daemon, page }) => {
  await seedAndOpen(page, daemon);
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".topbar :is(button.float-chip, .cap)")]
      .filter((el) => el.getClientRects().length > 0)
      .map(
        (el) =>
          `${el.getBoundingClientRect().height} ${el.getAttribute("aria-label") ?? el.textContent?.trim()}`,
      ),
  );
  expect(heights.length).toBeGreaterThan(2);
  expect(new Set(heights.map((h) => h.split(" ")[0])).size, heights.join(", ")).toBe(1);
});

// Focus draws no ring, so the hover face a focused key wears is the only mark of focus and
// has to read apart from the face it rests on, by theme.test.ts's FOUND.
test("a key under keyboard focus reads apart from its resting face", async ({ daemon, page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await seedAndOpen(page, daemon);
  const key = page.getByRole("button", { name: "Request changes" });
  const face = () => key.evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.mouse.move(0, 0);
  const rest = await face();
  await key.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  await expect(key).toHaveCSS("outline-style", "none");
  await expect
    .poll(async () => colorDistance(page, rest, await face()))
    .toBeGreaterThanOrEqual(4.5);
});

/** An element's face once its state's transition, started on the next frame, has run out. */
function settledFace(target: Locator): Promise<string> {
  return target.evaluate(async (el) => {
    await new Promise(requestAnimationFrame);
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
    return getComputedStyle(el).backgroundColor;
  });
}

/** Light paper's cursor darkens the face it lands on, by theme.test.ts's FOUND. */
async function expectCursorDarkens(page: Page, cursor: string, resting: string): Promise<void> {
  const [cursorLab = [], restLab = []] = await toLab(page, [cursor, resting]);
  expect(cursorLab[0]).toBeLessThan(restLab[0] ?? Number.NaN);
  expect(await colorDistance(page, resting, cursor)).toBeGreaterThanOrEqual(4.5);
}

// A latched face is tinted with the accent, darker than a plain hover face, so the cursor
// steps the latched face rather than trading it for the hover face.
test("on light paper the cursor darkens the outline row being read", async ({ daemon, page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  const section = (name: string) =>
    [`## ${name}`, ...Array.from({ length: 30 }, (_, i) => `${name} line ${i + 1}.`)].join("\n\n");
  await daemon.seed({ plan: ["# Alpha", section("Bravo"), section("Delta")].join("\n\n") });
  await page.goto("/");
  await planSurface(page);
  await jumpToHeading(page, "Bravo");
  await expect.poll(() => new URL(page.url()).searchParams.get("heading")).toBe("bravo");
  await page.keyboard.press("\\");
  const read = page.locator(".plan-outline [aria-current='location']");
  await expect(read).toHaveAttribute("data-selected", "");
  const cursor = await settledFace(read.locator(".toc-key"));
  await page.keyboard.press("ArrowDown");
  await expect(read).not.toHaveAttribute("data-selected", "");
  await expectCursorDarkens(page, cursor, await settledFace(read.locator(".toc-key")));
});

test("on light paper the pointer darkens the latched compare toggle", async ({ daemon, page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await daemon.seedVersions(2, ["# Plan\n\nalpha line\n", "# Plan\n\nbeta line\n"]);
  await page.goto("/");
  await planSurface(page);
  const toggle = page.getByRole("button", { name: /^Versions/ });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.mouse.move(0, 0);
  const resting = await settledFace(toggle);
  await toggle.hover();
  await expectCursorDarkens(page, await settledFace(toggle), resting);
});

// On light paper a hovered key is darker than its rest, so a press that fell back to a
// lighter face would lighten the key under the finger.
test("a press on light paper never lightens the key under the pointer", async ({
  daemon,
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await seedAndOpen(page, daemon);
  for (const reach of [
    async () => page.getByRole("button", { name: "Request changes" }),
    async () => page.getByRole("button", { name: /^Copy path / }),
    async () => {
      await previewToggle(page).click();
      await (await planSurface(page)).locator("[data-source-start]").first().hover();
      return page.locator(".preview-plus > button");
    },
  ]) {
    const key = await reach();
    // The face once the state's transition, started on the next frame, has run out.
    const face = () =>
      key.evaluate(async (el) => {
        await new Promise(requestAnimationFrame);
        await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {})));
        return getComputedStyle(el).backgroundColor;
      });
    const lightness = async () => (await toLab(page, [await face()]))[0]?.[0] ?? Number.NaN;
    await key.hover();
    const hovered = await lightness();
    await page.mouse.down();
    expect(await lightness(), (await key.textContent()) ?? "").toBeLessThanOrEqual(hovered + 0.5);
    await page.mouse.move(0, 0);
    await page.mouse.up();
  }
});

test("a key lettered with one glyph stands a little taller than it is wide", async ({
  daemon,
  page,
}) => {
  await openWithScratchMarker(daemon, page);
  const keys = await singleGlyphKeys(page);
  expect(keys.length).toBeGreaterThan(0);
  for (const { key, width, height } of keys) {
    expect(width, `key ${key}`).toBeLessThan(height - 1);
    expect(width, `key ${key}`).toBeGreaterThan(height * 0.75);
  }
});

test("a resting cap stands above where a press takes it", async ({ daemon, page }) => {
  await openWithScratchMarker(daemon, page);
  const cap = page.getByRole("button", { name: "Request changes" });
  const top = async () => (await cap.boundingBox())?.y ?? Number.NaN;
  await page.mouse.move(0, 0);
  const resting = await top();
  const box = await cap.boundingBox();
  if (box === null) throw new Error("no Request changes cap");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(top).toBeGreaterThan(resting + 1);
  await page.mouse.move(0, 0);
  await page.mouse.up();
});

test("a key row pressed under the pointer goes down from where it rose", async ({
  daemon,
  page,
}) => {
  await seedAndOpen(page, daemon);
  const keyRow = page.getByRole("button", { name: /^Copy path / });
  const lift = () =>
    keyRow.evaluate((el) => Number.parseFloat(getComputedStyle(el).translate.split(" ")[1] ?? "0"));
  await keyRow.hover();
  await expect.poll(lift).toBeLessThan(0);
  await page.mouse.down();
  await expect.poll(lift).toBeGreaterThan(0);
  await page.mouse.move(0, 0);
  await page.mouse.up();
});

test("every rubber cap on the review page sits in a tray", async ({ daemon, page }) => {
  await openWithScratchMarker(daemon, page);
  const caps = await capsOutsideTrays(page);
  expect(caps.total).toBeGreaterThan(0);
  expect(caps.outside).toEqual([]);
});

test("every cap's corner nests concentrically in its tray's", async ({ daemon, page }) => {
  await openWithScratchMarker(daemon, page);
  expect(await capsOffTrayCurve(page)).toEqual([]);
});

test("a resting cap's edge is its shading meeting the well, not a drawn line", async ({
  daemon,
  page,
}) => {
  await openWithScratchMarker(daemon, page);
  await page.mouse.move(0, 0);
  expect(await capsWithCrispEdges(page)).toEqual([]);
});

test("the plan search's caps sit in a tray", async ({ daemon, page }) => {
  await seedAndOpen(page, daemon);
  await page.keyboard.press("/");
  await expect(page.getByRole("search")).toBeVisible();
  expect((await capsOutsideTrays(page)).outside).toEqual([]);
  expect(await capsOffTrayCurve(page)).toEqual([]);
});

/** A key's computed box-shadow with its colours dropped: the side and cast geometry alone. */
function shadowGeometry(key: Locator): Promise<string> {
  return key.evaluate((el) =>
    getComputedStyle(el)
      .boxShadow.replace(/[a-z]+\([^)]*\)/g, "")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

test("the gutter's comment key stands the same side as a top-bar key, in both views", async ({
  daemon,
  page,
}) => {
  await seedAndOpen(page, daemon);
  const want = await shadowGeometry(page.locator(".topbar .cap-accent").first());
  const source = await revealGutterPlus(page, 3);
  expect(await shadowGeometry(source)).toBe(want);

  await previewToggle(page).click();
  const line = (await planSurface(page)).locator("[data-source-start]").first();
  await line.hover();
  const preview = page.locator(".preview-plus > button");
  await expect(preview).toBeVisible();
  expect(await shadowGeometry(preview)).toBe(want);
});

// A menu's highlight follows the pointer, so it is the menu's one cursor: the row the
// keyboard moves off rests, though the pointer still sits over it.
test("a dropdown menu shows one risen row when the keyboard leaves the row under the pointer", async ({
  daemon,
  page,
}) => {
  await seedAndOpen(page, daemon);
  await page.getByRole("button", { name: "Approve options" }).click();
  const rows = page.getByRole("menuitem");
  const pointed = rows.first();
  await pointed.hover();
  await expect(pointed).toHaveAttribute("data-highlighted", "");
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toHaveAttribute("data-highlighted", "");
  await expect.poll(() => pointed.evaluate((el) => getComputedStyle(el).translate)).toBe("none");
});

// A ghost control has no face of its own, so its hover is a wash over whatever surface it
// sits on: on light paper it can only darken the lifted card, never punch a pale hole in it.
test("a saved comment's delete control hovers darker than the lifted card on light paper", async ({
  daemon,
  page,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  const id = await daemon.seed();
  await daemon.putDraft(id, {
    annotations: [{ id: "ann-1", startLine: 7, endLine: 8, comment: "Configurable TTL?" }],
  });
  await page.goto("/");
  await planSurface(page);
  const control = page
    .locator("[data-annotation-card='ann-1']")
    .getByRole("button", { name: "Discard comment" });
  await control.hover();
  // The control's painted face: its wash composited over the card's settled face.
  const [cardL, controlL] = await control.evaluate(async (el) => {
    const host = el.closest<HTMLElement>("[data-annotation-card]");
    if (host === null) throw new Error("no card");
    await new Promise(requestAnimationFrame);
    await Promise.all(host.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => {})));
    const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    if (ctx === null) throw new Error("no 2d context");
    const luma = () => {
      const [r = 0, g = 0, b = 0] = ctx.getImageData(0, 0, 1, 1).data;
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    ctx.fillStyle = getComputedStyle(host).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    const under = luma();
    ctx.fillStyle = getComputedStyle(el).backgroundColor;
    ctx.fillRect(0, 0, 1, 1);
    return [under, luma()];
  });
  expect(controlL).toBeLessThan(cardL);
});
