// The COMBINED plan surface (EXC-871), which is a different subject from any one
// construct. The epic's fourteen render passes each shipped with a spec of their own,
// and each of those verified its construct against a surface where the others were
// partly or wholly absent — so nothing until now has asserted what happens when all
// fourteen draw on one document at once.
//
// This spec seeds the committed fixture itself — scripts/tasks/dev/fake-plan.md, whose
// `## Rendering showcase` section is the visual baseline every PR in the epic cites —
// rather than a plan literal of its own. That is the point rather than a convenience: a
// literal here would be a fifteenth throwaway fixture, and the constructs it exercised
// would drift away from the ones a human actually looks at. The trade is that a Markdown
// diff can red this spec, which the preflight gate does not narrow to `test e2e`; that is
// recorded rather than worked around.
//
// Rows are located by the DECORATION they carry, never by their prose, so editing the
// fixture's wording cannot break anything below. Deleting a construct from it can, and
// should — the showcase's own contract is that it grows a sub-heading per decorated
// construct and never folds one away.
//
// Every question below lives here and nowhere else, and each is one of this issue's
// acceptance criteria:
//
//   1. every construct the epic draws still draws, together, on one document, and the
//      combined repaint settles instead of looping;
//   2. compare mode offers none of them — asserted for the WHOLE attribute set rather
//      than for the `data-md` subset EXC-867 could see at the time;
//   3. copy carries the real plan text with its markers, across a span that crosses four
//      marker families at once;
//   4. commenting and the drag range still reach a row that carries decorations, and a
//      row carrying THREE of them still costs the monospace grid nothing;
//   5. a vendor palette resolves every decoration's paint.
//
// Everything narrower stays where it already is: which characters are a marker is
// inlineSpans.test.ts, which token gets the attribute is inlineDecorate.test.ts, the
// declarations are coreStyles.test.ts, the contrast floors are theme.test.ts, and each
// construct's own geometry is its own spec.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@test/e2e/support/fixtures.ts";
import {
  firstGlyphX,
  lineCenterY,
  planSurface,
  revealGutterPlus,
  settledMutations,
  taggedRuns,
} from "@test/e2e/support/source-view.ts";

/** The dev fixture, read from disk so this spec and the committed baseline cannot
 * disagree about what the showcase contains. */
const SHOWCASE_PLAN = readFileSync(
  fileURLToPath(new URL("../../scripts/tasks/dev/fake-plan.md", import.meta.url)),
  "utf8",
);

/** The repo root, seeded as the review's cwd. The fixture cites REAL repo paths —
 * `package.json`, `doc/agents`, `ui/src/lib/markdown.ts` — and the daemon resolves a
 * reference against the review's cwd, so a throwaway project directory would leave every
 * file reference unresolved and quietly drop a whole construct from the surface. This is
 * the same cwd `mise run dev` gives the fixture. */
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Every attribute the epic's decoration passes write onto the source view, with the
 * ticket that introduced it. One list, used twice: once to assert each is present on the
 * combined surface, and once to assert every one of them is absent in compare mode. A
 * new decorated construct adds a line here and is then covered by both. */
const DECORATIONS = [
  ["data-md", "inline emphasis / code / link runs (EXC-866, EXC-867)"],
  ["data-md-list", "list markers (EXC-861)"],
  ["data-md-checkbox", "task checkboxes (EXC-860)"],
  ["data-md-quote", "blockquote level bars (EXC-863)"],
  ["data-md-rule", "thematic breaks (EXC-862)"],
  ["data-md-image", "inline images (EXC-870)"],
  ["data-code-fence", "fence markers (EXC-869)"],
  ["data-table-cell", "table cells (EXC-864)"],
  ["data-table-pipe", "table pipes (EXC-864)"],
  ["data-file-ref", "file and folder references (EXC-687, EXC-918, EXC-880)"],
] as const;

async function openShowcase(
  page: import("@playwright/test").Page,
  daemon: { seed: (input: { plan: string; cwd: string }) => Promise<string> },
): Promise<void> {
  await daemon.seed({ plan: SHOWCASE_PLAN, cwd: REPO_ROOT });
  await page.goto("/");
  await planSurface(page);
  // The fixture is long enough that the passes are still working when the surface first
  // resolves, and the file references need a daemon round-trip on top of that. Wait for
  // the two that arrive last rather than for a duration.
  await expect
    .poll(async () => (await taggedRuns(page, "data-md-image")).length)
    .toBeGreaterThan(0);
  await expect.poll(() => decorationCount(page, "data-file-ref")).toBeGreaterThan(0);
}

