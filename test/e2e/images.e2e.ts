// Markdown images in the plan (EXC-870). What needs a real browser here is
// everything about geometry and platform behaviour: that an <img> in a source row
// actually loads and paints, that the size cap binds against a real intrinsic
// size, that the row track grows around it while the gutter cell sharing that
// track grows with it, that the rows on either side do not move, that the
// clipboard still carries the source markdown once a replaced element sits inside
// the selection, that the comment affordance still reaches the taller row, and
// that a load failure leaves no broken-image box. None of that has an answer under
// happy-dom, which reports zero for every layout metric and has no clipboard. One
// spec here is about neither geometry nor platform: the table case asserts that the
// repaint SETTLES, which needs the real MutationObserver loop SourceView runs the
// decoration passes from — a loop that only exists in a mounted browser view.
//
// The clipboard case is the one worth naming: it is not a restatement of the DOM
// text, which is untouched by construction. Blink can emit an image's alt text
// into a copied selection, which would make a copied image row read
// `![alt](url)alt` — and "copy carries the real markdown" is the criterion that
// forced images not to collapse in the first place. Only a real browser can say
// which way that goes.
//
// The pure halves stay units: which markup emits an image is links.test.ts, the
// DOM pass's idempotency and element shape is inlineImages.test.ts, and the CSS
// declarations' presence is coreStyles.test.ts — what only a browser can say is
// that those declarations resolve their tokens across the shadow boundary and
// produce the right boxes.
//
// No request leaves the machine. Every image URL is intercepted with page.route
// and fulfilled from a byte string in this file, so the "loads" case is a real
// decode of a real PNG with no network, and the "fails" case is a real 404 through
// the same path a dead remote asset would take.

import { expect, test } from "@test/e2e/support/fixtures.ts";
import { planSurface, revealGutterPlus, rowHeights } from "@test/e2e/support/source-view.ts";

// A 900x700 1-bit PNG, solid black. The size is the point: 700px intrinsic height
// is well past the 18rem (288px) cap, so the cap has to bind for the assertions
// below to pass — a 2x2 pixel would let them pass with the cap deleted.
const BIG_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAA4QAAAK8AQAAAACfa0ziAAAAZElEQVR42u3BMQEAAADCoPVPbQlPoAAAAAAAAAAA" +
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
    "eBo3xwABf429cQAAAABJRU5ErkJggg==",
  "base64",
);
const CAP_PX = 288; // 18rem at the root's 16px
const MEASURE_PX = 720; // the max-width the fenced panel also spends

const GOOD = "https://assets.test/diagram.png";
const GONE = "https://assets.test/absent.png";
const IMAGE_MARKUP = `![the cache topology](${GOOD})`;

// One image that loads, one that 404s, one whose target is a scheme the layer
// refuses, and one written inside a fence — plus plain prose rows above and below
// the drawn one, so a row height and a glyph position can be compared against
// ordinary ones.
const IMAGE_PLAN = `# Image Plan

Prose above the diagram, on a row of ordinary height.

${IMAGE_MARKUP}

Prose below the diagram, also ordinary.

![an asset that is not there](${GONE})

![an inline payload](data:image/png;base64,iVBORw0KGgo=)

\`\`\`md
![fenced and literal](${GOOD})
\`\`\`

Trailing prose.
`;

// A table whose cell holds an image. Its own plan, because what it asserts is that
// the repaint SETTLES rather than anything on screen, and a settle test has to own
// the whole document it watches.
const TABLE_PLAN = `# Table Plan

| Case | Shot |
| ---- | ---- |
| one  | ![a shot](${GOOD}) |

Trailing prose.
`;

const IMAGE_LINE = 5;
const PROSE_ABOVE = 3;
const PROSE_BELOW = 7;
const BROKEN_LINE = 9;
const TABLE_BODY_LINE = 5;

/** Serve every intercepted asset from this file: the good URL as a real PNG, the
 * missing one as a 404. Installed before the page loads so no request escapes. */
async function routeAssets(page: import("@playwright/test").Page): Promise<void> {
  await page.route(GOOD, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: BIG_PNG }),
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
        naturalHeight: img.naturalHeight,
        row: img.parentElement?.getAttribute("data-line") ?? "",
      };
    });
  });
}

/** Resolve once the good image has decoded, so every geometry read below sees a
 * laid-out picture rather than a zero-height placeholder. */
async function imageDecoded(page: import("@playwright/test").Page): Promise<void> {
  await expect
    .poll(async () => (await shadowImages(page)).find((i) => i.src === GOOD)?.naturalHeight)
    .toBeGreaterThan(0);
}

/** The rendered row and gutter-number counts. One number per row, always, however
 * tall a row grows — the epic's standing reflow guard. */
function gridCounts(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return {
      rows: (sh?.querySelectorAll("[data-content] [data-line]") ?? []).length,
      numbers: (sh?.querySelectorAll("[data-line-number-content]") ?? []).length,
    };
  });
}

