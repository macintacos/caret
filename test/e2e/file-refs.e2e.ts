// Filename references in the plan (EXC-687, click-to-open since EXC-840). The
// plan renders as markdown source through @pierre/diffs; a path-shaped token
// that resolves to a real file in the review's cwd gets a file icon (its token
// tagged data-file-ref in the shadow root) and a hover highlight, and CLICKING
// it opens a syntax-highlighted excerpt popover — hovering alone never does.
// A path written as a markdown link's target counts as a reference too
// (EXC-954), which is what the link spec below covers.
// The popover is a click-opened card that stays put: moving the pointer away
// never dismisses it (EXC-840 dropped EXC-799's hover-intent tracker); it closes
// only on Escape or a click outside it, and that dismissing click is swallowed so
// it doesn't also do its normal thing (open a line comment). Reading past the
// opening window costs no click either: scrolling near an end of the code region
// loads the next chunk toward it (EXC-969), which needs real layout and so lives
// here — as does reaching the same ends from the keyboard (EXC-972), which needs
// a tab order and native key scrolling besides. The resolve + read + shadow-DOM
// token tagging + real hover/click only
// exist in a browser against a real daemon reading a real cwd, so they are
// exercised here too; the pure detection, resolution, and excerpt math stay
// units (fileRefs / fileRefTag / plan-files / api tests).
//
// The daemon is a real subprocess reading the local filesystem, so each test
// writes a synthetic project dir and seeds a review whose cwd points at it. The
// content is throwaway, non-identifying scaffolding — never a real plan.

import { fileRefCount, makeProject, settleDrawer } from "@test/e2e/support/file-refs.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { OVERSCAN_ROWS } from "@ui/src/lib/previewWindow.ts";
import { MAX_EXCERPT_BYTES } from "@/plan/excerpt.ts";

// A 300-line source file with unique markers on lines 1, 42, and 150, so a
// preview can be told apart as "head" vs "centered on :42" and a window's reach
// can be pinned from either end. It must stay comfortably longer than the widest
// opening window (EXCERPT_HEAD_LINES = 60, EXCERPT_RADIUS = 30) — a file that
// fits in one window would leave every framing assertion below vacuous, and
// leave the scroll-loading specs with nothing to load.
const CACHE_TS_LINES = 300;
const CACHE_TS = Array.from({ length: CACHE_TS_LINES }, (_, i) => {
  const n = i + 1;
  if (n === 1) return "// MARKER_LINE_ONE — top of the file";
  if (n === 42) return 'const cacheKey = "MARKER_LINE_FORTYTWO"; // line 42';
  if (n === 150) return 'const deepKey = "MARKER_LINE_DEEP"; // line 150';
  return `const line${n} = ${n};`;
}).join("\n");

/** Where the cited (`.fp-target`) row sits inside the preview's scrolling code
 * region, plus the region's own scroll state — the geometry both scroll specs
 * below read. Null when no preview or no cited row is on screen. */
function citedRowInRegion(page: import("@playwright/test").Page): Promise<{
  offset: number;
  region: number;
  row: number;
  scrollTop: number;
} | null> {
  return page.evaluate(() => {
    const code = document.querySelector("[data-file-preview] .fp-code");
    const row = document.querySelector("[data-file-preview] .fp-target");
    if (code === null || row === null) return null;
    const c = code.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    return {
      offset: r.top - c.top,
      region: c.height,
      row: r.height,
      scrollTop: (code as HTMLElement).scrollTop,
    };
  });
}

/** Scroll the preview's code region to one of its ends, the way a reader
 * arrives at a boundary. A wheel gesture emits many scroll events; one
 * assignment plus the event it fires carries the same signal, and the
 * auto-loader is single-flight either way. */
function scrollRegion(page: import("@playwright/test").Page, to: "top" | "bottom"): Promise<void> {
  return page.evaluate((edge) => {
    const code = document.querySelector("[data-file-preview] .fp-code") as HTMLElement | null;
    if (code !== null) code.scrollTop = edge === "top" ? 0 : code.scrollHeight;
  }, to);
}

/** Assert the cited row is fully on screen within the code region — neither
 * scrolled off the top nor left below the fold. */
function expectCitedRowVisible(m: Awaited<ReturnType<typeof citedRowInRegion>>): void {
  expect(m).not.toBeNull();
  expect(m?.offset ?? -1).toBeGreaterThanOrEqual(0);
  expect(m?.offset ?? Infinity).toBeLessThanOrEqual((m?.region ?? 0) - (m?.row ?? 0));
}

/**
 * What the preview's code region actually holds, optionally after scrolling it
 * to `scrollTo` first. Rows are windowed (EXC-970), so the DOM holds a screenful
 * whatever the loaded region's size — which makes "how many rows" and "which
 * rows" two different questions, both asked here. The scroll and the read happen
 * in one round trip, one frame apart, so a window that lags a jump shows up as a
 * gap rather than being papered over by the round trip's own latency.
 */