/** Scroll a source line into the middle of the plan surface. The fixture is ~970 rows,
 * so anything the showcase draws is far below the fold — and `revealGutterPlus` hovers a
 * viewport coordinate, which silently misses a row that is not on screen. */
async function scrollToLine(page: import("@playwright/test").Page, line: number): Promise<void> {
  await page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    sh?.querySelector(`[data-content] [data-line="${ln}"]`)?.scrollIntoView({ block: "center" });
  }, line);
}

/** How many elements in the source view's shadow root carry `attribute`. */
function decorationCount(
  page: import("@playwright/test").Page,
  attribute: string,
): Promise<number> {
  return page.evaluate((attr) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return sh?.querySelectorAll(`[${attr}]`).length ?? -1;
  }, attribute);
}

test("every construct the epic draws renders on one document", async ({ daemon, page }) => {
  await openShowcase(page, daemon);
  const counts = await Promise.all(
    DECORATIONS.map(
      async ([attr, who]) => `${attr} (${who}): ${await decorationCount(page, attr)}`,
    ),
  );
  // Reported as one array so a missing construct names itself in the failure rather
  // than reding on the first attribute and hiding the rest.
  expect(counts.filter((line) => line.endsWith(": 0") || line.endsWith(": -1"))).toEqual([]);
});

test("every replacement marker really does hide the character it draws over", async ({
  daemon,
  page,
}) => {
  await openShowcase(page, daemon);
  // The claim the whole replacement/supplementary split rests on: these four take their
  // source glyph to `transparent` and draw in the column it vacated, which is what puts
  // them under WCAG 1.4.11 rather than among the merely-tinted markers.
  //
  // It is asserted HERE, against a live cascade, because the text-scanning pins in
  // coreStyles.test.ts cannot see a rule that never reached the sheet. EXC-871 shipped a
  // comment with a second `*/` in it; CSS error recovery ate the `{…}` block after the
  // prose it left behind, `[data-md-quote] { color: transparent }` silently vanished, and
  // every source-level assertion still passed. The quote markers were visible in the
  // browser for exactly as long as nobody looked.
  const hidden = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const read = (selector: string) => {
      const el = sh?.querySelector(selector) as HTMLElement | null;
      return el === null || el === undefined ? "<missing>" : getComputedStyle(el).color;
    };
    return {
      quote: read("[data-content] [data-line] [data-md-quote]"),
      bullet: read('[data-content] [data-line] [data-md-list="bullet"]'),
      checkbox: read("[data-content] [data-line] [data-md-checkbox]"),
      // The rule row takes the whole line's ink, tokens and all.
      rule: read("[data-content] [data-line][data-md-rule]"),
    };
  });
  expect(hidden).toEqual({
    quote: "rgba(0, 0, 0, 0)",
    bullet: "rgba(0, 0, 0, 0)",
    checkbox: "rgba(0, 0, 0, 0)",
    rule: "rgba(0, 0, 0, 0)",
  });
});

test("the combined surface settles instead of repainting forever", async ({ daemon, page }) => {
  await openShowcase(page, daemon);
  // tables.ts settles a row by counting its children, so a pass that appends one inside
  // a celled row loops the repaint observer — ~10,800 childList mutations in two seconds
  // when EXC-870 met it. Every pass has shown its own zero in isolation; this is the
  // first time all of them run over one document, and over the fixture's SEVEN carded
  // tables rather than the one or two a purpose-built plan carries.
  const mutations = await settledMutations(page);
  const settled = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const rows = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])];
    return {
      rows: rows.length,
      celled: rows.filter((r) => r.querySelector(":scope > [data-table-cell]") !== null).length,
      decoratedInsideCells: rows.filter(
        (r) =>
          r.querySelector(":scope > [data-table-cell]") !== null &&
          r.querySelector("[data-md], [data-file-ref]") !== null,
      ).length,
    };
  });
  expect(mutations).toBe(0);
  // Not a vacuous zero: the celled rows really are there, and some of them really do
  // carry a decoration — the arrangement the child-count trap needs to fire at all.
  expect(settled.rows).toBeGreaterThan(500);
  expect(settled.celled).toBeGreaterThan(0);
  expect(settled.decoratedInsideCells).toBeGreaterThan(0);
});

