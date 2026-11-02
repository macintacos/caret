// The outline's peek: rest on an outline row, by pointer or by the keys, and the row's
// section shows beside the outline as the plan's own view draws it. Once open it follows
// the pointer and the keys from row to row, and across a flip of the plan's view. It
// hides when the pointer leaves the list, the list loses focus, a key other than a walk
// or the flip is pressed, a row is picked, or the reader scrolls the plan or the list.
//
// Everything here needs a real browser. The peek is a copy of the live render, so what
// it shows is only as faithful as a real engine's cascade into a real shadow root makes
// it; where it stands is laid-out geometry; and every way it hides is a real event —
// pointer boundaries, focus, a scroll, a key. The pure halves run off an injected clock
// and constructed DOM: when it opens and which row it shows (ui/src/lib/outlinePeek.test.ts),
// what a section's lines are (ui/src/lib/tocSections.test.ts), and which rows and blocks
// the copy takes (ui/src/lib/peekSnippet.test.ts).

import type { Locator, Page } from "@playwright/test";

import { previewToggle } from "@test/e2e/support/chrome.ts";
import { fileRefCount, makeProject, settleDrawer } from "@test/e2e/support/file-refs.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { awaitPlanReadyForKeys, PLAN_PREVIEW, planSurface } from "@test/e2e/support/source-view.ts";

const filler = (label: string) =>
  Array.from(
    { length: 12 },
    (_, i) => `${label} detail line ${i + 1} keeps this section tall.`,
  ).join("\n");

const SECTIONS = ["Delta", "Echo", "Foxtrot", "Golf", "Hotel", "India", "Juliet", "Kilo"];

const PLAN = [
  "# Plan",
  filler("Plan"),
  "## Intake",
  "Read frames from the **socket** and drop malformed ones. See [the frame spec](https://example.com/frames).",
  "```ts\nconst frames = read(socket);\n```",
  filler("Intake"),
  "## Retention",
  "Keep a week of `frames` on disk.",
  filler("Retention"),
  "## Phase",
  "### Step one",
  "Step one's detail lives under its own heading.",
  ...SECTIONS.flatMap((s) => [`## ${s}`, filler(s)]),
  "",
].join("\n\n");

const COLUMN = ".plan-outline";
const FLOAT = ".outline-float";
/** The peek publishes no role: it is a sighted shortcut to text the plan already holds,
 * so it stays out of the accessibility tree, and a `data-*` anchor is the honest form. */
const PEEK = "[data-outline-peek]";

const peek = (page: Page) => page.locator(PEEK);
const openPeek = (page: Page) => page.locator(`${PEEK}[data-open]`);
const row = (scope: Locator, name: string) => scope.getByRole("option", { name, exact: true });

/** The text of the heading row or block the peek opens on. */
function peekHeading(page: Page, view: "source" | "preview"): Locator {
  return view === "source"
    ? openPeek(page).locator("[data-content] [data-line]").first()
    : openPeek(page).locator(".plan-preview :is(h1, h2, h3)").first();
}

async function openAt(
  page: Page,
  view: "source" | "preview" = "source",
  review?: string,
): Promise<void> {
  await page.goto(review === undefined ? "/" : `/?review=${review}`);
  await planSurface(page);
  if (view === "preview") {
    await previewToggle(page).click();
    await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
  }
}

/** The computed type of an element, for comparing the peek's copy with the live view's. */
const typeOf = (locator: Locator) =>
  locator.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      family: s.fontFamily,
      size: s.fontSize,
      weight: s.fontWeight,
      color: s.color,
    };
  });

/** Records whether the peek closes from now on; read it back with the returned call. */
async function watchForClose(page: Page): Promise<() => Promise<boolean>> {
  await peek(page).evaluate((el) => {
    const w = window as unknown as { peekClosed: boolean };
    w.peekClosed = false;
    new MutationObserver(() => {
      if (!el.hasAttribute("data-open")) w.peekClosed = true;
    }).observe(el, { attributeFilter: ["data-open"] });
  });
  return () => page.evaluate(() => (window as unknown as { peekClosed: boolean }).peekClosed);
}

