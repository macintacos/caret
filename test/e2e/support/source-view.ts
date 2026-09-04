// The source view's DOM contracts, in one place (typescript-rules.md § Shared-helper
// policy). Two kinds live here. @pierre/diffs renders every source line inside the
// .diffview host's open shadow root, keyed by data-line-index on the row and
// data-line-number-content on its gutter cell — that contract is the library's, not
// caret's, and it moves when the library moves. And caret's own plan scroll container
// (PLAN_SURFACE) plus the readiness wait nearly every spec opens with, so a rename of
// either reaches one edit rather than every spec.
//
// Locators for the chrome AROUND the plan — the navigator, the tally, the breadcrumbs
// — live in chrome.ts, where they are named by role rather than by class.

import type { Locator, Page } from "@playwright/test";

import { currentCrumb } from "@test/e2e/support/chrome.ts";
import { expect, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";

/**
 * The plan's scroll container.
 *
 * `DiffPlanView` marks it `role="presentation"` deliberately, so the element itself
 * carries no semantics for assistive tech and there is no role to query; it has no
 * `data-*` hook either, which leaves the class as the only handle. Naming it once
 * means a rename is one edit rather than every spec that waits for the plan.
 */
export const PLAN_SURFACE = ".diff-plan";

/**
 * A banded code row's gutter→content seam-fill strip, as Chromium serializes it: a shadow
 * layer pulled left by the two insets, with no blur and no spread.
 *
 * Matching the strip's own negative offset is what keeps a "this row is banded" assertion
 * pointed at the strip. Every code row carries the `--caret-card-lift` contact shadow
 * (EXC-1145), so the presence of a box-shadow no longer separates a banded row from a
 * resting one — and a length or "not none" comparison would pass on any second layer at
 * all. Two specs make that claim, so the pattern lives here rather than in either.
 */
export const SEAM_STRIP = /-[\d.]+px 0px 0px 0px/;

/** Resolve once the seeded plan has rendered, returning the container for the callers
 * that go on to scroll it or scope a query inside it. */
export async function planSurface(page: Page): Promise<Locator> {
  const plan = page.locator(PLAN_SURFACE);
  await expect(plan).toBeVisible();
  return plan;
}

/** Seed `plan` through the daemon, open it, and wait for the plan surface. The
 * arrange sequence nearly every source-view spec opens with. */
export async function openPlan(
  page: Page,
  daemon: { seed: (input: { plan: string }) => Promise<string> },
  plan: string,
): Promise<void> {
  await daemon.seed({ plan });
  await page.goto("/");
  await planSurface(page);
}

/** Seed the default fixture plan, open it, and wait for the plan surface. Returns
 * the review id. The bare-review counterpart to `openPlan` above, for the many
 * decision-flow specs that need the id back rather than a plan of their own. */
export async function seedAndOpen(
  page: Page,
  daemon: { seed: () => Promise<string> },
): Promise<string> {
  const id = await daemon.seed();
  await page.goto("/");
  await planSurface(page);
  return id;
}

/** Wait until the plan is ready for real keystrokes: the first content row is visible
 * (rows paint asynchronously) and the post-mount safe-mode grace window has passed.
 * Call right after the plan loads and before the first keypress. */
export async function awaitPlanReadyForKeys(page: Page): Promise<void> {
  await planSurface(page);
  await expect(page.locator(".diffview [data-content] [data-line]").first()).toBeVisible();
  await waitPastSafeModeGrace(page);
}

/** Seed `plan`, open it, and wait until it's ready for real keystrokes — `openPlan`
 * plus the vim-motion specs' mandatory pre-keypress wait. Returns the review id, for
 * the rare spec that also needs it back. */
export async function openPlanForKeys(
  page: Page,
  daemon: { seed: (input: { plan: string }) => Promise<string> },
  plan: string,
): Promise<string> {
  const id = await daemon.seed({ plan });
  await page.goto("/");
  await awaitPlanReadyForKeys(page);
  return id;
}

/** The vertical center (viewport px) of a 1-based source line's row. Waits for the
 * row, then fails with `source line N is not rendered` on timeout — so a wrong line
 * number still fails here rather than as an unrelated miss on whatever the resulting
 * coordinates happened to hit.
 *
 * Polled rather than read once: a bare `page.evaluate` feeding an assertion is a read with
 * no retry, and the web-first assertions the suite otherwise leans on are what absorb a
 * stalled host (browser-testing.md § Timeouts are budgets for the loaded host). Every
 * caller today is incidentally guarded by a wait of its own, but that guard is the
 * caller's rather than the helper's, and a new call site inherits nothing. `expect.poll`
 * inherits the config's assertion budget, so a genuinely wrong line number fails inside
 * 15s rather than swallowing the 60s per-test one.
 *
 * The poll captures the value it proved rather than re-reading for it, which is where this
 * departs from `settledMutations` below: there the second read is the point, since the
 * count it wants is the settled one. Here a re-read could come back null on a row that has
 * since gone, and null typed as a number reaches `page.mouse.move` as a coordinate — the
 * miss this helper exists to fail loudly on. */
export async function lineCenterY(page: Page, line: number): Promise<number> {
  const read = () =>
    page.evaluate((ln) => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const span = Array.from(sh?.querySelectorAll("[data-line-number-content]") ?? []).find(
        (s) => (s.parentElement as HTMLElement)?.dataset.lineIndex === String(ln - 1),
      );
      const r = (span?.parentElement as HTMLElement)?.getBoundingClientRect();
      return r ? r.y + r.height / 2 : null;
    }, line);
  // Held on an object rather than in a local: control-flow analysis cannot see through
  // `expect.poll`'s callback, so a local would still read as `null` at the return.
  const last: { y: number | null } = { y: null };
  await expect
    .poll(
      async () => {
        last.y = await read();
        return last.y;
      },
      { message: `source line ${line} is not rendered` },
    )
    .not.toBeNull();
  return last.y as number;
}

