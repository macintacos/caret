// The COMBINED plan surface (EXC-871), which is a different subject from any one
// construct. The epic's fourteen render passes each shipped with a spec of their own,
// and each of those verified its construct against a surface where the others were
// partly or wholly absent — so nothing until now has asserted what happens when all
// fourteen draw on one document at once.
//
// Every case here needs a real browser for the same reason its own spec did, compounded:
// the decorations are pseudo-elements and background layers over transparent characters,
// so they exist only where generated content is painted, custom properties resolve
// through a shadow boundary, and a clipboard exists. happy-dom has none of the three. The
// settle case additionally needs the MutationObserver loop SourceView drives its passes
// from, which only a mounted view has.
//
// This spec seeds the committed fixture itself — scripts/tasks/dev/fake-plan.md, whose
// `## Rendering showcase` section is the visual baseline every PR in the epic cites —
// rather than a plan literal of its own. That is the point rather than a convenience: a
// literal here would be a fifteenth throwaway fixture, and the constructs it exercised
// would drift away from the ones a human actually looks at. The trade is that a Markdown
// diff can red this spec, which the preflight gate does not narrow to `test e2e`; that is
// recorded rather than worked around.
//
// Rows are located STRUCTURALLY — by the decoration they carry and by their position
// relative to each other — with one deliberate exception: the search case types
// "Rendering showcase", which is a heading the fixture's own contract keeps. Everything
// else is found by what it draws, so rewording the fixture's prose is free and deleting a
// construct from the showcase is not.
//
// Every question below lives here and nowhere else, and each is one of this issue's
// acceptance criteria:
//
//   1. every construct the epic draws still draws, together, on one document; each
//      replacement marker really hides the character it draws over; and the combined
//      repaint settles instead of looping;
//   2. compare mode offers none of them — asserted for the WHOLE attribute set rather
//      than for the `data-md` subset EXC-867 could see at the time;
//   3. copy carries the real plan text with its markers;
//   4. the gutter `+`, a row click, a drag range, the search anchor and the line cursor
//      all still reach a row that carries decorations, and a row carrying THREE of them
//      still costs the monospace grid nothing;
//   5. a vendor palette resolves every decoration's paint.
//
// Everything narrower stays where it already is: which characters are a marker is
// inlineSpans.test.ts, which token gets the attribute is inlineDecorate.test.ts, the
// declarations are coreStyles.test.ts, the contrast floors are theme.test.ts, and each
// construct's own geometry is its own spec.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";

import { type Daemon, expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
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
  ["data-table-card", "the scroll card a wide table gets (EXC-864)"],
  ["data-code-card", "the scroll card an overflowing fence gets (EXC-729)"],
  ["data-file-ref", "file and folder references (EXC-687, EXC-918, EXC-880)"],
] as const;

async function openShowcase(page: Page, daemon: Daemon): Promise<void> {
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
async function scrollToLine(page: Page, line: number): Promise<void> {
  await page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    sh?.querySelector(`[data-content] [data-line="${ln}"]`)?.scrollIntoView({ block: "center" });
  }, line);
}

/** How many elements in the content column carry `attribute`, or -1 when the source view
 * is not mounted at all. Scoped to `[data-content]` so a gutter cell or an annotation's
 * own copy of a row can never be counted as a decorated line. */
function decorationCount(page: Page, attribute: string): Promise<number> {
  return page.evaluate((attr) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return sh?.querySelectorAll(`[data-content] [${attr}]`).length ?? -1;
  }, attribute);
}

test("every construct the epic draws renders on one document", async ({ daemon, page }) => {
  await openShowcase(page, daemon);
  const counts = await Promise.all(
    DECORATIONS.map(async ([attr, who]) => ({
      attr,
      who,
      count: await decorationCount(page, attr),
    })),
  );
  // Reported as one array so a missing construct names itself in the failure rather
  // than reding on the first attribute and hiding the rest.
  expect(counts.filter((c) => c.count <= 0)).toEqual([]);
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
  await planSurface(page);
  await expect
    .poll(async () => (await taggedRuns(page, "data-md-image")).length)
    .toBeGreaterThan(0);

  await page.getByRole("button", { name: "Compare versions" }).click();
  // The positive anchor first, and it is what makes the absences mean anything. Both
  // views mount a host with class `diffview`, so once compare has swapped one in for the
  // other every count below reads 0 — including on a compare view that rendered nothing
  // at all. Anchoring on the raw source being THERE is what distinguishes "not offered
  // here" from "not painted yet" (browser-testing.md § absence assertions).
  //
  // The anchor is the appended line rather than a row count, because compare renders the
  // CHANGED hunk and its context rather than the whole plan — about ten rows here, not
  // the fixture's ~970 — so a row count large enough to mean anything would be wrong.
  await expect(page.locator(".diffview")).toContainText("A second version.");
  await expect.poll(() => decorationCount(page, "data-line")).toBeGreaterThan(3);
  for (const [attr, who] of DECORATIONS) {
    await expect.poll(() => decorationCount(page, attr), { message: `${attr} — ${who}` }).toBe(0);
  }
});