function renderedRows(
  page: import("@playwright/test").Page,
  scrollTo?: number,
): Promise<{
  rows: { num: number; text: string }[];
  count: number;
  first: number | null;
  last: number | null;
  rowHeight: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  coversRegion: boolean;
} | null> {
  return page.evaluate(async (top) => {
    const code = document.querySelector<HTMLElement>("[data-file-preview] .fp-code");
    if (code === null) return null;
    if (top !== undefined) {
      code.scrollTop = top;
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    const rows = [...code.querySelectorAll<HTMLElement>(".fp-row")].map((r) => ({
      num: Number(r.querySelector(".fp-lnum")?.textContent?.trim()),
      text: r.querySelector(".fp-lcode")?.textContent ?? "",
    }));
    const region = code.getBoundingClientRect();
    const head = code.querySelector(".fp-row")?.getBoundingClientRect();
    const tail = [...code.querySelectorAll(".fp-row")].at(-1)?.getBoundingClientRect();
    const rowHeight = head?.height ?? 0;
    return {
      rows,
      count: rows.length,
      first: rows[0]?.num ?? null,
      last: rows.at(-1)?.num ?? null,
      rowHeight,
      scrollHeight: code.scrollHeight,
      scrollWidth: code.scrollWidth,
      clientHeight: code.clientHeight,
      // No blank band: the mounted rows reach both edges of the region, give or
      // take the region's own vertical padding at the very top and bottom.
      coversRegion:
        (head?.top ?? Infinity) <= region.top + rowHeight &&
        (tail?.bottom ?? -Infinity) >= region.bottom - rowHeight,
    };
  }, scrollTo);
}

/** Every mounted row carries the fixture's line for its own number. A window
 * that mounted the wrong slice still renders the right *count* of rows, so this
 * is the assertion that tells a working window from a plausible-looking one. */
function expectRowsAreTheirLines(probe: Awaited<ReturnType<typeof renderedRows>>): void {
  const source = CACHE_TS.split("\n");
  expect(probe?.rows.filter((r) => r.text !== source[r.num - 1])).toEqual([]);
}

test("marks only references that resolve to a real file", async ({ daemon, page }) => {
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    // One real reference (src/cache.ts) and one that does not exist (src/ghost.ts).
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nEdit `src/cache.ts` to fix it.\n\nThe helper `src/ghost.ts` is missing.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();

    // The real reference gets exactly one icon once the daemon confirms it; the
    // missing one never does, so the count settles at 1 (not 2).
    await expect.poll(() => fileRefCount(page)).toBe(1);

    // Hovering a resolved reference reveals no preview — for an inline-code
    // reference like this one hover is highlight-only (EXC-840); the preview
    // waits for a click. Give the pointer pipeline a beat, then assert nothing
    // appeared.
    await page.locator("[data-file-ref]").first().hover();
    const t0 = await page.evaluate(() => performance.now());
    await page.waitForFunction((t) => performance.now() > t + 300, t0);
    await expect(page.locator("[data-file-preview]")).toHaveCount(0);

    // The hover affordance is the highlight itself: with the pointer parked on
    // the token, the real :hover state paints the background wash, and the token
    // carries the pointer cursor signalling it is clickable.
    const style = await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const tok = sh?.querySelector("[data-file-ref]");
      if (!tok) return null;
      const cs = getComputedStyle(tok);
      return { background: cs.backgroundColor, cursor: cs.cursor };
    });
    expect(style?.cursor).toBe("pointer");
    expect(style?.background).not.toBe("rgba(0, 0, 0, 0)");
  } finally {
    await proj.cleanup();
  }
});

// EXC-896: tagging depends on shiki emitting the opening backtick as a token of its
// own, which only holds while the backtick and the path resolve to different colors.
// A vendor palette highlights with that vendor's published theme, where the two are
// the same color, so caret appends a rule that keeps them apart. Without it the icon,
// the pointer cursor, and the hover wash all vanish under those seven palettes while
// the click target survives — a failure shape no color assertion can see.
test("marks references under a vendor palette too", async ({ daemon, page }) => {
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await page.addInitScript(() => {
      localStorage.setItem("caret.theme.mode", "dark");
      localStorage.setItem("caret.theme.dark", "dracula");
    });
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nEdit `src/cache.ts` to fix it.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("style", /--paper:\s*#21222c/i);

    await expect.poll(() => fileRefCount(page)).toBe(1);

    await page.locator("[data-file-ref]").first().hover();
    const style = await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const tok = sh?.querySelector("[data-file-ref]");
      if (!tok) return null;
      const cs = getComputedStyle(tok);
      return { background: cs.backgroundColor, cursor: cs.cursor };
    });
    expect(style?.cursor).toBe("pointer");
    expect(style?.background).not.toBe("rgba(0, 0, 0, 0)");
  } finally {
    await proj.cleanup();
  }
});