/** A 1-based source line's content row and its gutter number cell, as heights
 * (viewport px). Zero for either when the line is not rendered.
 *
 * The two share a grid row track, so their heights are equal by construction —
 * which is what keeps a line number pointing at its own text however tall the row
 * grows. Asserting that means resolving the gutter cell through the library's own
 * `data-line-index` / `data-line-number-content` pairing, the same contract
 * `lineCenterY` above resolves. */
export function rowHeights(page: Page, line: number): Promise<{ row: number; number: number }> {
  return page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) => r.getAttribute("data-line") === String(ln),
    );
    const cell = [...(sh?.querySelectorAll("[data-line-number-content]") ?? [])].find(
      (n) => (n.parentElement as HTMLElement)?.dataset.lineIndex === String(ln - 1),
    )?.parentElement;
    return {
      row: Math.round(row?.getBoundingClientRect().height ?? 0),
      number: Math.round(cell?.getBoundingClientRect().height ?? 0),
    };
  }, line);
}

/** The viewport x of the first glyph on a 1-based source line, rounded; `null`
 * when the line is not rendered.
 *
 * The monospace grid's left edge for that row, and the probe every decoration
 * that draws INTO a row is measured against: rows render `white-space: pre`, so
 * anything taking width inside one shifts the source columns that vim motions,
 * drag-range selection and the search highlights all resolve against. A
 * decoration is proven to cost nothing by reading this on the decorated row and
 * on an ordinary one and finding them equal. */
export function firstGlyphX(page: Page, line: number): Promise<number | null> {
  return page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) => r.getAttribute("data-line") === String(ln),
    );
    const first = row?.firstElementChild;
    return first ? Math.round(first.getBoundingClientRect().x) : null;
  }, line);
}

/** The 1-based display line of the row whose text is exactly `text`. Throws when no
 * row matches, so a stale fixture string fails here rather than as a puzzling miss on
 * whatever line the number happened to name.
 *
 * Rows are addressed by their TEXT rather than by a line number counted off the seeded
 * plan, because the daemon reflows a plan through rumdl on ingest — the stored text is
 * not the seeded text line-for-line, so a constant counted by hand goes stale the next
 * time a reflow rule changes. */
export async function lineOf(page: Page, text: string): Promise<number> {
  const line = await page.evaluate((want) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) => (r.textContent ?? "") === want,
    );
    return row ? Number(row.getAttribute("data-line")) : null;
  }, text);
  if (line === null) throw new Error(`no rendered row reads exactly ${JSON.stringify(text)}`);
  return line;
}

/** One character cell's advance, in viewport px, measured off the row whose text is
 * exactly `text`. A Range over the row's text rather than the row's own box, because
 * the row is a grid cell that stretches past its content — the Range measures the
 * glyphs, and the rows render `white-space: pre` in a monospace face, so the text width
 * divided by its length is exactly one cell.
 *
 * This is what makes an overdrawn decoration's width a falsifiable claim rather than a
 * tautology: a glyph that took inline advance would make its element a cell wider than
 * the characters it covers, which no left-edge probe can see. */