test("copying across the marker families yields the source verbatim", async ({
  context,
  daemon,
  page,
}) => {
  await openShowcase(page, daemon);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  // The span is chosen by what its rows CARRY, and it deliberately stops short of the
  // first table cell. That boundary is the whole test: SourceView hands a selection that
  // crosses a carded table to tableCopy.ts, which rebuilds the clipboard from TEXT NODES
  // only — and a pseudo-element is not a text node, so on that path a leaked glyph is
  // impossible by construction and the equality below would prove nothing. Blink's own
  // serializer runs on a table-free span, and that one really can emit generated content,
  // exactly as EXC-870 found it emitting an image's alt.
  //
  // What the span still crosses: the quoted task's level bar and checkbox, the bullets
  // and ordered markers under "Bullet and ordered lists", and the nested quote bars under
  // "Quoted text" — three of the four replacement markers plus the list marker family.
  // The thematic break is copied separately below, since it sits past the tables.
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
    const firstCell = rows.findIndex((r, i) => i > from && r.querySelector("[data-table-cell]"));
    const to = (firstCell < 0 ? rows.length : firstCell) - 1;
    if (sh == null || from < 0 || to <= from) return { span: [from, to], clipboard: "", rows: [] };
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
  expect(copied.rows.length).toBeGreaterThan(10);
  // textContent excludes generated content and the clipboard does not, so equality here
  // is the whole claim in one line: no drawn bullet, checkbox, bar or dot reached the
  // copy, and no transparent source character was dropped from it either.
  expect(copied.clipboard).toBe(copied.rows.join("\n"));
  // The markers really are in there, which is what the epic reversed its original spec to
  // guarantee: the source is what a reviewer pastes back to the agent.
  expect(copied.clipboard).toContain("[ ]");
  expect(copied.clipboard).toContain("> ");
});

test("copying a thematic break yields its dashes, not the drawn line", async ({
  context,
  daemon,
  page,
}) => {
  await openShowcase(page, daemon);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // The rule's own row, alone and table-free so Blink serializes it. Every character on
  // it is transparent and the line itself is a background layer, so the risk here is the
  // mirror of the one above: the row copying as an empty line rather than as its dashes.
  const copied = await page.evaluate(async () => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot as
      | (ShadowRoot & { getSelection?: () => Selection | null })
      | null;
    const row = sh?.querySelector("[data-content] [data-line][data-md-rule]") as HTMLElement | null;
    if (sh == null || row == null) return { clipboard: "", source: "" };
    const range = document.createRange();
    range.selectNodeContents(row);
    const sel = sh.getSelection?.() ?? getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.execCommand("copy");
    return { clipboard: await navigator.clipboard.readText(), source: row.textContent ?? "" };
  });
  expect(copied.source.trim()).toMatch(/^-{3,}$/);
  expect(copied.clipboard).toBe(copied.source);
});

/** The densest row the fixture draws: a quoted task, carrying a level bar, a suppressed
 * list marker and a checkbox in one line box. Every gesture below is aimed at it. */
function densestRow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) =>
        r.querySelector("[data-md-quote]") !== null &&
        r.querySelector("[data-md-checkbox]") !== null,
    );
    return Number(row?.getAttribute("data-line") ?? -1);
  });
}