test("marks a markdown link whose target is a file, exactly once", async ({ daemon, page }) => {
  // EXC-954: a `[label](path)` link renders as a file reference rather than
  // literal link syntax. What the glyph can attach to is a property of shiki's
  // real token boundaries, so it is only observable here.
  //
  // A backticked-path label — `` [`src/other.ts`](src/other.ts) ``, the citation
  // shape this repo's own plans use — keeps its backticks in the display text, so
  // the path is still its own token and takes the glyph. It is also the shape
  // where BOTH decoration paths fire: the link layer emits over the whole label
  // and the inline-code scan finds the path inside it, so it is the one that
  // could draw two glyphs.
  //
  // A bare-path label collapses into ordinary prose, which shiki emits as one
  // coarse token running to the end of the line. tagFileRefTokens refuses it —
  // the glyph and its hover chip would wrap the whole sentence — so that shape
  // is clickable without being marked. Both halves are asserted below.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS, "src/other.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: [
        "# Refs",
        "",
        "[src/cache.ts](src/cache.ts) holds the key.",
        "",
        "[`src/other.ts`](src/other.ts) is where it lives.",
        "",
        "[a ghost](src/ghost.md) does not exist.",
        "",
      ].join("\n"),
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();

    // One glyph: the backticked label's. Not 2 — the bare-path label has no token
    // to take it. Not 0 — the backticked label must still decorate. Not 3 — the
    // link to a missing file never does.
    await expect.poll(() => fileRefCount(page)).toBe(1);

    // And it sits on the path alone. This is the assertion the count cannot make:
    // a glyph drawn around the entire sentence would still count as one.
    const tagged = await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
      return sh?.querySelector("[data-file-ref]")?.textContent ?? null;
    });
    expect(tagged).toBe("src/other.ts");

    // The collision-merged span is clickable, not merely visible — and the two
    // links point at different files, so the preview's content is what proves
    // which span was clicked.
    await page.locator("[data-file-ref]").click();
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("src/other.ts");

    // The unmarked bare-path label still opens its own file on click: it lost the
    // glyph, not the affordance.
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await page.locator(".diffview").getByText("holds the key.", { exact: false }).click();
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("src/cache.ts");
  } finally {
    await proj.cleanup();
  }
});

test("clicking a real reference reveals a highlighted excerpt centered on its line", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe cache key lives in `src/cache.ts:42` today.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();

    // Wait for the icon (async resolve), then click the tagged token.
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    // The preview appears (light DOM, not the shadow root) with the resolved path
    // and a window centered on line 42 — so the line-42 marker shows and the
    // line-1 marker (outside the ±30 window) does not.
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("src/cache.ts");
    await expect(preview).toContainText("MARKER_LINE_FORTYTWO");
    await expect(preview).not.toContainText("MARKER_LINE_ONE");

    // The excerpt is syntax-highlighted, not plain: shiki colors tokens, one line
    // per numbered row (not one undivided block).
    await expect(preview.locator('.fp-lcode span[style*="color"]').first()).toBeVisible();

    // The window centers on line 42 (±EXCERPT_RADIUS = 30) → lines 12–72 of the
    // 300-line file, and the header frames that slice. It stays that window until
    // the reader scrolls: proximity loads (EXC-969), but opening a preview is not
    // a gesture, so nothing has arrived yet. The header is what names the loaded
    // region — the gutter names only the mounted rows, which is a narrower set
    // once the panel has scrolled to the cited line (EXC-970).
    await expect(preview.locator(".fp-range")).toHaveText(`lines 12–72 of ${CACHE_TS_LINES}`);
    // And there is nothing at either boundary to click — the strips are gone,
    // so a reintroduced one fails here rather than only looking wrong.
    await expect(preview.locator("button")).toHaveCount(0);

    // The referenced line itself (42) is the one highlighted, so the eye lands on it.
    await expect(preview.locator(".fp-target")).toHaveCount(1);
    await expect(preview.locator(".fp-target .fp-lnum")).toHaveText("42");

    // The header names the way out — an "esc to close" chip carrying the esc keycap.
    const hint = preview.locator(".fp-hint");
    await expect(hint).toContainText("close");
    await expect(hint.locator("[data-slot='kbd']")).toContainText("esc");

    // Moving the pointer away does NOT dismiss it — the card is a click-opened
    // popover that stays put (EXC-840 dropped the hover-intent tracker). Park the
    // pointer far off, give the pointer pipeline a beat, and it is still open.
    await page.mouse.move(0, 0);
    const t1 = await page.evaluate(() => performance.now());
    await page.waitForFunction((t) => performance.now() > t + 300, t1);
    await expect(preview).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("the preview omits the esc-to-close hint when shortcut hints are off", async ({
  daemon,
  page,
}) => {
  // The "esc to close" chip is a shortcut-hint affordance, so it follows the same
  // Settings toggle as the rest of them (showShortcutHints): off means the header
  // shows the path and range but no keycap hint. Escape still closes the preview —
  // only the visible hint is gated, not the behavior.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe cache key lives in `src/cache.ts:42` today.\n",
    });
    await page.addInitScript(() => localStorage.setItem("caret.shortcutHints", "off"));
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();

    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("src/cache.ts");
    // The header renders, but with no esc-to-close hint.
    await expect(preview.locator(".fp-hint")).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("clicking outside the preview dismisses it, swallowing that first click", async ({
  daemon,
  page,
}) => {
  // The preview is a click-opened popover: a click anywhere outside it closes it,
  // and — since it took a click to open — that first outside click is SWALLOWED
  // (EXC-840). So clicking a plan line while the preview is open only dismisses the
  // preview; it does NOT also open that line's comment composer. A second click
  // then opens the composer as usual, proving only the first click was consumed.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      // A reference line to open the preview from, and a plain prose line with no
      // reference — so a click on it can only mean "comment on this line".
      plan: "# Refs\n\nThe cache key lives in `src/cache.ts:42` today.\n\nJust some plain prose here.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();

    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();

    // First click on the plain line: the preview dismisses…
    const proseLine = page.locator(".diffview").getByText("Just some plain prose here.", {
      exact: false,
    });
    await proseLine.click();
    await expect(preview).toHaveCount(0);

    // …and that click was swallowed, so no composer opened. No positive event to
    // await, so give the pipeline a beat then assert it stayed shut.
    const composer = page.getByRole("dialog", { name: "Add a comment" });
    const t0 = await page.evaluate(() => performance.now());
    await page.waitForFunction((t) => performance.now() > t + 300, t0);
    await expect(composer).toHaveCount(0);

    // With the preview gone, a second click on the same line opens the composer
    // normally — the swallow was one-shot, tied to the open preview.
    await proseLine.click();
    await expect(composer).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("pressing Escape dismisses the open preview", async ({ daemon, page }) => {
  // Escape is the keyboard escape hatch out of the preview (EXC-840): while it is
  // open, one Escape closes it. The pointer stays parked on the token, and pointer
  // movement no longer dismisses, so Escape is the only thing that closes it here.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe cache key lives in `src/cache.ts:42` today.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();

    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();

    // Retry Escape until it lands: right after the view gains focus, Safe Mode
    // (safeMode.ts) swallows keystrokes for a short window, so a single immediate
    // press can be eaten. toPass polls the web-first assertion — no fixed sleep.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(preview).toHaveCount(0, { timeout: 500 });
    }).toPass({ timeout: 5_000 });
  } finally {
    await proj.cleanup();
  }
});