test("compare mode offers none of the decorations", async ({ daemon, page }) => {
  // The epic's scope boundary (EXC-855): these affordances are single-version only, and
  // they are absent by construction — decorateInlineRuns is wired into SourceView and
  // never into SourceDiffView. EXC-867 asserted that for `data-md` alone, before eight
  // further attributes existed; this asserts it for the whole set, which is what "compare
  // renders raw source, unchanged" actually claims.
  await daemon.seedVersions(2, [SHOWCASE_PLAN, `${SHOWCASE_PLAN}\nA second version.\n`]);
  await page.goto("/");
  // seedVersions carries the fixture's default cwd, so the reference layer is quieter
  // here than above — which is why the wait below is on a construct the daemon does not
  // have to resolve. The absence assertions read the whole set either way.
  await planSurface(page);
  await expect
    .poll(async () => (await taggedRuns(page, "data-md-image")).length)
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Compare versions" }).click();
  for (const [attr, who] of DECORATIONS) {
    // toHaveCount(0)'s shape rather than toBeHidden: "not offered here" is the claim,
    // and a hidden element would satisfy "painted nothing" without satisfying it.
    await expect.poll(() => decorationCount(page, attr), { message: `${attr} — ${who}` }).toBe(0);
  }
});

test("copying a span across four marker families yields the source verbatim", async ({
  context,
  daemon,
  page,
}) => {
  await openShowcase(page, daemon);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // A contiguous run of rows chosen by what they CARRY: the first row holding a quote
  // marker and a checkbox at once, through the next thematic break. That span crosses
  // the level bar, the checkbox, the list marker and the rule — every decoration in the
  // epic that takes its source character to transparent and draws over the column.
  const copied = await page.evaluate(async () => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot as
      | (ShadowRoot & { getSelection?: () => Selection | null })
      | null;
    const rows = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])] as HTMLElement[];
    const from = rows.findIndex(
      (r) =>
        r.querySelector("[data-md-quote]") !== null &&
        r.querySelector("[data-md-checkbox]") !== null,
    );
    const to = rows.findIndex((r, i) => i > from && r.hasAttribute("data-md-rule"));
    if (sh == null || from < 0 || to < 0) return { span: [from, to], clipboard: "", rows: [] };
    const range = document.createRange();
    range.setStartBefore(rows[from] as Node);
    range.setEndAfter(rows[to] as Node);
    const sel = sh.getSelection?.() ?? getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // execCommand runs the same serialization a Ctrl+C would, with no dependency on
    // what the harness left focused. The result is read from navigator.clipboard and
    // never from Selection.toString(): the two take different paths through Blink, and
    // only the clipboard one can emit generated content — which is exactly the leak
    // this asserts against, and the shape that hid EXC-870's Critical.
    document.execCommand("copy");
    return {
      span: [from, to],
      clipboard: await navigator.clipboard.readText(),
      rows: rows.slice(from, to + 1).map((r) => r.textContent ?? ""),
    };
  });

  expect(copied.span[0]).toBeGreaterThanOrEqual(0);
  expect(copied.span[1]).toBeGreaterThan(copied.span[0] as number);
  // textContent excludes generated content and the clipboard does not, so equality here
  // is the whole claim in one line: no drawn bullet, checkbox, bar or rule reached the
  // copy, and no transparent source character was dropped from it either.
  expect(copied.clipboard).toBe(copied.rows.join("\n"));
  expect(copied.clipboard).toContain("[ ]");
});

test("a decorated row still opens a comment composer", async ({ daemon, page }) => {
  await openShowcase(page, daemon);
  // The quoted task row: a level bar and a checkbox drawn on the same line, which is the
  // densest row the fixture has. Both decorations are absolutely-positioned pseudo
  // elements over transparent characters, so neither can move the gutter's hit target —
  // this is what proves it.
  const line = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) =>
        r.querySelector("[data-md-quote]") !== null &&
        r.querySelector("[data-md-checkbox]") !== null,
    );
    return Number(row?.getAttribute("data-line") ?? -1);
  });
  expect(line).toBeGreaterThan(0);

  await scrollToLine(page, line);
  const plus = await revealGutterPlus(page, line);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.getByRole("textbox", { name: "Comment" })).toBeVisible();
});

test("a drag range crosses the decorated rows and bands each one", async ({ daemon, page }) => {
  await openShowcase(page, daemon);
  // The task-list block, which the fixture writes as four consecutive checkbox rows. A
  // drag is the gesture most exposed to a decoration that took room in the line box: the
  // band is painted per row, and a row whose height or column origin had moved would
  // band short or band the wrong span.
  const lines = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])]
      .filter((r) => r.querySelector("[data-md-checkbox]") !== null)
      .map((r) => Number(r.getAttribute("data-line")))
      .slice(0, 4);
  });
  expect(lines).toHaveLength(4);

  await scrollToLine(page, lines[1] as number);
  const gutterX = await page
    .locator(".diff-plan")
    .evaluate((el) => el.getBoundingClientRect().x + 6);
  await page.mouse.move(gutterX, await lineCenterY(page, lines[0] as number));
  await page.mouse.down();
  await page.mouse.move(gutterX, await lineCenterY(page, lines[3] as number), { steps: 12 });
  await page.mouse.up();

  const banded = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return [...(sh?.querySelectorAll("[data-content] [data-line][data-selected-line]") ?? [])].map(
      (r) => Number(r.getAttribute("data-line")),
    );
  });
  expect(banded).toEqual(lines);
});