test("a decorated row still opens a comment composer, from the gutter and from the row", async ({
  daemon,
  page,
}) => {
  await openShowcase(page, daemon);
  // Both decorations on this row are absolutely-positioned pseudo elements over
  // transparent characters, so neither can move the gutter's hit target or the row's —
  // this is what proves it, for both gestures the issue names.
  const line = await densestRow(page);
  expect(line).toBeGreaterThan(0);
  await scrollToLine(page, line);

  const plus = await revealGutterPlus(page, line);
  await plus.click();
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  await expect(composer).toBeVisible();
  await expect(composer.getByRole("textbox", { name: "Comment" })).toBeVisible();
  // Two Escapes, not one: the first blurs the editor and the second dismisses the
  // composer (diff-surface.e2e.ts pins that pair).
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(composer).toHaveCount(0);

  // The row click, the second gesture: pressing the line's own content opens the same
  // composer for the same line.
  const y = await lineCenterY(page, line);
  const x = await page
    .locator(".diff-plan")
    .evaluate((el) => el.getBoundingClientRect().x + el.getBoundingClientRect().width / 2);
  await page.mouse.click(x, y);
  await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
});

test("a drag range crosses the decorated rows and bands each one", async ({ daemon, page }) => {
  await openShowcase(page, daemon);
  // A CONTIGUOUS run of checkbox rows, found by walking forward from the first one rather
  // than by taking the first four in the document: the fixture carries task lists in two
  // sections, and `slice(0, 4)` would silently span a paragraph break between them and
  // then assert a banding that never had to hold.
  const lines = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const rows = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])];
    const start = rows.findIndex((r) => r.querySelector("[data-md-checkbox]") !== null);
    const run: number[] = [];
    for (let i = start; i < rows.length; i++) {
      if (rows[i]?.querySelector("[data-md-checkbox]") === null) break;
      run.push(Number(rows[i]?.getAttribute("data-line")));
    }
    return run;
  });
  expect(lines.length).toBeGreaterThanOrEqual(3);

  await scrollToLine(page, lines[1] as number);
  const gutterX = await page
    .locator(".diff-plan")
    .evaluate((el) => el.getBoundingClientRect().x + 6);
  await page.mouse.move(gutterX, await lineCenterY(page, lines[0] as number));
  await page.mouse.down();
  await page.mouse.move(gutterX, await lineCenterY(page, lines.at(-1) as number), { steps: 12 });
  await page.mouse.up();

  const banded = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return [...(sh?.querySelectorAll("[data-content] [data-line][data-selected-line]") ?? [])].map(
      (r) => Number(r.getAttribute("data-line")),
    );
  });
  expect(banded).toEqual(lines);
});

