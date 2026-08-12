// Markdown images in the plan (EXC-870). What needs a real browser here is
// everything about geometry: that an <img> in a source row actually loads and
// paints, that the row track grows around it and the gutter cell sharing that
// track grows with it, that the monospace grid on the rows around it does not
// move, and that a load failure leaves no broken-image box behind. None of that
// has an answer under happy-dom, which reports zero for every layout metric. The
// pure halves stay units: which markup emits an image and what columns it covers
// is links.test.ts, the DOM pass's idempotency and element shape is
// inlineImages.test.ts, and the CSS declarations themselves are
// coreStyles.test.ts — what only a browser can say is that those declarations
// resolve their tokens across the shadow boundary and produce the right boxes.
//
// No request leaves the machine. Every image URL is intercepted with page.route
// and fulfilled from a byte string in this file, so the "loads" case is a real
// decode of a real PNG with no network, and the "fails" case is a real 404
// through the same path a dead remote asset would take.

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

// A 2x2 opaque PNG, small enough to inline and real enough for Chromium to
// decode and report intrinsic dimensions for.
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGP8z4AATAxopIYzAwCEsAF/aFxvXgAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG_BASE64, "base64");

const GOOD = "https://assets.test/diagram.png";
const GONE = "https://assets.test/absent.png";

// One image that loads, one that 404s, one whose target is a scheme the layer
// refuses, and one written inside a fence — plus plain prose rows above and
// below each, so a row height can be compared against an ordinary one.
const IMAGE_PLAN = `# Image Plan

Prose above the diagram, on a row of ordinary height.

![the cache topology](${GOOD})

Prose below the diagram, also ordinary.

![an asset that is not there](${GONE})

![an inline payload](data:image/png;base64,${PNG_BASE64})

\`\`\`md
![fenced and literal](${GOOD})
\`\`\`

Trailing prose.
`;

/** Serve every intercepted asset from this file: the good URL as a real PNG, the
 * missing one as a 404. Installed before the page loads so no request escapes. */
async function routeAssets(page: import("@playwright/test").Page): Promise<void> {
  await page.route(GOOD, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_BYTES }),
  );
  await page.route(GONE, (route) => route.fulfill({ status: 404, body: "" }));
}

/** Every image element in the source view's shadow root, with the state that
 * distinguishes a drawn picture from a hidden one: its src, its alt, whether the
 * failure handler hid it, and the box the browser gave it. */
function shadowImages(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return [...(sh?.querySelectorAll("img[data-md-image]") ?? [])].map((el) => {
      const img = el as HTMLImageElement;
      const rect = img.getBoundingClientRect();
      return {
        src: img.getAttribute("src") ?? "",
        alt: img.getAttribute("alt") ?? "",
        hidden: img.hidden,
        referrerPolicy: img.getAttribute("referrerpolicy") ?? "",
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        naturalWidth: img.naturalWidth,
        row: img.parentElement?.getAttribute("data-line") ?? "",
      };
    });
  });
}

/** The rendered gutter numbers and content rows, as counts, plus the height of
 * one named row. The gutter/content parity is the epic's standing reflow guard:
 * one number per row, always, however tall a row grows. */
function gridShape(page: import("@playwright/test").Page, line: number) {
  return page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const rows = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])];
    const numbers = [...(sh?.querySelectorAll("[data-line-number-content]") ?? [])];
    const row = rows.find((r) => r.getAttribute("data-line") === String(ln));
    const numberCell = numbers.find(
      (n) => (n.parentElement as HTMLElement)?.dataset.lineIndex === String(ln - 1),
    )?.parentElement;
    return {
      rows: rows.length,
      numbers: numbers.length,
      rowHeight: Math.round(row?.getBoundingClientRect().height ?? 0),
      numberHeight: Math.round(numberCell?.getBoundingClientRect().height ?? 0),
    };
  }, line);
}

test.beforeEach(async ({ page, daemon }) => {
  await routeAssets(page);
  await daemon.seed({ plan: IMAGE_PLAN });
  await page.goto(daemon.url);
  await planSurface(page);
});