/** The viewport x of the first glyph on a row — the monospace grid's left edge for
 * that line. The image must not move it on any row, its own included. */
function firstGlyphX(page: import("@playwright/test").Page, line: number) {
  return page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) => r.getAttribute("data-line") === String(ln),
    );
    const first = row?.firstElementChild;
    return first ? Math.round(first.getBoundingClientRect().x) : null;
  }, line);
}

/** Route the assets, seed `plan`, and open it. Every test opens exactly one plan;
 * the routing is what keeps the two asset URLs off the network in all of them. */
async function open(
  page: import("@playwright/test").Page,
  daemon: { seed: (input: { plan: string }) => Promise<string> },
  plan: string,
): Promise<void> {
  await routeAssets(page);
  await daemon.seed({ plan });
  await page.goto("/");
  await planSurface(page);
}

test("a safe image renders on its source line and the markup stays put", async ({
  page,
  daemon,
}) => {
  await open(page, daemon, IMAGE_PLAN);
  await imageDecoded(page);
  const drawn = (await shadowImages(page)).find((i) => i.src === GOOD);
  // The alt is the accessible name, and it is the alt as written — not the whole
  // markup the row still shows.
  expect(drawn?.alt).toBe("the cache topology");
  expect(drawn?.hidden).toBe(false);
  expect(drawn?.referrerPolicy).toBe("no-referrer");
  // The picture hangs off the image's own source row rather than replacing it or
  // landing on a row of its own.
  expect(drawn?.row).toBe(String(IMAGE_LINE));
  await expect(page.locator(".diffview")).toContainText(IMAGE_MARKUP);
});

test("copying the image's row yields the source markdown, not the alt text", async ({
  page,
  context,
  daemon,
}) => {
  await open(page, daemon, IMAGE_PLAN);
  // The criterion that forced images not to collapse. An <img alt> inside the
  // selection is exactly what could add `the cache topology` to the copied text.
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await imageDecoded(page);
  const copied = await page.evaluate(async (ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot as
      | (ShadowRoot & { getSelection?: () => Selection | null })
      | null;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) => r.getAttribute("data-line") === String(ln),
    );
    if (sh == null || row == null) return { selection: "", clipboard: "<no row>" };
    const range = document.createRange();
    range.selectNodeContents(row);
    const sel = sh.getSelection?.() ?? getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // execCommand rather than a Ctrl+C keypress, because it drives the copy from
    // inside the page with no dependency on which element the harness left
    // focused — and it runs the SAME serialization the keypress would, which is
    // the whole question. Selection.toString() is NOT that serialization: it takes
    // a different path through Blink, one that cannot emit an image's alt text, so
    // reading the real clipboard is what makes this assertion mean anything.
    document.execCommand("copy");
    return { selection: sel?.toString() ?? "", clipboard: await navigator.clipboard.readText() };
  }, IMAGE_LINE);
  expect(copied.selection).toBe(IMAGE_MARKUP);
  expect(copied.clipboard).toBe(IMAGE_MARKUP);
});

test("the image's row grows, and its gutter number grows with it", async ({ page, daemon }) => {
  await open(page, daemon, IMAGE_PLAN);
  await imageDecoded(page);
  const imageRow = await rowHeights(page, IMAGE_LINE);
  const proseRow = await rowHeights(page, PROSE_ABOVE);
  expect(imageRow.row).toBeGreaterThan(proseRow.row);
  // The gutter cell shares the row's grid track, so it grows to the same height.
  // A number that stayed one line tall would mean the picture had escaped the
  // grid, and every line number below it would be pointing at the wrong text.
  expect(imageRow.number).toBe(imageRow.row);
});

test("every row still has exactly one gutter number", async ({ page, daemon }) => {
  await open(page, daemon, IMAGE_PLAN);
  await imageDecoded(page);
  const counts = await gridCounts(page);
  expect(counts.rows).toBe(IMAGE_PLAN.trimEnd().split("\n").length);
  expect(counts.numbers).toBe(counts.rows);
});

test("the monospace grid does not move on the image's row or its neighbours", async ({
  page,
  daemon,
}) => {
  await open(page, daemon, IMAGE_PLAN);
  await imageDecoded(page);
  const [above, onIt, below] = await Promise.all([
    firstGlyphX(page, PROSE_ABOVE),
    firstGlyphX(page, IMAGE_LINE),
    firstGlyphX(page, PROSE_BELOW),
  ]);
  // The image carries an inline margin, which every chip in the sheet is forbidden
  // — it can only do that because display:block takes it out of the inline flow.
  // If it ever became inline, this row's glyphs would shift and the source columns
  // vim motions and search highlights resolve against would stop matching.
  expect(onIt).toBe(above);
  expect(below).toBe(above);
});