test("a decorated row keeps the monospace grid the source columns are read from", async ({
  daemon,
  page,
}) => {
  await openShowcase(page, daemon);
  // The columns every other affordance resolves against: vim motions, the search
  // highlights, the drag range and the comment anchors all count characters. Each
  // construct proved its own zero in isolation; what has never been asked is whether
  // THREE decorations on one row still cost nothing, which is the quoted task — a level
  // bar, a suppressed list marker and a checkbox, all drawn over transparent characters
  // in the same line box.
  const rows = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const all = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])];
    const num = (r: Element | undefined) => Number(r?.getAttribute("data-line") ?? -1);
    return {
      dense: num(
        all.find(
          (r) =>
            r.querySelector("[data-md-quote]") !== null &&
            r.querySelector("[data-md-checkbox]") !== null,
        ),
      ),
      // A plain prose row from the same section, to measure the dense one against.
      plain: num(
        all.find(
          (r) =>
            r.querySelectorAll("[data-md], [data-md-list], [data-md-quote], [data-md-checkbox]")
              .length === 0 && (r.textContent ?? "").startsWith("Quoted, so the checkbox"),
        ),
      ),
    };
  });
  expect(rows.dense).toBeGreaterThan(0);
  expect(rows.plain).toBeGreaterThan(0);

  const [dense, plain] = await Promise.all([
    firstGlyphX(page, rows.dense),
    firstGlyphX(page, rows.plain),
  ]);
  expect(dense).toBe(plain);
});

test("a vendor palette resolves every decoration's paint", async ({ daemon, page }) => {
  // The suite emulates a dark OS (playwright.config.ts), and the theme picker sets the
  // slot for the CURRENT scheme — so a light vendor palette has to be asked for from a
  // light OS or it is chosen into a slot that is not live.
  await page.emulateMedia({ colorScheme: "light" });
  await openShowcase(page, daemon);
  // Catppuccin Latte is the palette the epic's contrast measurements bind on — it is
  // where --ink-faint falls under WCAG 1.4.11's floor on the diff body, which is why the
  // replacement markers moved to --ink-soft (theme.test.ts owns those numbers across all
  // nine). What a browser adds is the half arithmetic cannot reach: that a DERIVED
  // vendor token actually resolves through the shadow boundary. A tint that failed to
  // derive leaves its gradient invalid and background-image computing to "none".
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Light theme" }).click();
  await page.getByRole("menuitemradio", { name: "Catppuccin Latte" }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("style", /--paper-sunk:\s*#dce0e8/i);

  const paint = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const pick = <T>(selector: string, read: (el: HTMLElement) => T): T | null => {
      const el = sh?.querySelector(selector) as HTMLElement | null;
      return el === null || el === undefined ? null : read(el);
    };
    return {
      chip: pick("[data-md]", (el) => getComputedStyle(el).backgroundImage),
      bullet: pick('[data-md-list="bullet"]', (el) => getComputedStyle(el, "::before").color),
      quoteBar: pick("[data-md-quote]", (el) => getComputedStyle(el, "::before").backgroundColor),
      checkbox: pick("[data-md-checkbox]", (el) => getComputedStyle(el, "::before").color),
      rule: pick("[data-md-rule]", (el) => getComputedStyle(el).backgroundImage),
      separator: pick("[data-table-rule]", (el) => getComputedStyle(el).borderBottomColor),
    };
  });

  // The three replacement markers land on Latte's --ink-soft (#5c5f77) and the
  // supplementary separator on its --ink-faint (#7c7f93) — one assertion per side of
  // EXC-871's rule, on the palette that made the rule necessary. Opaque on both sides:
  // the separator spent a 10%-alpha --rule until this sweep, and an alpha suffix here
  // would be that regression coming back.
  expect(paint.bullet).toBe("rgb(92, 95, 119)");
  expect(paint.quoteBar).toBe("rgb(92, 95, 119)");
  expect(paint.checkbox).toBe("rgb(92, 95, 119)");
  expect(paint.separator).toBe("rgb(124, 127, 147)");
  // The two painted as gradients resolved to real colours rather than to "none", which
  // is what an underived tint would leave behind.
  expect(paint.chip).toMatch(/linear-gradient\(/);
  expect(paint.chip).not.toContain("none");
  expect(paint.rule).toMatch(/linear-gradient\(/);
});