test("the preview fills its lane and pages inside itself", async ({ daemon, page }) => {
  // The opening window is large enough to judge a plan against (EXC-756), so
  // against a big file the excerpt has more rows — and longer lines — than the
  // lane can show, and pages inside .fp-code in BOTH axes rather than stretching
  // the panel. That matters because scrolling that region is now the only way to
  // reach the rest of the file, and a line clipped instead of scrolled would be
  // unreadable with no way to reach it. Lines are realistic source width, not
  // `const lineN = N;` — a file of stubs would never overflow the lane at all.
  const BIG = Array.from(
    { length: 400 },
    (_, i) =>
      `export const configuredThresholdForLine${i + 1} = { attempts: ${i + 1}, backoffMs: ${(i + 1) * 25}, label: "line ${i + 1}" };`,
  ).join("\n");
  const proj = await makeProject({ "src/big.ts": BIG });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nOpen `src/big.ts` to see it.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(1);

    await page.locator("[data-file-ref]").first().click();
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    // Measure at the lane's settled size, not part-way through its opening wipe.
    await settleDrawer(page);

    // The whole 60-line opening window is loaded, not a handful of lines. How
    // many of those rows are mounted is the window's business (EXC-970); what
    // this spec is about is that the panel pages them inside its own lane.
    await expect(preview.locator(".fp-range")).toHaveText("lines 1–60 of 400");

    const geometry = await page.evaluate(() => {
      const panel = document.querySelector("[data-file-preview]") as HTMLElement | null;
      const lane = document.querySelector("[data-file-drawer]") as HTMLElement | null;
      const code = document.querySelector("[data-file-preview] .fp-code") as HTMLElement | null;
      if (panel === null || lane === null || code === null) return null;
      const p = panel.getBoundingClientRect();
      const l = lane.getBoundingClientRect();
      return {
        overflowX: getComputedStyle(code).overflowX,
        overflowY: getComputedStyle(code).overflowY,
        scrollHeight: code.scrollHeight,
        clientHeight: code.clientHeight,
        codeScrollWidth: code.scrollWidth,
        codeClientWidth: code.clientWidth,
        // How far the panel's edges sit inside the lane's, on each side.
        insetLeft: p.left - l.left,
        insetRight: l.right - p.right,
        insetTop: p.top - l.top,
        insetBottom: l.bottom - p.bottom,
      };
    });
    expect(geometry).not.toBeNull();
    // The code region is the scroller, and it has more to show than it can fit.
    expect(geometry?.overflowY).toBe("auto");
    expect(geometry?.scrollHeight ?? 0).toBeGreaterThan(geometry?.clientHeight ?? 0);
    // The panel fills its lane: every edge sits within a pixel or two of the
    // lane's — the hairline separator and sub-pixel rounding — rather than being
    // inset by a margin or a corner radius. So the header stays reachable at the
    // lane's own edge instead of floating inside it.
    for (const inset of [
      geometry?.insetLeft,
      geometry?.insetRight,
      geometry?.insetTop,
      geometry?.insetBottom,
    ]) {
      expect(Math.abs(inset ?? Infinity)).toBeLessThanOrEqual(2);
    }
    // A source line wider than the lane stays reachable: the region scrolls
    // sideways to it rather than truncating it. The lane trades the old card's
    // ability to grow to the line for taking layout space instead, so how much
    // of a long line shows at once is the reader's call — they widen the lane
    // with the handle, or scroll here.
    expect(geometry?.overflowX).toBe("auto");
    expect(geometry?.codeScrollWidth ?? 0).toBeGreaterThan(geometry?.codeClientWidth ?? Infinity);

    // The header still announces the remainder; reaching it is a scroll away.
    await expect(preview.locator(".fp-range")).toHaveText("lines 1–60 of 400");
  } finally {
    await proj.cleanup();
  }
});