test("the size cap binds against a real intrinsic size", async ({ page, daemon }) => {
  await open(page, daemon, IMAGE_PLAN);
  await imageDecoded(page);
  const drawn = (await shadowImages(page)).find((i) => i.src === GOOD);
  // 900x700 intrinsic: the height cap is what bites (aspect is under the 2.5 that
  // would make the width cap bind instead), so the rendered height must BE the
  // cap rather than merely fall under it. Border-box, so the 1px hairline each
  // side rides on top of the capped content height.
  expect(drawn!.naturalHeight).toBeGreaterThan(CAP_PX);
  expect(drawn!.height).toBeLessThanOrEqual(CAP_PX + 2);
  expect(drawn!.height).toBeGreaterThanOrEqual(CAP_PX);
  expect(drawn!.width).toBeLessThanOrEqual(MEASURE_PX);
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

test("the comment affordance still reaches the image's taller row", async ({ page, daemon }) => {
  await open(page, daemon, IMAGE_PLAN);
  // The gutter "+" is positioned by the library against the row it hovers, and the
  // composer anchors to the line's annotation slot. A row several hundred pixels
  // tall is the case that could put the button somewhere unreachable or open the
  // composer against the wrong line.
  await imageDecoded(page);
  const plus = await revealGutterPlus(page, IMAGE_LINE);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(page.locator(".diffview")).toContainText(IMAGE_MARKUP);
});

test("a failed load leaves no broken-image chrome", async ({ page, daemon }) => {
  await open(page, daemon, IMAGE_PLAN);
  await expect
    .poll(async () => (await shadowImages(page)).find((i) => i.src === GONE)?.hidden)
    .toBe(true);
  const failed = (await shadowImages(page)).find((i) => i.src === GONE);
  // Hidden really collapses: the UA's own [hidden] rule is overridden by the
  // sheet's display: block, so this is the one assertion that would catch that
  // CSS line going missing.
  expect(failed?.width).toBe(0);
  expect(failed?.height).toBe(0);
  // And the row degrades to the rung below — the link chip over the literal
  // markdown, which is exactly what an image that never drew already wore.
  const chipped = await page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = sh?.querySelector(`[data-content] [data-line="${ln}"]`);
    const marked = [...(row?.querySelectorAll('[data-md~="link"]') ?? [])]
      .map((el) => el.textContent ?? "")
      .join("");
    return { rowText: row?.textContent ?? "", marked };
  }, BROKEN_LINE);
  expect(chipped.rowText).toBe(`![an asset that is not there](${GONE})`);
  expect(chipped.marked).toBe(`![an asset that is not there](${GONE})`);
});

test("an image in a table cell draws nothing, and the repaint settles", async ({
  page,
  daemon,
}) => {
  // A regression test for a hang, not for a look. tables.ts (EXC-864) decides a row
  // is settled by comparing its child count to its cell count, so an appended image
  // made every repaint rebuild the row — and the rebuild never adopted the image,
  // because it places tokens by column and an image sits past the last cell's end.
  // Measured before the fix: ~10,800 childList mutations in two seconds, climbing;
  // the same window with a plain table, or with the image outside one, was zero.
  await open(page, daemon, TABLE_PLAN);
  await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const w = window as unknown as { __mutations: number };
    w.__mutations = 0;
    new MutationObserver((records) => {
      w.__mutations += records.length;
    }).observe(sh as unknown as Node, { childList: true, subtree: true });
  });
  await page.waitForTimeout(750);
  const settled = await page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) => r.getAttribute("data-line") === String(ln),
    );
    return {
      mutations: (window as unknown as { __mutations: number }).__mutations,
      images: (sh?.querySelectorAll("img[data-md-image]") ?? []).length,
      celled: row?.querySelector(":scope > [data-table-cell]") !== null,
    };
  }, TABLE_BODY_LINE);
  expect(settled.celled).toBe(true);
  expect(settled.images).toBe(0);
  expect(settled.mutations).toBe(0);
  // The cell still reads as its markup, which is the rung this descends to.
  await expect(page.locator(".diffview")).toContainText(`![a shot](${GOOD})`);
});

test("a non-http target draws nothing, and a fenced one stays literal text", async ({
  page,
  daemon,
}) => {
  await open(page, daemon, IMAGE_PLAN);
  await imageDecoded(page);
  const drawn = await shadowImages(page);
  // Two images exist — the good one and the 404 — and neither the data: payload
  // nor the fenced line contributed one. A data: URL that rendered would be the
  // safety gate failing open; a fenced one would be markup leaking into a code
  // panel, the same thing EXC-868 checked for its chip.
  expect(drawn).toHaveLength(2);
  expect(drawn.map((i) => i.src).sort()).toEqual([GONE, GOOD].sort());
  await expect(page.locator(".diffview")).toContainText(`![fenced and literal](${GOOD})`);
});