/** The contrast between two sRGB colours, by WCAG 2.2's formula. */
function contrast(a: number[], b: number[]): number {
  const lum = (rgb: number[]) => {
    const [r = 0, g = 0, bl = 0] = rgb.map((v) => {
      const c = v / 255;
      return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/** The pixels of a one-pixel strip across the peek's right edge, halfway down: a few
 * inside the peek, then the edge, then a few of the plan past it. */
async function rightEdgeStrip(page: Page): Promise<number[][]> {
  const box = await openPeek(page).boundingBox();
  if (!box) throw new Error("no open peek");
  const shot = await page.screenshot({
    clip: {
      x: Math.round(box.x + box.width) - 6,
      y: Math.round(box.y + box.height / 2),
      width: 14,
      height: 1,
    },
  });
  const scratch = await page.context().newPage();
  try {
    return await scratch.evaluate(async (png) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = 1;
      const context = canvas.getContext("2d");
      context?.drawImage(image, 0, 0);
      const data = context?.getImageData(0, 0, image.width, 1).data ?? [];
      return Array.from({ length: image.width }, (_, i) => [...data].slice(i * 4, i * 4 + 3));
    }, shot.toString("base64"));
  } finally {
    await scratch.close();
  }
}

test.beforeEach(async ({ daemon, page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await daemon.seed({ plan: PLAN });
});

test("resting on a row peeks at its section as the source view draws it", async ({ page }) => {
  await openAt(page);
  const column = page.locator(COLUMN);
  await row(column, "Intake").hover();

  await expect(peekHeading(page, "source")).toHaveText("## Intake");
  await expect(openPeek(page)).toContainText("Read frames from the");
  await expect(openPeek(page)).not.toContainText("## Retention");

  const live = page.locator(".plan-pane .diffview [data-content] [data-line]", {
    hasText: "## Intake",
  });
  expect(await typeOf(peekHeading(page, "source"))).toEqual(await typeOf(live));

  // Beside the column, level with the row.
  const peekBox = await openPeek(page).boundingBox();
  const columnBox = await column.boundingBox();
  const rowBox = await row(column, "Intake").boundingBox();
  expect(peekBox?.x).toBeGreaterThanOrEqual((columnBox?.x ?? 0) + (columnBox?.width ?? 0));
  expect(Math.abs((peekBox?.y ?? 0) - (rowBox?.y ?? 0))).toBeLessThan(2);
});

test("in Preview, the peek shows the section as Preview renders it", async ({ page }) => {
  await openAt(page, "preview");
  await row(page.locator(COLUMN), "Intake").hover();

  await expect(peekHeading(page, "preview")).toHaveText("Intake");
  await expect(openPeek(page).locator(".plan-preview strong")).toHaveText("socket");
  await expect(openPeek(page).locator(".plan-preview pre code")).toContainText("read(socket)");

  const live = page.locator(`.plan-pane ${PLAN_PREVIEW} h2`, { hasText: "Intake" });
  expect(await typeOf(peekHeading(page, "preview"))).toEqual(await typeOf(live));
});

test("once open, it follows the pointer from row to row without closing", async ({ page }) => {
  await openAt(page);
  const column = page.locator(COLUMN);
  await row(column, "Intake").hover();
  await expect(peekHeading(page, "source")).toHaveText("## Intake");

  const closed = await watchForClose(page);
  await row(column, "Retention").hover();
  await expect(peekHeading(page, "source")).toHaveText("## Retention");
  expect(await closed()).toBe(false);
});

test("a heading with no text of its own peeks at its subsections", async ({ page }) => {
  await openAt(page);
  await row(page.locator(COLUMN), "Phase").hover();
  await expect(peekHeading(page, "source")).toHaveText("## Phase");
  await expect(openPeek(page)).toContainText("Step one's detail lives under its own heading.");
});

test("flipping the view under an open peek keeps it open, on the new view's copy", async ({
  page,
}) => {
  await openAt(page);
  await awaitPlanReadyForKeys(page);
  // From partway down, so keeping the reader's place across the flip scrolls the plan.
  await (await planSurface(page)).hover();
  await page.mouse.wheel(0, 600);
  await row(page.locator(COLUMN), "Intake").hover();
  await expect(peekHeading(page, "source")).toHaveText("## Intake");

  const closed = await watchForClose(page);
  await page.keyboard.press("p");
  await expect(page.locator(`.plan-pane ${PLAN_PREVIEW}`)).toBeVisible();
  await expect(peekHeading(page, "preview")).toHaveText("Intake");
  await expect(openPeek(page)).toHaveAttribute("data-view", "preview");
  expect(await closed()).toBe(false);
});

test("when its copy grows, the peek measures again: inside the plan, fading at the cut", async ({
  daemon,
  page,
}) => {
  const image = "https://assets.test/peek-late.svg";
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(image, async (route) => {
    await gate;
    await route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="400"/>',
    });
  });
  const review = await daemon.seed({
    plan: `${PLAN}\n\n## Pictures\n\nAbove the picture.\n\n![late](${image})\n\nBelow the picture.\n`,
  });
  await page.setViewportSize({ width: 1440, height: 600 });
  await openAt(page, "source", review);
  await row(page.locator(COLUMN), "Pictures").hover();
  await expect(openPeek(page)).toContainText("Above the picture.");

  release();
  await expect(openPeek(page)).toHaveAttribute("data-cut", "");
  const room = await page.evaluate(() => {
    const pane = document.querySelector(".plan-pane")?.getBoundingClientRect().bottom ?? 0;
    const foot = document.querySelector("[data-outline-peek]")?.getBoundingClientRect().bottom ?? 0;
    return pane - foot;
  });
  expect(room).toBeGreaterThanOrEqual(7.5);
});

test("in dark, the peek's edge stands at least 3:1 from its face and from the plan", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await openAt(page);
  await row(page.locator(COLUMN), "Retention").hover();
  await expect(peekHeading(page, "source")).toHaveText("## Retention");
  await expect(openPeek(page)).toHaveCSS("opacity", "1");

  const strip = await rightEdgeStrip(page);
  const face = strip[1] ?? [];
  const plan = strip.at(-1) ?? [];
  const edge = Math.max(...strip.map((px) => Math.min(contrast(px, face), contrast(px, plan))));
  expect(edge).toBeGreaterThanOrEqual(3);
});

test("a closed peek leaves no copy of the plan in the page", async ({ page }) => {
  for (const [view, live] of [
    ["source", ".diffview"],
    ["preview", PLAN_PREVIEW],
  ] as const) {
    await openAt(page, view);
    await row(page.locator(COLUMN), "Intake").hover();
    await expect(openPeek(page)).toBeVisible();
    await page.mouse.move(900, 450);
    await expect(page.locator(live)).toHaveCount(1);
  }
});

test("Tab never lands in the peek", async ({ page }) => {
  await openAt(page, "preview");
  await row(page.locator(COLUMN), "Intake").hover();
  await expect(openPeek(page).locator("a")).toHaveCount(1);

  // From the last thing Tab reaches before the peek in document order.
  await page.evaluate(() => {
    const peekEl = document.querySelector("[data-outline-peek]");
    const focusable = "a[href], button, input:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const before = [...document.querySelectorAll<HTMLElement>(focusable)].filter(
      (el) =>
        el.checkVisibility() &&
        peekEl !== null &&
        el.compareDocumentPosition(peekEl) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
    before.at(-1)?.focus();
  });
  await page.keyboard.press("Tab");
  const inPeek = await page.evaluate(
    () => document.activeElement?.closest("[data-outline-peek]") != null,
  );
  expect(inPeek).toBe(false);
});

test("the source view draws every row of the plan, which the peek's copy relies on", async ({
  page,
}) => {
  await openAt(page);
  const rows = await page.locator(".plan-pane .diffview").evaluate((host) =>
    [...(host.shadowRoot?.querySelectorAll("[data-content] [data-line]") ?? [])].map((row) => ({
      line: Number(row.getAttribute("data-line")),
      text: row.textContent ?? "",
    })),
  );
  expect(rows.map((r) => r.line)).toEqual(rows.map((_, i) => i + 1));
  expect(rows.some((r) => r.text.includes("Kilo detail line 12"))).toBe(true);
});

test("walking the filtered list with the keys peeks at the highlighted row", async ({ page }) => {
  await openAt(page);
  await awaitPlanReadyForKeys(page);
  await page.keyboard.press("\\");
  await expect(
    page.locator(COLUMN).getByRole("combobox", { name: "Filter headings" }),
  ).toBeFocused();

  await page.keyboard.press("ArrowDown");
  await expect(peekHeading(page, "source")).toHaveText("## Intake");
  await page.keyboard.press("ArrowDown");
  await expect(peekHeading(page, "source")).toHaveText("## Retention");
});

test.describe("it hides", () => {
  test.beforeEach(async ({ page }) => {
    await openAt(page);
    await row(page.locator(COLUMN), "Intake").hover();
    await expect(openPeek(page)).toBeVisible();
  });

  test("when the pointer leaves the list", async ({ page }) => {
    await page.mouse.move(900, 450);
    await expect(openPeek(page)).toHaveCount(0);
  });

  test("on Escape", async ({ page }) => {
    await page.keyboard.press("Escape");
    await expect(openPeek(page)).toHaveCount(0);
  });

  test("on a pick", async ({ page }) => {
    await row(page.locator(COLUMN), "Intake").click();
    await expect(openPeek(page)).toHaveCount(0);
  });

  test("when the list scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 420 });
    await row(page.locator(COLUMN), "Retention").hover();
    await expect(openPeek(page)).toBeVisible();
    await page.mouse.wheel(0, 120);
    await expect(openPeek(page)).toHaveCount(0);
  });
});