test("the search anchor and the line cursor still land on decorated rows", async ({
  daemon,
  page,
}) => {
  await openShowcase(page, daemon);
  await waitPastSafeModeGrace(page);
  const cursor = page.locator(".diffview [data-content] [data-line][data-caret-cursor]");

  // Both features count CHARACTERS: the search highlight resolves a match's columns
  // against the row's own text, and j/k walks rendered rows. A decoration that took room
  // in a line box, or that removed a character from a row, would put both off by one on
  // exactly the rows the epic draws. `showcase` occurs only inside the section this
  // epic added, and every row it matches there carries a decoration.
  await page.keyboard.press("/");
  await page.locator("input[aria-label='Search plan']").fill("Rendering showcase");
  await expect.poll(() => cursor.count()).toBe(0);
  await page.keyboard.press("Enter");
  await expect(cursor).toHaveCount(1);
  const parked = Number(await cursor.getAttribute("data-line"));
  expect(parked).toBeGreaterThan(0);
  expect(((await cursor.textContent()) ?? "").toLowerCase()).toContain("rendering showcase");

  // Then walk it down into the section's decorated rows with the vim motion, one row per
  // press, and land on something the epic drew.
  await page.keyboard.press("Escape");
  const seen: number[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("j");
    await expect
      .poll(async () => Number(await cursor.getAttribute("data-line")))
      .toBe(parked + i + 1);
    seen.push(parked + i + 1);
  }
  const decorated = await page.evaluate((rows) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return rows.filter((ln) => {
      const row = sh?.querySelector(`[data-content] [data-line="${ln}"]`);
      return row?.querySelector("[data-md], [data-md-list], [data-code-fence]") != null;
    }).length;
  }, seen);
  expect(decorated).toBeGreaterThan(0);
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
  const dense = await densestRow(page);
  expect(dense).toBeGreaterThan(0);
  // The plain row is found structurally: the nearest row ABOVE the dense one that carries
  // no decoration at all and starts at the outer margin. Naming it by its prose would put
  // the fixture's wording back on this spec's critical path.
  const plain = await page.evaluate((denseLine) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const rows = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])];
    const at = rows.findIndex((r) => Number(r.getAttribute("data-line")) === denseLine);
    for (let i = at - 1; i >= 0; i--) {
      const row = rows[i];
      if (row === undefined) continue;
      const text = row.textContent ?? "";
      if (row.querySelectorAll("[data-md], [data-md-list], [data-md-quote]").length > 0) continue;
      if (text.trim().length < 20 || /^\s/.test(text)) continue;
      return Number(row.getAttribute("data-line"));
    }
    return -1;
  }, dense);
  expect(plain).toBeGreaterThan(0);

  const [denseX, plainX] = await Promise.all([firstGlyphX(page, dense), firstGlyphX(page, plain)]);
  expect(denseX).toBe(plainX);
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
  // vendor token actually resolves through the shadow boundary and into the sheet.
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await page.getByRole("button", { name: "Light theme" }).click();
  await page.getByRole("menuitemradio", { name: "Catppuccin Latte" }).click();
  await page.keyboard.press("Escape");
  // The identity anchor: this really is Latte and not whichever palette was live before.
  // It is the one hard-coded colour here, and it is what stops the token comparisons
  // below from being tautologies.
  await expect(page.locator("html")).toHaveAttribute("style", /--paper-sunk:\s*#dce0e8/i);

  const paint = await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const pick = <T>(selector: string, read: (el: HTMLElement) => T): T | null => {
      const el = sh?.querySelector(selector) as HTMLElement | null;
      return el === null || el === undefined ? null : read(el);
    };
    // What the palette's own tokens resolve to inside this shadow root, measured rather
    // than transcribed — a hex copied into this file is a second place a flavour bump has
    // to be edited, and it reds naming a colour instead of a token.
    const probe = (token: string) => {
      const el = document.createElement("span");
      el.style.color = `var(${token})`;
      sh?.appendChild(el);
      const resolved = getComputedStyle(el).color;
      el.remove();
      return resolved;
    };
    return {
      inkSoft: probe("--ink-soft"),
      inkFaint: probe("--ink-faint"),
      chip: pick('[data-content] [data-line] [data-md~="code"]', (el) => {
        return getComputedStyle(el).backgroundImage;
      }),
      bullet: pick('[data-content] [data-line] [data-md-list="bullet"]', (el) => {
        return getComputedStyle(el, "::before").color;
      }),
      quoteBar: pick("[data-content] [data-line] [data-md-quote]", (el) => {
        return getComputedStyle(el, "::before").backgroundColor;
      }),
      checkbox: pick("[data-content] [data-line] [data-md-checkbox]", (el) => {
        return getComputedStyle(el, "::before").color;
      }),
      rule: pick("[data-content] [data-line][data-md-rule]", (el) => {
        return getComputedStyle(el).backgroundImage;
      }),
      separator: pick("[data-content] [data-line][data-table-rule]", (el) => {
        return getComputedStyle(el).borderBottomColor;
      }),
    };
  });

  // One assertion per side of EXC-871's replacement/supplementary rule, on the palette
  // that made the rule necessary: the four replacement marks land on this palette's
  // --ink-soft, the supplementary separator on its --ink-faint. Opaque on both sides —
  // the separator spent a 10%-alpha --rule until this sweep, and an alpha suffix here
  // would be that regression coming back.
  expect(paint.inkSoft).not.toBe(paint.inkFaint);
  expect(paint.bullet).toBe(paint.inkSoft);
  expect(paint.quoteBar).toBe(paint.inkSoft);
  expect(paint.checkbox).toBe(paint.inkSoft);
  expect(paint.rule).toContain(paint.inkSoft);
  expect(paint.separator).toBe(paint.inkFaint);

  // The chip is four background layers, one per member, each resolving to `transparent`
  // through its var() fallback when its member is absent — so "contains a gradient" would
  // pass on a palette where no tint derived at all. Counting the layers that are NOT
  // transparent is what pins that --chip-code itself came out of the recipe.
  const layers = (paint.chip ?? "").split(/,\s*(?=linear-gradient)/);
  expect(layers).toHaveLength(4);
  expect(layers.filter((l) => !/rgba\(0,\s*0,\s*0,\s*0\)/.test(l))).toHaveLength(1);
});