test("scrolling walks the preview to both ends of the file", async ({ daemon, page }) => {
  // The core of EXC-969: a reader who needs more than the opening window gets it
  // by reading on. Scrolling to a boundary loads the next chunk toward it, over
  // and over, until that end of the file is on screen — no click anywhere.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe cache key lives in `src/cache.ts:42` today.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await settleDrawer(page);
    await expect(preview.locator("button")).toHaveCount(0);

    // Walk upward until the region starts at line 1. One scroll per attempt,
    // retried — a scroll landing while the previous chunk is still in flight is
    // deliberately dropped, so the walk is poll-shaped rather than a fixed burst.
    await expect(async () => {
      await scrollRegion(page, "top");
      await expect(preview.locator(".fp-lnum").first()).toHaveText("1", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(preview).toContainText("MARKER_LINE_ONE");

    // Then downward until it ends at the last line: the whole file has been
    // reached without leaving the review, and without anything to click.
    await expect(async () => {
      await scrollRegion(page, "bottom");
      await expect(preview.locator(".fp-lnum").last()).toHaveText(String(CACHE_TS_LINES), {
        timeout: 1_000,
      });
    }).toPass({ timeout: 20_000 });
    // Every line is loaded, so the header stops framing a slice — while the DOM
    // holds only the rows around the offset (EXC-970), which is what the
    // windowing spec below measures.
    await expect(preview.locator(".fp-range")).toHaveText(`${CACHE_TS_LINES} lines`);
    // The middle of the file came along with the walk, rather than the region
    // having skipped to its end: scroll back to line 150 and its marker is there.
    // Mounted only while the reader is there, which is the point of windowing.
    const walked = await renderedRows(page, 0);
    await renderedRows(page, 149 * (walked?.rowHeight ?? 0));
    await expect(preview).toContainText("MARKER_LINE_DEEP");
  } finally {
    await proj.cleanup();
  }
});

test("a keyboard reader walks the preview to both ends with no pointer", async ({
  daemon,
  page,
}) => {
  // EXC-972. EXC-969 tied reading on to a scroll gesture and dropped the
  // boundary strips with it, which took the panel's only focusable control:
  // Chrome and Safari keep a plain overflow:auto div out of the tab order, so a
  // keyboard reader could open the preview and then reach none of the file past
  // its opening window. A tab order, a focus ring, and native key scrolling only
  // exist in a real browser, so this is the only layer that can tell whether the
  // fix works — and with rows windowed (EXC-970) it is also the only layer where
  // the rows a key press reaches are the ones a reader would see. Everything
  // after the opening click below is keys: no wheel, no scrollTop assignment.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe cache key lives in `src/cache.ts:42` today.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await settleDrawer(page);

    // A named landmark, so the stop announces what it holds rather than landing
    // the reader on an anonymous box.
    await expect(page.getByRole("region", { name: "Contents of src/cache.ts" })).toBeVisible();

    // Tab until focus lands on it. The claim is that it is IN the tab order, so
    // the stops are walked rather than the element focused directly — and the
    // plan behind the drawer must hold still while that happens, the same hazard
    // that made the centring effect use scrollTop over scrollIntoView.
    const planScrollTop = () =>
      page.evaluate(() => document.querySelector(".diff-plan")?.scrollTop ?? -1);
    let planBeforeTab = -1;
    let focused = false;
    for (let i = 0; i < 40 && !focused; i++) {
      planBeforeTab = await planScrollTop();
      await page.keyboard.press("Tab");
      focused = await page.evaluate(
        () => document.activeElement?.classList.contains("fp-code") ?? false,
      );
    }
    expect(focused).toBe(true);
    expect(await planScrollTop()).toBe(planBeforeTab);

    // The app's own focus ring, inset: the lane clips the panel and the region
    // runs flush to its edges, so an outset ring would be cut off on three sides.
    const ring = await preview.locator(".fp-code").evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        focusVisible: el.matches(":focus-visible"),
        style: cs.outlineStyle,
        width: Number.parseFloat(cs.outlineWidth),
        offset: cs.outlineOffset,
      };
    });
    expect(ring.focusVisible).toBe(true);
    expect(ring.style).not.toBe("none");
    expect(ring.width).toBeGreaterThan(0);
    expect(ring.offset).toBe("-2px");

    // End walks down a chunk at a time — each press scrolls the region, and that
    // scroll loads the next chunk exactly as a wheel notch would — until the
    // file's last line is the one under the reader.
    await expect(async () => {
      await page.keyboard.press("End");
      await expect(preview.locator(".fp-lnum").last()).toHaveText(String(CACHE_TS_LINES), {
        timeout: 1_000,
      });
    }).toPass({ timeout: 20_000 });

    // …and Home walks back up to the first, so the whole file is reachable from
    // the keyboard alone. Focus never left the region to do either.
    await expect(async () => {
      await page.keyboard.press("Home");
      await expect(preview.locator(".fp-lnum").first()).toHaveText("1", { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(preview).toContainText("MARKER_LINE_ONE");
    expect(
      await page.evaluate(() => document.activeElement?.classList.contains("fp-code") ?? false),
    ).toBe(true);

    // The header frames the whole file now, through the live region a screen
    // reader hears that growth in — the rows themselves are windowed, so they
    // are the wrong thing to announce.
    await expect(preview.locator(".fp-range")).toHaveText(`${CACHE_TS_LINES} lines`);
    await expect(preview.locator(".fp-range")).toHaveAttribute("role", "status");
    // And nothing was put back at the boundaries to achieve any of it.
    await expect(preview.locator("button")).toHaveCount(0);

    // Escape still closes the preview from inside the region, where focus sits.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(preview).toHaveCount(0, { timeout: 500 });
    }).toPass({ timeout: 5_000 });
  } finally {
    await proj.cleanup();
  }
});