export async function cellWidth(page: Page, text: string): Promise<number> {
  const width = await page.evaluate((want) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
      (r) => (r.textContent ?? "") === want,
    );
    if (row == null) return null;
    const range = document.createRange();
    range.selectNodeContents(row);
    return range.getBoundingClientRect().width / want.length;
  }, text);
  if (width === null) throw new Error(`no rendered row reads exactly ${JSON.stringify(text)}`);
  return width;
}

/** The rendered row and gutter-number counts, plus the highest line the rows claim.
 * One number per row and a contiguous 1..N of lines is the epic's standing reflow
 * guard, and the thing a decoration that changed a column width would break first.
 *
 * The high-water line is reported instead of the seeded string's line count because
 * ingest reflows the plan (see `lineOf` above), so the invariant to hold is that the
 * rendered rows tile their own range with no gaps. */
export function gridCounts(
  page: Page,
): Promise<{ rows: number; numbers: number; highestLine: number }> {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const rows = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])];
    return {
      rows: rows.length,
      numbers: (sh?.querySelectorAll("[data-line-number-content]") ?? []).length,
      highestLine: Math.max(...rows.map((r) => Number(r.getAttribute("data-line")))),
    };
  });
}

/** Every run the decoration pass tagged with `attribute`, as the text of the row it
 * sits on, the attribute's value, and the run's own characters.
 *
 * Keyed by row text for the reason `lineOf` gives; reading the run's text back is what
 * makes "the marker columns and nothing else" a claim about the DOM rather than about
 * the emitter's unit test. Takes the attribute so one helper serves every member of the
 * decoration pass — `data-md-list` for the list markers, `data-md-checkbox` for the
 * task checkboxes — rather than each spec growing its own copy. */
export function taggedRuns(
  page: Page,
  attribute: string,
): Promise<{ row: string; value: string; text: string }[]> {
  return page.evaluate((attr) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    return [...(sh?.querySelectorAll(`[data-content] [data-line] [${attr}]`) ?? [])].map((el) => ({
      row: el.closest("[data-line]")?.textContent ?? "",
      value: el.getAttribute(attr) ?? "",
      text: el.textContent ?? "",
    }));
  }, attribute);
}

/** Resolve once the decoration pass has tagged at least one run with `attribute`.
 * The passes run from a MutationObserver a frame behind the rows, so every read
 * of a tagged run waits for one to exist rather than racing the paint. */
export async function awaitTagged(page: Page, attribute: string): Promise<void> {
  await expect.poll(async () => (await taggedRuns(page, attribute)).length).toBeGreaterThan(0);
}

/** Every rendered row's text, for the rows carrying an element tagged `attribute`. */
export function taggedRowTexts(page: Page, attribute: string): Promise<string[]> {
  return page.evaluate((attr) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const rows = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])];
    return rows.filter((r) => r.querySelector(`[${attr}]`)).map((r) => r.textContent ?? "");
  }, attribute);
}

/** Select each named line's full row text and copy it, one at a time, via the
 * shadow root's own `getSelection()` and `execCommand("copy")` — the same
 * serialization a real Ctrl+C takes and Selection.toString() does not, which
 * is the whole point of reading the real clipboard back rather than the DOM
 * selection. Sequential rather than parallel: the system clipboard is shared
 * state, so two copies at once would race each other's read. */
export async function copyRows<K extends string>(
  page: Page,
  lines: Record<K, number>,
): Promise<Record<K, { selection: string; clipboard: string }>> {
  const out = await page.evaluate(
    async (lines: Record<string, number>) => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot as
        | (ShadowRoot & { getSelection?: () => Selection | null })
        | null;
      const read = async (ln: number) => {
        const row = [...(sh?.querySelectorAll("[data-content] [data-line]") ?? [])].find(
          (r) => r.getAttribute("data-line") === String(ln),
        );
        if (sh == null || row == null) return { selection: "", clipboard: "<no row>" };
        const range = document.createRange();
        range.selectNodeContents(row);
        const sel = sh.getSelection?.() ?? getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        document.execCommand("copy");
        return {
          selection: sel?.toString() ?? "",
          clipboard: await navigator.clipboard.readText(),
        };
      };
      const result: Record<string, { selection: string; clipboard: string }> = {};
      for (const [key, ln] of Object.entries(lines)) result[key] = await read(ln);
      return result;
    },
    lines as Record<string, number>,
  );
  return out as Record<K, { selection: string; clipboard: string }>;
}