test("a safe image renders on its source line and the markup stays put", async ({ page }) => {
  await expect.poll(async () => (await shadowImages(page))[0]?.naturalWidth).toBeGreaterThan(0);
  const [drawn] = await shadowImages(page);
  expect(drawn?.src).toBe(GOOD);
  // The alt is the accessible name, and it is the alt as written — not the whole
  // markup the row still shows.
  expect(drawn?.alt).toBe("the cache topology");
  expect(drawn?.hidden).toBe(false);
  expect(drawn?.referrerPolicy).toBe("no-referrer");
  // Line 5 is the image's own source line; the picture hangs off that row rather
  // than replacing it or landing on a row of its own.
  expect(drawn?.row).toBe("5");
  // And the row still reads as the source markdown, which is what copy carries.
  await expect(page.locator(".diffview")).toContainText(`![the cache topology](${GOOD})`);
});

test("the image's row grows, and its gutter number grows with it", async ({ page }) => {
  await expect.poll(async () => (await shadowImages(page))[0]?.naturalWidth).toBeGreaterThan(0);
  const imageRow = await gridShape(page, 5);
  const proseRow = await gridShape(page, 3);
  expect(imageRow.rowHeight).toBeGreaterThan(proseRow.rowHeight);
  // The gutter cell shares the row's grid track, so it grows to the same height.
  // A number that stayed one line tall would mean the picture had escaped the
  // grid, and every line number below it would be pointing at the wrong text.
  expect(imageRow.numberHeight).toBe(imageRow.rowHeight);
});

test("every row still has exactly one gutter number", async ({ page }) => {
  // The epic's reflow guard. An image is the change most likely to break it, so
  // it is asserted against the plan's own line count rather than row-to-row.
  await expect.poll(async () => (await shadowImages(page))[0]?.naturalWidth).toBeGreaterThan(0);
  const shape = await gridShape(page, 5);
  expect(shape.rows).toBe(IMAGE_PLAN.trimEnd().split("\n").length);
  expect(shape.numbers).toBe(shape.rows);
});

test("the image is capped and keeps its box inside the row", async ({ page }) => {
  await expect.poll(async () => (await shadowImages(page))[0]?.naturalWidth).toBeGreaterThan(0);
  const [drawn] = await shadowImages(page);
  // A 2x2 source scales to nothing, so what is pinned is the cap holding rather
  // than a specific size: 18rem tall, and never wider than the panel's measure.
  expect(drawn!.height).toBeLessThanOrEqual(288);
  expect(drawn!.width).toBeLessThanOrEqual(720);
  const contained = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const img = sh?.querySelector("img[data-md-image]") as HTMLImageElement | null;
    const row = img?.parentElement;
    if (!img || !row) return null;
    const i = img.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return { insideTop: i.top >= r.top - 1, insideBottom: i.bottom <= r.bottom + 1 };
  });
  // The picture is IN the row, not floating over the rows around it — the whole
  // reason the element is in flow rather than positioned.
  expect(contained).toEqual({ insideTop: true, insideBottom: true });
});

test("a failed load leaves no broken-image chrome", async ({ page }) => {
  await expect.poll(async () => (await shadowImages(page)).length).toBeGreaterThan(1);
  await expect
    .poll(async () => (await shadowImages(page)).find((i) => i.src === GONE)?.hidden)
    .toBe(true);
  const failed = (await shadowImages(page)).find((i) => i.src === GONE);
  // Hidden really collapses: the UA's own [hidden] rule loses to display: block,
  // so this is the one assertion that would catch that CSS line going missing.
  expect(failed?.width).toBe(0);
  expect(failed?.height).toBe(0);
  // And the row degrades to the rung below — the link chip over the literal
  // markdown, which is exactly what an image that never drew already wore.
  const chipped = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = sh?.querySelector('[data-content] [data-line="9"]');
    const marked = [...(row?.querySelectorAll('[data-md~="link"]') ?? [])]
      .map((el) => el.textContent ?? "")
      .join("");
    return { rowText: row?.textContent ?? "", marked };
  });
  expect(chipped.rowText).toBe(`![an asset that is not there](${GONE})`);
  expect(chipped.marked).toBe(`![an asset that is not there](${GONE})`);
});

test("a non-http target draws nothing, and a fenced one stays literal text", async ({ page }) => {
  await expect.poll(async () => (await shadowImages(page)).length).toBeGreaterThan(1);
  const drawn = await shadowImages(page);
  // Two images exist — the good one and the 404 — and neither the data: payload
  // nor the fenced line contributed one. A data: URL that rendered would be the
  // safety gate failing open; a fenced one would be markup leaking into a code
  // panel, the same thing EXC-868 checked for its chip.
  expect(drawn).toHaveLength(2);
  expect(drawn.map((i) => i.src).sort()).toEqual([GONE, GOOD].sort());
  await expect(page.locator(".diffview")).toContainText(`![fenced and literal](${GOOD})`);
});