test("the peek hides when the reader scrolls the plan", async ({ page }) => {
  await openAt(page);
  await awaitPlanReadyForKeys(page);
  await page.keyboard.press("\\");
  await page.keyboard.press("ArrowDown");
  await expect(openPeek(page)).toBeVisible();

  await page.mouse.move(900, 450);
  await page.mouse.wheel(0, 300);
  await expect(openPeek(page)).toHaveCount(0);
});

test("the peek hides when the filter field loses focus", async ({ page }) => {
  await openAt(page);
  await awaitPlanReadyForKeys(page);
  await page.keyboard.press("\\");
  const field = page.locator(COLUMN).getByRole("combobox", { name: "Filter headings" });
  await expect(field).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(openPeek(page)).toBeVisible();

  await field.blur();
  await expect(openPeek(page)).toHaveCount(0);
});

test("beside the float, the peek stands past the float's edge", async ({ page }) => {
  await page.setViewportSize({ width: 880, height: 900 });
  await openAt(page);
  await page.getByRole("button", { name: "Show outline" }).click();
  const float = page.locator(FLOAT);
  await expect(float.getByRole("combobox", { name: "Filter headings" })).toBeFocused();

  await row(float, "Retention").hover();
  await expect(peekHeading(page, "source")).toHaveText("## Retention");
  const peekBox = await openPeek(page).boundingBox();
  const floatBox = await float.boundingBox();
  expect(peekBox?.x).toBeGreaterThanOrEqual((floatBox?.x ?? 0) + (floatBox?.width ?? 0));
  expect((peekBox?.x ?? 0) + (peekBox?.width ?? 0)).toBeLessThanOrEqual(880);
});

test("beside the float and an open file, the peek stops short of the file", async ({
  daemon,
  page,
}) => {
  const project = await makeProject({ "src/frames.ts": "export const frames = [];\n" });
  try {
    const review = await daemon.seed({
      cwd: project.dir,
      plan: PLAN.replace("drop malformed ones.", "drop malformed ones in `src/frames.ts`."),
    });
    await openAt(page, "source", review);
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator("[data-file-drawer]")).toBeVisible();
    await settleDrawer(page);
    // The column folds to keep the plan's reading width beside the file.
    await page.getByRole("button", { name: "Show outline" }).click();

    await row(page.locator(FLOAT), "Retention").hover();
    await expect(peekHeading(page, "source")).toHaveText("## Retention");
    const peekBox = await openPeek(page).boundingBox();
    const drawerBox = await page.locator("[data-file-drawer]").boundingBox();
    expect((peekBox?.x ?? 0) + (peekBox?.width ?? 0)).toBeLessThanOrEqual((drawerBox?.x ?? 0) - 8);
  } finally {
    await project.cleanup();
  }
});