test("a fully loaded preview keeps only a screenful of rows in the DOM", async ({
  daemon,
  page,
}) => {
  // EXC-970: the loaded region grows a chunk at a time and can end up holding a
  // whole file, so the DOM is what a large file costs. Only the rows near the
  // viewport are mounted; two spacers carry the rest of the height. The claims
  // that need a real layout engine — that the count stays flat, that the mounted
  // rows are the ones the offset calls for, and that a jump leaves no blank band
  // — can only be made here.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nOpen `src/cache.ts` here.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await settleDrawer(page);

    // Reading to the end is what loads the file (EXC-969), so walking it is a
    // repeated scroll rather than a click; it settles once nothing is left below.
    await expect(async () => {
      await scrollRegion(page, "bottom");
      await expect(preview.locator(".fp-range")).toHaveText(`${CACHE_TS_LINES} lines`, {
        timeout: 1_000,
      });
    }).toPass({ timeout: 30_000 });

    const top = await renderedRows(page, 0);
    expect(top).not.toBeNull();
    const rowHeight = top?.rowHeight ?? 0;
    expect(rowHeight).toBeGreaterThan(0);

    // The whole file is loaded, and the DOM holds a screenful of it — not 300
    // rows. What bounds the count is the region's own height, never how much of
    // the file sits behind it: the rows the viewport covers, the one straddling
    // its bottom edge, and the overscan at whichever ends have rows beyond them.
    const screenful = Math.ceil((top?.clientHeight ?? 0) / rowHeight);
    const ceiling = screenful + OVERSCAN_ROWS * 2 + 2;
    expect(ceiling).toBeLessThan(CACHE_TS_LINES / 2);
    const expectScreenful = (probe: Awaited<ReturnType<typeof renderedRows>>) => {
      expect(probe?.count ?? 0).toBeGreaterThanOrEqual(screenful);
      expect(probe?.count ?? Infinity).toBeLessThanOrEqual(ceiling);
    };
    expectScreenful(top);
    // …while the scrollbar still measures the whole file: the spacers carry the
    // height of every row that is not mounted, so every line is still as far
    // down the region as it would be with all 300 mounted. The slack above is
    // the region's own vertical padding and sub-pixel rounding, not a row.
    expect(top?.scrollHeight ?? 0).toBeGreaterThanOrEqual(CACHE_TS_LINES * rowHeight);
    expect(top?.scrollHeight ?? 0).toBeLessThan((CACHE_TS_LINES + 2) * rowHeight);
    expect(top?.first).toBe(1);
    expectRowsAreTheirLines(top);
    expect(top?.coversRegion).toBe(true);
    await expect(preview).toContainText("MARKER_LINE_ONE");

    // Mid-file: the mounted slice tracks the offset rather than staying at the
    // head, the count holds steady, and every row still matches its own number.
    const middleTop = 149 * rowHeight;
    const middle = await renderedRows(page, middleTop);
    expectScreenful(middle);
    expect(middle?.first ?? 0).toBeGreaterThan(1);
    expect(middle?.first ?? Infinity).toBeLessThanOrEqual(150);
    expect(middle?.last ?? 0).toBeGreaterThanOrEqual(150);
    expectRowsAreTheirLines(middle);
    expect(middle?.coversRegion).toBe(true);
    await expect(preview).toContainText("MARKER_LINE_DEEP");
    // The head is genuinely gone from the DOM, not merely scrolled off.
    await expect(preview).not.toContainText("MARKER_LINE_ONE");

    // A jump straight to the end — the fast-scroll case — lands on the last row
    // with the region still covered, so there is no band waiting on a render.
    const end = await renderedRows(page, (top?.scrollHeight ?? 0) - (top?.clientHeight ?? 0));
    expect(end?.last).toBe(CACHE_TS_LINES);
    expectScreenful(end);
    expectRowsAreTheirLines(end);
    expect(end?.coversRegion).toBe(true);

    // The horizontal range is the widest *loaded* line's, not the widest mounted
    // one's — the file's longest line is line 42, which only the first of these
    // three positions mounts. Were the range to follow the mounted rows, a
    // reader scrolled right on a long line would be dragged back toward column
    // one the moment that line scrolled out of the window.
    expect(middle?.scrollWidth).toBe(top?.scrollWidth);
    expect(end?.scrollWidth).toBe(top?.scrollWidth);
  } finally {
    await proj.cleanup();
  }
});

test("swapping the reference re-frames the panel from the new file's first line", async ({
  daemon,
  page,
}) => {
  // A click on another filename passes through the dismissal handler untouched,
  // so the drawer swaps contents on that same click and FilePreview keeps its
  // instance. The scroll offset the window reads is component state, and the
  // fresh `.fp-code` it is read against is back at zero — so an offset carried
  // over from the previous file would window the new one around a row far down
  // it, leaving the reader looking at a spacer where the head should be.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS, "src/other.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nDeep in `src/cache.ts:150`, then `src/other.ts` from the top.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(2);

    // The first reference cites line 150, so opening it scrolls the region.
    await page.locator("[data-file-ref]").first().click();
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await settleDrawer(page);
    await expect(preview.locator(".fp-target .fp-lnum")).toHaveText("150");
    expect((await citedRowInRegion(page))?.scrollTop ?? 0).toBeGreaterThan(0);

    // The second cites no line, so its panel opens at the file's head.
    await page.locator("[data-file-ref]").nth(1).click();
    await expect(preview).toContainText("src/other.ts");
    await expect(preview.locator(".fp-range")).toHaveText(`lines 1–60 of ${CACHE_TS_LINES}`);
    const swapped = await renderedRows(page);
    expect(swapped?.first).toBe(1);
    expect(swapped?.coversRegion).toBe(true);
    expectRowsAreTheirLines(swapped);
    await expect(preview).toContainText("MARKER_LINE_ONE");
  } finally {
    await proj.cleanup();
  }
});