/** Watch the source view's shadow root for childList mutations, then resolve with the
 * count once it has stopped moving.
 *
 * The claim every decoration pass owes: that the repaint SETTLES. A pass that adds a
 * child to a row another pass then rebuilds — because its own settle check counts that
 * row's children — loops the repaint observer, the runaway EXC-870 measured at ~10,800
 * mutations in two seconds with an image. Every pass since has had to show its own zero.
 *
 * Settling is asserted by polling for the counter to STOP moving rather than by sampling
 * a fixed window: auto-retrying is the suite's timing discipline (`waitForTimeout` is
 * banned outright by `test/structure/e2e-conventions.test.ts`), and it is the stronger
 * claim of the two — a loop never yields two equal readings, so this fails on churn of
 * any rate rather than only on churn above some threshold.
 *
 * Call it directly after the plan opens: the count runs from the moment the observer is
 * installed, so anything the passes did before that is invisible to it. That is the one
 * limitation to know — this proves the view reaches rest and stays there, not that the
 * first paint was free. */
export async function settledMutations(page: Page): Promise<number> {
  await page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const w = window as unknown as { __mutations: number };
    w.__mutations = 0;
    new MutationObserver((records) => {
      w.__mutations += records.length;
    }).observe(sh as unknown as Node, { childList: true, subtree: true });
  });
  const read = () =>
    page.evaluate(() => (window as unknown as { __mutations: number }).__mutations);
  let previous = -1;
  await expect
    .poll(async () => {
      const now = await read();
      const unchanged = now === previous;
      previous = now;
      return unchanged;
    })
    .toBe(true);
  return read();
}

/** Viewport-px centre of a 1-based line's number cell in the gutter column — the
 * library's own `data-line-index` / `data-line-number-content` pairing, the same
 * contract `lineCenterY` resolves. */
export async function gutterCellCenter(
  page: Page,
  line: number,
): Promise<{ x: number; y: number }> {
  const pt = await page.evaluate((ln) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const span = [...(sh?.querySelectorAll("[data-line-number-content]") ?? [])].find(
      (s) => (s.parentElement as HTMLElement)?.dataset.lineIndex === String(ln - 1),
    );
    const r = (span?.parentElement as HTMLElement)?.getBoundingClientRect();
    return r ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  }, line);
  if (pt === null) throw new Error(`gutter cell for line ${line} not found`);
  return pt;
}

/** Select a line span by dragging down the line-number column from `startLine`
 * to `endLine` — the library's line-selection gesture. A stepped real-mouse drag
 * grows the selection row by row; the gutter `+` then reports that range. */
export async function selectGutterRange(
  page: Page,
  startLine: number,
  endLine: number,
): Promise<void> {
  const start = await gutterCellCenter(page, startLine);
  const end = await gutterCellCenter(page, endLine);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up();
}

/** Reveal the gutter `+` on `line` by moving the mouse over its left edge. The
 * source view's gutter sits at the left of the plan surface — so
 * anchor the hover to that container's left edge rather than the viewport's,
 * which keeps working wherever the pane sits. The 6px inset lands inside the
 * gutter column without reaching the line-number cell. */
export async function revealGutterPlus(page: Page, line: number): Promise<Locator> {
  const y = await lineCenterY(page, line);
  const x = await page.locator(PLAN_SURFACE).evaluate((el) => el.getBoundingClientRect().x + 6);
  await page.mouse.move(x, y);
  const plus = page.locator(".diffview [data-utility-button]");
  await expect(plus).toBeVisible();
  return plus;
}

