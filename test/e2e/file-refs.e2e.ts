// Filename references in the plan (EXC-687, click-to-open since EXC-840). The
// plan renders as markdown source through @pierre/diffs; a path-shaped token
// that resolves to a real file in the review's cwd gets a file icon (its token
// tagged data-file-ref in the shadow root) and a hover highlight, and CLICKING
// it opens a syntax-highlighted excerpt popover — hovering alone never does.
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

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, test } from "@test/e2e/support/fixtures.ts";

/** Write a throwaway project dir with the given files, returning its path and a
 * cleanup. The daemon (a real subprocess) reads it via the seeded review's cwd. */
async function makeProject(files: Record<string, string>): Promise<{
  dir: string;
  cleanup: () => Promise<void>;
}> {
  const dir = await mkdtemp(join(tmpdir(), "caret-e2e-proj."));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content);
  }
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// A 50-line source file with a unique marker on line 1 and line 42, so a preview
// can be told apart as "head" vs "centered on :42".
const CACHE_TS = Array.from({ length: 50 }, (_, i) => {
  const n = i + 1;
  if (n === 1) return "// MARKER_LINE_ONE — top of the file";
  if (n === 42) return 'const cacheKey = "MARKER_LINE_FORTYTWO"; // line 42';
  return `const line${n} = ${n};`;
}).join("\n");

/** The number of file-reference icons currently tagged in the plan's shadow root. */
function fileRefCount(page: import("@playwright/test").Page): Promise<number> {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    return sh?.querySelectorAll("[data-file-ref]").length ?? 0;
  });
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

    // Hovering a resolved reference reveals no preview — hover is highlight-only
    // (EXC-840); the preview waits for a click. Give the pointer pipeline a beat,
    // then assert nothing appeared.
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
    // line-1 marker (outside the ±6 snippet) does not.
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("src/cache.ts");
    await expect(preview).toContainText("MARKER_LINE_FORTYTWO");
    await expect(preview).not.toContainText("MARKER_LINE_ONE");

    // The excerpt is syntax-highlighted, not plain: shiki colors tokens, one line
    // per numbered row (not one undivided block).
    await expect(preview.locator('.fp-lcode span[style*="color"]').first()).toBeVisible();

    // The window centers on line 42 (±EXCERPT_RADIUS = 6) → lines 36–48 of the
    // 50-line file, so the gutter starts at 36 and both strips report the elided
    // tail: 35 lines above and 2 below.
    await expect(preview.locator(".fp-lnum").first()).toHaveText("36");
    await expect(preview.locator(".fp-edge-top")).toContainText("35");
    await expect(preview.locator(".fp-edge-bottom")).toContainText("2");

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

test("the preview shows only a bounded snippet, never a scrollable full file", async ({
  daemon,
  page,
}) => {
  // A preview is a peek, not the file: even against a large file it must cap to a
  // handful of lines and never scroll vertically, so it can't be mistaken for the
  // whole thing. (Horizontal scroll for long lines is fine; vertical paging is not.)
  const BIG = Array.from({ length: 400 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n");
  const proj = await makeProject({ "src/big.ts": BIG });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nOpen `src/big.ts` to see it.\n" });
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(1);

    await page.locator("[data-file-ref]").first().click();
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();

    // Only a snippet — a handful of rows, nowhere near the 400-line file.
    const rows = await preview.locator(".fp-row").count();
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(20);

    // The code region cannot scroll vertically: overflow-y is clipped, not auto.
    const overflowY = await page.evaluate(() => {
      const code = document.querySelector("[data-file-preview] .fp-code");
      return code ? getComputedStyle(code).overflowY : null;
    });
    expect(overflowY).toBe("hidden");

    // And a bottom strip announces the large remainder, reinforcing it's an excerpt.
    await expect(preview.locator(".fp-edge-bottom")).toContainText("below");
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
    // and the line-42 marker (past the head window) does not.
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("MARKER_LINE_ONE");
    await expect(preview).not.toContainText("MARKER_LINE_FORTYTWO");

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