test("loading upward keeps the reader's line in view", async ({ daemon, page }) => {
  // An upward load prepends lines above the scroll offset. Without anchoring,
  // the code region would keep its old scrollTop (or reset to 0) and dump the
  // reader at the newly revealed top — the line they were reading gone below the
  // fold. The cited line is the one they were on, so it must still be in view.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe cache key lives in `src/cache.ts:42` today.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await settleDrawer(page);
    await expect(preview.locator(".fp-target")).toHaveCount(1);

    const before = await citedRowInRegion(page);
    expect(before).not.toBeNull();
    // The reader is genuinely parked mid-file — the region is scrolled, so there
    // is somewhere to be dumped from, and the cited row is on screen to begin with.
    expect(before?.scrollTop ?? 0).toBeGreaterThan(0);
    expectCitedRowVisible(before);

    // Scrolling to the top is the gesture that loads the 11 lines above it. The
    // gutter's first row can't say the chunk landed: holding the reader's place
    // is precisely what leaves those newly revealed lines unmounted (EXC-970), so
    // the header's range is the signal.
    await scrollRegion(page, "top");
    await expect(preview.locator(".fp-range")).toHaveText(`lines 1–72 of ${CACHE_TS_LINES}`);

    // Still on screen inside the region — not pushed off either edge by the 11
    // lines that just appeared above it.
    expectCitedRowVisible(await citedRowInRegion(page));
  } finally {
    await proj.cleanup();
  }
});

test("the cited line is in view on open, wherever the reference sits", async ({ daemon, page }) => {
  // The opening window is taller than the code region, so the cited line is only
  // visible because the panel scrolls to it — and that scroll is computed against
  // the region's height, which the lane decides. The reference's own position in
  // the plan no longer changes the lane's size, so this is now the general case
  // rather than a worst case; it stays here as the guard that the centring still
  // happens for a reference anywhere in the plan, not just its first lines.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    const filler = Array.from({ length: 7 }, (_, i) => `Preamble paragraph ${i + 1}.`).join("\n\n");
    await daemon.seed({
      cwd: proj.dir,
      plan: `# Refs\n\n${filler}\n\nThe cache key lives in \`src/cache.ts:42\` today.\n`,
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(1);

    // The reference must actually sit well down the plan for this to be the case
    // it claims to be — "wherever the reference sits", not in its first lines;
    // assert that rather than trusting the filler's line height.
    const anchorY = await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const tok = sh?.querySelector("[data-file-ref]");
      return tok === null || tok === undefined ? null : tok.getBoundingClientRect().top;
    });
    expect(anchorY ?? 0).toBeGreaterThan(0.35 * 900);
    expect(anchorY ?? Infinity).toBeLessThan(0.65 * 900);

    await page.locator("[data-file-ref]").first().click();
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await expect(preview.locator(".fp-target")).toHaveCount(1);

    expectCitedRowVisible(await citedRowInRegion(page));
  } finally {
    await proj.cleanup();
  }
});

test("a file too large to preview says so, rather than reading as a load failure", async ({
  daemon,
  page,
}) => {
  // Past MAX_EXCERPT_BYTES the daemon has nothing to show, and the reason is worth
  // distinguishing: "too large" is a property of the file, "couldn't load" reads
  // as something broken. Synthetic filler sized off the ceiling itself rather
  // than a literal, so it cannot quietly fall under it the next time the ceiling
  // moves the way it did in EXC-973 — generated here, never committed.
  const FILLER = "// filler\n";
  const HUGE = FILLER.repeat(Math.ceil(MAX_EXCERPT_BYTES / FILLER.length) + 1);
  const proj = await makeProject({ "src/huge.ts": HUGE });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nOpen `src/huge.ts` to see it.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(1);

    await page.locator("[data-file-ref]").first().click();
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await expect(preview.locator('[data-preview-state="too-large"]')).toBeVisible();
    await expect(preview.locator('[data-preview-state="error"]')).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("the preview renders code in the plan view's own font, not the browser default", async ({
  daemon,
  page,
}) => {
  // The excerpt must read as a window onto the plan: it shares the .diffview
  // source grid's exact font stack, size, and line-height, never the smaller
  // label size or the UA `code {}` monospace default. Two regressions this
  // guards: the excerpt set at --text-2xs instead of the diff view's --text-base,
  // and the <code> lines falling back to the UA `monospace` family because no
  // author rule targets them directly (an inherited family loses to `code {}`).
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nOpen `src/cache.ts` here.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(1);

    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator("[data-file-preview]")).toBeVisible();

    // Read the excerpt code's computed font and a plan source line's, across the
    // light-DOM card and the shadow-root source view.
    const fonts = await page.evaluate(() => {
      const read = (el: Element | null | undefined) => {
        if (el == null) return null;
        const cs = getComputedStyle(el);
        return { family: cs.fontFamily, size: cs.fontSize, lineHeight: cs.lineHeight };
      };
      const code = document.querySelector("[data-file-preview] .fp-lcode");
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const planLine = sh?.querySelector("[data-line] span") ?? sh?.querySelector("[data-line]");
      return { code: read(code), plan: read(planLine) };
    });

    expect(fonts.code).not.toBeNull();
    expect(fonts.plan).not.toBeNull();
    // The caret mono stack the plan uses — not the UA `monospace` default.
    expect(fonts.code?.family).toContain("Berkeley Mono");
    expect(fonts.code?.family).not.toBe("monospace");
    // Identical to the plan line on all three axes (family, size, line-height).
    expect(fonts.code).toEqual(fonts.plan);
  } finally {
    await proj.cleanup();
  }
});

