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
// it doesn't also do its normal thing (open a line comment). The resolve + read +
// shadow-DOM token tagging + real hover/click only exist in a browser against a
// real daemon reading a real cwd, so they are exercised here; the pure detection,
// resolution, and excerpt math stay units (fileRefs / fileRefTag / plan-files /
// api tests).
//
// The daemon is a real subprocess reading the local filesystem, so each test
// writes a synthetic project dir and seeds a review whose cwd points at it. The
// content is throwaway, non-identifying scaffolding — never a real plan.

import { fileRefCount, makeProject, settleDrawer } from "@test/e2e/support/file-refs.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";

// A 300-line source file with unique markers on lines 1, 42, and 150, so a
// preview can be told apart as "head" vs "centered on :42" and a window's reach
// can be pinned from either end. It must stay comfortably longer than the widest
// opening window (EXCERPT_HEAD_LINES = 60, EXCERPT_RADIUS = 30) — a file that
// fits in one window would leave every boundary-strip assertion below vacuous.
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

/** Assert the cited row is fully on screen within the code region — neither
 * scrolled off the top nor left below the fold. */
function expectCitedRowVisible(m: Awaited<ReturnType<typeof citedRowInRegion>>): void {
  expect(m).not.toBeNull();
  expect(m?.offset ?? -1).toBeGreaterThanOrEqual(0);
  expect(m?.offset ?? Infinity).toBeLessThanOrEqual((m?.region ?? 0) - (m?.row ?? 0));
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
    // 300-line file, so the gutter starts at 12 and both strips report the elided
    // remainder: 11 lines above and 228 below.
    await expect(preview.locator(".fp-lnum").first()).toHaveText("12");
    await expect(preview.locator(".fp-edge-top")).toContainText("11");
    await expect(preview.locator(".fp-edge-bottom")).toContainText("228");

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
  // the panel. That matters because a panel that outgrew its lane would put its
  // bottom strip out of reach, and a line clipped instead of scrolled would be
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

    // The whole 60-line opening window is rendered, not a handful of rows.
    await expect(preview.locator(".fp-row")).toHaveCount(60);

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
    // inset by a margin or a corner radius. So the header and both strips stay
    // reachable at the lane's own edges instead of floating inside it.
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

    // A bottom strip still announces the remainder — and now offers to reach it.
    await expect(preview.locator(".fp-edge-bottom")).toContainText("below");
  } finally {
    await proj.cleanup();
  }
});

test("the boundary strips expand the window until the whole file is reachable", async ({
  daemon,
  page,
}) => {
  // The core of EXC-756: a reader who needs more than the opening window gets it
  // in place. Clicking a strip repeatedly walks the window to that end of the
  // file, and the strip retires once there is nothing left on its side.
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
    const top = preview.locator(".fp-edge-top");
    const bottom = preview.locator(".fp-edge-bottom");
    await expect(top).toBeVisible();

    // Walk upward until the top strip retires: the window then starts at line 1.
    // One click per attempt, retried — a click landing while the widened window
    // is still in flight is deliberately dropped, so the walk must be poll-shaped
    // rather than a fixed burst of clicks.
    await expect(async () => {
      if ((await top.count()) > 0) await top.click();
      await expect(top).toHaveCount(0, { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(preview.locator(".fp-lnum").first()).toHaveText("1");
    await expect(preview).toContainText("MARKER_LINE_ONE");

    // Then downward until the bottom strip retires: the window ends at the last
    // line, and the reader has reached the whole file without leaving the review.
    await expect(async () => {
      if ((await bottom.count()) > 0) await bottom.click();
      await expect(bottom).toHaveCount(0, { timeout: 1_000 });
    }).toPass({ timeout: 20_000 });
    await expect(preview.locator(".fp-lnum").last()).toHaveText(String(CACHE_TS_LINES));
    await expect(preview.locator(".fp-row")).toHaveCount(CACHE_TS_LINES);
  } finally {
    await proj.cleanup();
  }
});

test("expanding upward keeps the reader's line in view", async ({ daemon, page }) => {
  // An upward expansion prepends lines above the scroll offset. Without anchoring,
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
    await expect(preview.locator(".fp-target")).toHaveCount(1);

    const before = await citedRowInRegion(page);
    expect(before).not.toBeNull();
    // The reader is genuinely parked mid-file — the region is scrolled, so there
    // is somewhere to be dumped from, and the cited row is on screen to begin with.
    expect(before?.scrollTop ?? 0).toBeGreaterThan(0);
    expectCitedRowVisible(before);

    await preview.locator(".fp-edge-top").click();
    await expect(preview.locator(".fp-lnum").first()).toHaveText("1");

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
  // as something broken. Synthetic filler, just over the 2 MiB ceiling.
  const HUGE = `${"// filler\n".repeat(220_000)}`;
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
    // tail — a bottom strip reports the remainder, with no strip above.
    await expect(preview.locator(".fp-lnum").first()).toHaveText("1");
    await expect(preview.locator(".fp-edge-top")).toHaveCount(0);
    await expect(preview.locator(".fp-edge-bottom")).toContainText("below");

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