/** Scroll the plan to any heading through the breadcrumbs bar's flat filter — the
 * surface that replaced the contents rail (EXC-949), and the only one that reaches
 * an arbitrary heading in one step. Several specs arrange a reading position this
 * way, so the gesture lives here rather than being re-derived per spec.
 *
 * Two waits are load-bearing rather than defensive. Safe mode guards keydown on
 * `window` in the CAPTURE phase and calls stopImmediatePropagation, so a `/` inside
 * its grace never reaches the menu's own handler and the filter silently never
 * opens. And `/` is handled on the menu's Content element, so it only lands once
 * bits-ui's open-auto-focus has moved focus inside the portalled panel — waiting for
 * the panel makes a miss fail here instead of 30s later on the query field.
 *
 * The query is filled rather than typed, and Enter from the field selects the first
 * result, so callers pass a heading whose text is unique within the plan.
 *
 * A third wait closes the gesture: Enter commits, but the menu it opened is still
 * playing its exit, and bits-ui's portal presence unmounts on that animation's end.
 * A caller that drives the bar again inside that window strands the surface — so the
 * helper returns only once the menu is GONE, making "jumped" mean the whole gesture
 * finished rather than that the keystroke was delivered. Waiting here rather than in
 * each caller matters because the window is invisible from the call site, and it
 * closed on its own for as long as the jump's scroll outlasted it (EXC-1092 shortened
 * that scroll to 180ms, which is how the race surfaced).
 *
 * One thing this does NOT wait out: a jump that shortens the trail leaves the departing
 * crumb in the bar for --dur-exit while it animates away (EXC-1123), and that crumb keeps
 * its aria-current, so `currentCrumb` resolves to two nodes for those 140ms and a second
 * jump inside the window would trip strict mode. Every caller today is incidentally safe
 * because each shortening is followed by an exact `toHaveText([…])` that cannot pass until
 * the ghost is gone. A new spec that jumps twice in a row should settle the trail between
 * them the same way. */
export async function jumpToHeading(page: Page, heading: string): Promise<void> {
  await waitPastSafeModeGrace(page);
  await currentCrumb(page).click();
  await expect(page.locator("[data-slot='dropdown-menu-content']")).toBeVisible();
  await page.keyboard.press("/");
  await page.locator("input[aria-label='Filter headings']").fill(heading);
  await page.keyboard.press("Enter");
  await expect(page.locator("[data-slot='dropdown-menu-content']")).toHaveCount(0);
}

/** Open the gutter composer on `line` (3 by default) and return its editor,
 * focused. Two specs compose feedback against a seeded project (file-completion,
 * ref-chips) and both need exactly this preamble, so it lives here rather than
 * being copied — the dialog's accessible name and the field's are production's
 * own strings, and a spec-side copy is a second place for them to drift. */
export async function composer(page: Page, line = 3): Promise<Locator> {
  await (await revealGutterPlus(page, line)).click();
  const dialog = page.getByRole("dialog", { name: "Add a comment" });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole("textbox", { name: "Comment" });
  await input.click();
  await expect(input).toBeFocused();
  return input;
}

/** Paint `value` — a custom-property name (leading `--`) or any CSS color — onto a
 * throwaway span inside the diff shadow root and read back its resolved color.
 * Measured rather than transcribed: reading an untyped custom property straight off the
 * sheet hands back its source text (e.g. a `color-mix()` expression) rather than the
 * color it resolves to, so a palette spec asserting the derived value probes it the
 * same way the browser paints it. */
export async function probeColor(page: Page, value: string): Promise<string> {
  return page.evaluate((v) => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const el = document.createElement("span");
    el.style.color = v.startsWith("--") ? `var(${v})` : v;
    sh?.appendChild(el);
    const resolved = getComputedStyle(el).color;
    el.remove();
    return resolved;
  }, value);
}

/** Fill an open composer, submit it, and return the saved card once the composer is
 * gone — the commit half of the composer lifecycle: type the comment, click Comment,
 * and land on the annotation card it left behind. */
export async function submitComposer(composer: Locator, text: string): Promise<Locator> {
  await composer.getByRole("textbox", { name: "Comment" }).fill(text);
  await composer.getByRole("button", { name: "Comment" }).click();
  await expect(composer).toHaveCount(0);
  const card = composer.page().locator("[data-annotation-card]");
  await expect(card).toBeVisible();
  return card;
}

/**
 * Assert no comment composer opened — for a gesture that opens something else instead
 * (a file preview, a new tab) and must not also trigger the row's own comment
 * affordance.
 *
 * The 300ms clock wait is one of the dishonest sleeps browser-testing.md § Timing
 * discipline keeps as a standing finding, not a sanctioned idiom: nothing in `ui/`
 * holds a deadline at that number, so it is `page.waitForTimeout` with extra steps.
 * It sits here because three specs need the same negative; that shares the sleep, it
 * does not license a fourth. Replacing it needs a signal for "the composer was never
 * going to open" — the pointer pipeline publishes none today.
 */
export async function expectNoComposerOpens(page: Page): Promise<void> {
  const composer = page.getByRole("dialog", { name: "Add a comment" });
  const t0 = await page.evaluate(() => performance.now());
  await page.waitForFunction((t) => performance.now() > t + 300, t0);
  await expect(composer).toHaveCount(0);
}