test("the open preview survives the review poll without repaint churn", async ({
  daemon,
  page,
}) => {
  // Regression for the periodic hover glitch (EXC-687): the 2s reviews poll hands
  // the view a fresh review object each tick. If file-ref resolution re-runs on
  // that identity churn, it rebuilds the resolved set → the token/options change
  // reference → the library repaints the whole shadow DOM, rebuilding the clicked
  // token (and its icon) underneath the pointer. With the fix, an unchanged plan
  // resolves once, so an open preview sees no repaint across ticks.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nEdit `src/cache.ts` to fix it.\n\nMore prose so the view has rows.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(1);

    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator("[data-file-preview]")).toBeVisible();

    // Tag the live file-ref token node with a JS marker, and watch for the preview
    // being torn down. A repaint rebuilds the token (dropping the marker), which is
    // exactly what flickers the icon + hover — and is independent of plan size.
    await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const tok = sh?.querySelector("[data-file-ref]");
      // biome-ignore lint/suspicious/noExplicitAny: mark the node identity
      if (tok) (tok as any).__caretProbe = true;
      // biome-ignore lint/suspicious/noExplicitAny: probe counter on window
      (window as any).__previewRemove = 0;
      const hasPreview = (n: Node) =>
        n.nodeType === 1 &&
        ((n as Element).matches?.("[data-file-preview]") ||
          (n as Element).querySelector?.("[data-file-preview]") != null);
      new MutationObserver((recs) => {
        for (const r of recs)
          r.removedNodes.forEach((n) => {
            // biome-ignore lint/suspicious/noExplicitAny: probe counter
            if (hasPreview(n)) (window as any).__previewRemove++;
          });
      }).observe(document.body, { childList: true, subtree: true });
    });

    await page.waitForTimeout(5200); // > two 2s poll ticks, pointer parked

    // The token node must be the SAME one (marker intact) — a repaint would have
    // replaced it — and the preview must never have been torn down.
    const survived = await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const tok = sh?.querySelector("[data-file-ref]");
      // biome-ignore lint/suspicious/noExplicitAny: read node marker + counter
      return { sameToken: !!(tok as any)?.__caretProbe, removed: (window as any).__previewRemove };
    });
    expect(survived.sameToken).toBe(true);
    expect(survived.removed).toBe(0);
    await expect(page.locator("[data-file-preview]")).toBeVisible();
  } finally {
    await proj.cleanup();
  }
});

test("the open preview fetches the excerpt once, not on every poll tick", async ({
  daemon,
  page,
}) => {
  // Regression for the second hover glitch: FilePreview's fetch effect must depend
  // only on the opened reference, not on the review object identity. Fed the raw
  // per-tick `review.id`, its effect re-fired every 2s poll — re-fetching and
  // re-highlighting the excerpt (a loading→ready flash) while the pointer sat still.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nOpen `src/cache.ts` here.\n" });
    let excerptFetches = 0;
    page.on("request", (req) => {
      if (req.url().includes("/file?")) excerptFetches++;
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(1);

    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator("[data-file-preview]")).toBeVisible();
    const afterOpen = excerptFetches;

    // Park the pointer across more than two poll ticks: no further excerpt fetches.
    await page.waitForTimeout(5200);
    expect(excerptFetches).toBe(afterOpen);
    expect(afterOpen).toBeLessThanOrEqual(2);
  } finally {
    await proj.cleanup();
  }
});

test("a reference with no line shows the head of the file", async ({ daemon, page }) => {
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nReview `src/cache.ts` in full before merging.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();

    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    // No line number → the excerpt starts at the top, so the line-1 marker shows
    // and the line-150 marker (past the 60-line head window) does not.
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("MARKER_LINE_ONE");
    await expect(preview).not.toContainText("MARKER_LINE_DEEP");

    // The gutter starts at line 1 and — since the head window omits the file's
    // tail — the header frames it as a slice of the 300.
    await expect(preview.locator(".fp-lnum").first()).toHaveText("1");
    await expect(preview.locator(".fp-range")).toHaveText("lines 1–60 of 300");

    // No reference line → nothing is highlighted (the highlight is a :line cue).
    await expect(preview.locator(".fp-target")).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("clicking a reference does not also open the line's comment composer", async ({
  daemon,
  page,
}) => {
  // The read-write source view wires BOTH the file-ref layer and row-click
  // commenting, so one event reaches the token-click handler (which opens the
  // preview) and then the line-click handler (which would open a composer). The
  // composition's consumed-click race makes the line stand down, exactly as it
  // does for a clicked link (see links.e2e.ts).
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe cache key lives in `src/cache.ts:42` today.\n",
    });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();

    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    // The preview opened…
    await expect(page.locator("[data-file-preview]")).toBeVisible();

    // …and the line it sits on did NOT also open a comment composer. Give any
    // (incorrect) composer a beat to appear, then assert it never did.
    const composer = page.getByRole("dialog", { name: "Add a comment" });
    const t0 = await page.evaluate(() => performance.now());
    await page.waitForFunction((t) => performance.now() > t + 300, t0);
    await expect(composer).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});
