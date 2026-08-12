// Filename references in the plan (EXC-687, click-to-open since EXC-840). The
// plan renders as markdown source through @pierre/diffs; a path-shaped token
// that resolves to a real file in the review's cwd gets a file icon (its token
// tagged data-file-ref in the shadow root) plus a resting chip that hover steps up
// from (EXC-880), and CLICKING it opens a syntax-highlighted excerpt popover —
// hovering alone never does.
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
// units (fileRefs / fileRefTag / plan-files / api tests), as do the chip's CSS
// declarations themselves (diffview/coreStyles.test.ts) — what needs a browser is
// that those declarations resolve their tokens across the shadow boundary and that
// hover beats rest in the live cascade.
//
// The daemon is a real subprocess reading the local filesystem, so each test
// writes a synthetic project dir and seeds a review whose cwd points at it. The
// content is throwaway, non-identifying scaffolding — never a real plan.

import { fileRefCount, makeProject, settleDrawer } from "@test/e2e/support/file-refs.ts";
import { expect, test, waitForTwoPollTicks } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";
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

/** The first tagged reference's computed chip fill and cursor, read from inside the
 * shadow root. The rule lives in an adopted stylesheet while the tokens it spends are
 * declared on the host document, so only a real browser can say the `var()` resolves
 * across that boundary at all — and only a real :hover can say the hover rule beats
 * the resting one in the live cascade. Null when no reference is tagged, which the
 * callers assert against rather than reading through. */
function refChipStyle(
  page: import("@playwright/test").Page,
): Promise<{ background: string; fill: string; cursor: string } | null> {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
    const tok = sh?.querySelector("[data-file-ref]");
    if (!tok) return null;
    const cs = getComputedStyle(tok);
    return { background: cs.backgroundColor, fill: cs.backgroundImage, cursor: cs.cursor };
  });
}

/** The layers of a background-image stack that actually paint. The chip family
 * declares one layer per member and lets an absent one resolve to transparent
 * through its var() fallback, so counting the lit ones is how a test says WHICH
 * tint is doing the painting rather than merely that a gradient is present. */
function litLayers(fill: string): string[] {
  return fill.split(/,\s*(?=linear-gradient)/).filter((l) => !/rgba\(0,\s*0,\s*0,\s*0\)/.test(l));
}

/** Where the cited (`.fp-target`) row sits inside the preview's scrolling code
 * region, plus the region's own scroll state — the geometry the scroll specs
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

/** The washed band a cited range paints: the mounted `.fp-target` rows' line
 * numbers, and where the band's two edges sit inside the scrolling code region.
 * Rows are windowed (EXC-970), so for a band taller than the region this reports
 * the mounted part of it — which is the part a reader can see. */
function citedBandInRegion(page: import("@playwright/test").Page): Promise<{
  lines: number[];
  top: number;
  bottom: number;
  region: number;
} | null> {
  return page.evaluate(() => {
    const code = document.querySelector("[data-file-preview] .fp-code");
    const rows = [...document.querySelectorAll("[data-file-preview] .fp-target")];
    const first = rows[0];
    const last = rows.at(-1);
    if (code === null || first === undefined || last === undefined) return null;
    const c = code.getBoundingClientRect();
    return {
      lines: rows.map((r) => Number(r.querySelector(".fp-lnum")?.textContent?.trim())),
      top: first.getBoundingClientRect().top - c.top,
      bottom: last.getBoundingClientRect().bottom - c.top,
      region: c.height,
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

/** Where the cited row sits once the region is scrolled to its top: its offset
 * now, plus however far the region is scrolled — scrolling up moves content down
 * by exactly that much. Reading the position that way rather than measuring it
 * after the scroll is what keeps the assertion off the race, since the chunk the
 * scroll fires can land before a second measurement gets taken. */
function offsetAtTop(m: Awaited<ReturnType<typeof citedRowInRegion>>): number {
  return (m?.offset ?? Number.NaN) + (m?.scrollTop ?? Number.NaN);
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
    await planSurface(page);

    // The real reference gets exactly one icon once the daemon confirms it; the
    // missing one never does, so the count settles at 1 (not 2).
    await expect.poll(() => fileRefCount(page)).toBe(1);

    // At REST — pointer parked away from the token — the reference already carries
    // its chip (EXC-880): a resolved path is tinted where it sits, so which spans
    // can be opened reads at a glance instead of needing a pointer sweep. The token
    // carries the pointer cursor at rest too, signalling it is clickable.
    //
    // WHERE that tint lives depends on the shape. This reference is backticked — the
    // citation — so the pill is the whole codespan and its fill is the group's layer,
    // rebound to the reference's tint; the reference's own box is transparent, or the
    // wash would be laid down twice over the path alone and the pill would change
    // colour at each backtick.
    await page.mouse.move(0, 0);
    const resting = await refChipStyle(page);
    expect(resting?.cursor).toBe("pointer");
    expect(litLayers(resting!.fill)).toHaveLength(1);
    expect(resting?.background).toBe("rgba(0, 0, 0, 0)");

    // Hovering a resolved reference reveals no preview — for an inline-code
    // reference like this one hover is highlight-only (EXC-840); the preview
    // waits for a click. Give the pointer pipeline a beat, then assert nothing
    // appeared.
    await page.locator("[data-file-ref]").first().hover();
    const t0 = await page.evaluate(() => performance.now());
    await page.waitForFunction((t) => performance.now() > t + 300, t0);
    await expect(page.locator("[data-file-preview]")).toHaveCount(0);

    // The hover affordance is the highlight itself, and it has to stay legible now
    // that the resting state is tinted too: with the pointer on the token the real
    // :hover state swaps the fill to a DIFFERENT color than the resting chip, so
    // hover still reads as a change of state rather than as nothing happening.
    // Pin the read non-null first — both assertions below are negative, so they
    // would pass vacuously on the `undefined` a missing token reads back as.
    const hovered = await refChipStyle(page);
    expect(hovered).not.toBeNull();
    expect(hovered?.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(hovered?.background).not.toBe(resting?.background);

    // And the wash covers the WHOLE pill, backticks included. Lighting the path alone
    // read as a lit core inside an unlit chip rather than as one pressed object, and
    // the backticks are their own tokens with no element around the group — so this is
    // the sheet's adjacent-sibling spread resolving in the live cascade, which is the
    // only place its `:has()` and `+` can be said to work at all.
    const ends = await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const tok = sh?.querySelector("[data-file-ref]");
      return [tok?.previousElementSibling, tok?.nextElementSibling].map((s) =>
        s == null ? null : { text: s.textContent, bg: getComputedStyle(s).backgroundColor },
      );
    });
    expect(ends.map((e) => e?.text)).toEqual(["`", "`"]);
    expect(ends.map((e) => e?.bg)).toEqual([hovered?.background, hovered?.background]);

    // The tint is a RESOLUTION signal, so the unresolvable `src/ghost.ts` beside it
    // must carry none — it is never tagged, so the rule cannot reach it. Asserted
    // here because "untagged" and "untinted" are different claims, and only the
    // second is what a reader actually sees.
    const ghost = await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const el = [...(sh?.querySelectorAll("[data-content] span") ?? [])].find(
        (s) => s.textContent === "src/ghost.ts" && s.children.length === 0,
      );
      if (!el) return null;
      return { tagged: el.hasAttribute("data-file-ref"), bg: getComputedStyle(el).backgroundColor };
    });
    expect(ghost).not.toBeNull();
    expect(ghost?.tagged).toBe(false);
    expect(ghost?.bg).toBe("rgba(0, 0, 0, 0)");
  } finally {
    await proj.cleanup();
  }
});

// EXC-916 moved the file/directory question to the filesystem, and EXC-918 gave
// each kind its own surface: a file opens the excerpt preview, a directory opens
// the folder tree. This spec owns the routing seam — that one click reaches the
// right one of the two, and dismisses the other — while the tree's own behaviour
// lives in folder-refs.e2e.ts. The kind reaches the token as the tag's VALUE,
// which only happens in the shadow root after a real round-trip against a real
// cwd, so it is asserted here rather than as a unit.
test("routes a click to the excerpt preview or the folder tree, by kind", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject({ "src/cache.ts": CACHE_TS, "src/lib/util.ts": "export {};\n" });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nEdit `src/cache.ts`, which sits beside `src/lib` and `src/lib/`.\n",
    });
    await page.goto("/");
    await planSurface(page);

    // Three tagged tokens: the file, and both spellings of the directory — the
    // trailing slash is not a discriminator, the filesystem is.
    await expect.poll(() => fileRefCount(page)).toBe(3);
    const tagged = await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
      return [...(sh?.querySelectorAll("[data-file-ref]") ?? [])].map((el) => [
        el.textContent,
        el.getAttribute("data-file-ref"),
      ]);
    });
    expect(tagged).toEqual([
      ["src/cache.ts", ""],
      ["src/lib", "directory"],
      ["src/lib/", "directory"],
    ]);

    // The file opens the excerpt lane and no tree…
    await page.locator('[data-file-ref=""]').click();
    await expect(page.locator("[data-file-preview]")).toBeVisible();
    await expect(page.locator("[data-folder-tree]")).toHaveCount(0);

    // …and the directory opens the tree, dismissing the preview rather than
    // stacking a second reference surface on top of it.
    await page.locator(".diffview").getByText("src/lib/", { exact: true }).click();
    await expect(page.locator("[data-folder-tree]")).toBeVisible();
    await expect(page.locator("[data-file-preview]")).toHaveCount(0);
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
    await planSurface(page);
    await expect(page.locator("html")).toHaveAttribute("style", /--paper:\s*#21222c/i);

    await expect.poll(() => fileRefCount(page)).toBe(1);

    await page.mouse.move(0, 0);
    const resting = await refChipStyle(page);
    expect(resting?.cursor).toBe("pointer");
    // Backticked, so the citation's own pill carries the resting tint — see the note
    // in the resolution spec above.
    expect(litLayers(resting!.fill)).toHaveLength(1);
    expect(resting?.background).toBe("rgba(0, 0, 0, 0)");

    await page.locator("[data-file-ref]").first().hover();
    const hovered = await refChipStyle(page);
    expect(hovered).not.toBeNull();
    expect(hovered?.background).not.toBe("rgba(0, 0, 0, 0)");
    expect(hovered?.background).not.toBe(resting?.background);
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
  // coarse token running to the end of the line. That token used to cost the label
  // its glyph — tagFileRefTokens refuses a token wider than the path, since the
  // glyph and its hover chip would wrap the whole sentence — so the shape was
  // clickable without being marked. EXC-867's decoration pass cuts every row at
  // its file-reference columns, so the label is now its own element and takes the
  // glyph like any other reference. Both labels are asserted below.
  //
  // "Exactly once" is the invariant that outlives that change: each reference marks
  // ONE element, so the backticked shape — where both decoration paths fire, the
  // link layer emitting over the whole label and the inline-code scan finding the
  // path inside it — still draws a single glyph rather than two.
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
    await planSurface(page);

    // Two glyphs, one per resolving label. Not 1 — the bare-path label now has an
    // element of its own to take it. Not 4 — neither label draws two. Not 3 — the
    // link to a missing file never decorates.
    await expect.poll(() => fileRefCount(page)).toBe(2);

    // And each sits on its path ALONE. This is the assertion the count cannot make:
    // a glyph drawn around the entire sentence would still count as one, and it is
    // exactly what the decoration pass's cut has to prevent for the bare-path label.
    const tagged = await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
      return [...(sh?.querySelectorAll("[data-file-ref]") ?? [])].map((el) => el.textContent);
    });
    expect(tagged).toEqual(["src/cache.ts", "src/other.ts"]);

    // The collision-merged span is clickable, not merely visible — and the two
    // links point at different files, so the preview's content is what proves
    // which span was clicked.
    await page.locator("[data-file-ref]").nth(1).click();
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("src/other.ts");

    // The bare-path label opens its own file too. The glyph moved onto it, and the
    // affordance it always had is unchanged — the prose AFTER it is now a separate
    // element, which is what keeps the reference's box off the rest of the sentence.
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    const sentence = await page
      .locator(".diffview")
      .getByText("holds the key.", { exact: false })
      .boundingBox();
    const midY = sentence!.y + sentence!.height / 2;

    // Past the label, over "holds the key." — no preview, and the row's own
    // click affordance runs instead. The box measured here is the prose ALONE:
    // before the decoration pass this text and the path shared one token, and the
    // split is what narrows it to the half that must stay inert.
    await page.mouse.click(sentence!.x + sentence!.width - 4, midY);
    await expect(page.getByRole("dialog", { name: "Add a comment" })).toBeVisible();
    expect(await preview.count()).toBe(0);
    await page.keyboard.press("Escape");

    // On the label itself — the reference opens, and it is the label's own file.
    // Still a COORDINATE click, so it proves the pointer pipeline hit-tests the
    // label's real screen position; a locator click would only prove the tagged
    // element is clickable, which the nth(1) click above already covers. The box
    // comes from the reference element because the split moved the label out of
    // the sentence's box, which is what `sentence` now measures.
    const label = await page.locator("[data-file-ref]").nth(0).boundingBox();
    await page.mouse.click(label!.x + label!.width / 2, label!.y + label!.height / 2);
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
    await planSurface(page);

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
    await expect(preview.getByRole("status")).toHaveText(`lines 12–72 of ${CACHE_TS_LINES}`);
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

// EXC-938. A `path:start-end` reference cites a whole span, and the preview
// frames it: every cited line washed, context around it, and the end line inside
// the click target. These four specs cover what only real layout can answer —
// which rows carry the wash, where the band lands in the scrolling region, what
// happens when the span outgrows the region or runs past the file's end, and
// whether the end line is clickable at all.
test("a cited range washes every line it names, framed with context on both sides", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe key is built across `src/cache.ts:40-44` today.\n",
    });
    await page.goto("/");
    await planSurface(page);
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await settleDrawer(page);

    // The window is the citation padded by the daemon's own radius on each side,
    // so the span is read in context rather than flush against the window's ends.
    await expect(preview.getByRole("status")).toHaveText(`lines 10–74 of ${CACHE_TS_LINES}`);

    // Exactly the five cited lines are washed — not one, and not the padding.
    const band = await citedBandInRegion(page);
    expect(band?.lines).toEqual([40, 41, 42, 43, 44]);
    // …and the whole band opens on screen, both edges inside the region.
    expect(band?.top ?? -1).toBeGreaterThanOrEqual(0);
    expect(band?.bottom ?? Infinity).toBeLessThanOrEqual(band?.region ?? 0);
  } finally {
    await proj.cleanup();
  }
});

test("a range taller than the region opens at its first line, not centred", async ({
  daemon,
  page,
}) => {
  // Centring a span taller than what shows would put its first line above the
  // fold, so the reader would open the preview already past the start of what
  // they clicked. The framing term goes to zero instead, which parks the span's
  // head at the top edge — no branch, and nothing to tune.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe whole middle, `src/cache.ts:100-250`, moves.\n",
    });
    await page.goto("/");
    await planSurface(page);
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await settleDrawer(page);

    const band = await citedBandInRegion(page);
    // The band starts at the citation's own first line, sitting at the region's
    // top edge — within a pixel, the browser quantizing a fractional scrollTop.
    expect(band?.lines[0]).toBe(100);
    expect(Math.abs(band?.top ?? Number.NaN)).toBeLessThanOrEqual(1);
    // And it really is taller than the region, or the assertion above would hold
    // for a centred span too.
    expect(band?.bottom ?? 0).toBeGreaterThan(band?.region ?? Infinity);
  } finally {
    await proj.cleanup();
  }
});

test("a range running past the file's end still opens, framed on its last lines", async ({
  daemon,
  page,
}) => {
  // A plan written against a file that has since shrunk. The daemon clamps the
  // fetched range to the file, so the wash and the framing have to clamp with it
  // rather than reaching for rows that do not exist.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe tail, `src/cache.ts:295-400`, is gone.\n",
    });
    await page.goto("/");
    await planSurface(page);
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await settleDrawer(page);

    // The window ends at the file's last line, and no row past it exists to
    // frame. Where it STARTS is not this spec's business: the clamped window is
    // shorter than the region, so the auto-loader grows it upward on sight
    // (EXC-969) — which is correct, and would make an exact start brittle.
    await expect(preview.getByRole("status")).toHaveText(
      new RegExp(`^lines \\d+–${CACHE_TS_LINES} of ${CACHE_TS_LINES}$`),
    );
    // Retried, unlike the other two range specs: this is the one whose window
    // the auto-loader is still growing, and a chunk landing between the two
    // measurements would read the band mid-shift.
    await expect(async () => {
      const band = await citedBandInRegion(page);
      expect(band?.lines).toEqual([295, 296, 297, 298, 299, 300]);
      expect(band?.top ?? -1).toBeGreaterThanOrEqual(0);
      expect(band?.bottom ?? Infinity).toBeLessThanOrEqual(band?.region ?? 0);
    }).toPass({ timeout: 10_000 });
  } finally {
    await proj.cleanup();
  }
});

test("clicking a range reference's end-line tail opens the preview", async ({ daemon, page }) => {
  // The click-target half of the feature. The span's endCol is what the pointer
  // hit-test resolves against, so a `-44` tail outside the span is visibly part
  // of the reference and dead to a click. Only a real token hit-test in the
  // shadow root can tell the two apart.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nThe key is built across `src/cache.ts:40-44` today.\n",
    });
    await page.goto("/");
    await planSurface(page);
    await expect.poll(() => fileRefCount(page)).toBe(1);

    // The tagged token covers the whole reference, end line included. Aim at the
    // centre of its last character through a Range over that character, not at
    // the token's own right edge: the file glyph is drawn inside the token's box,
    // so the box is wider than its text and an edge-relative point lands past it.
    const tail = await page.evaluate(() => {
      const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot;
      const el = sh?.querySelector("[data-file-ref]");
      const text = el?.firstChild;
      if (el == null || text == null) return null;
      const length = text.textContent?.length ?? 0;
      const range = document.createRange();
      range.setStart(text, length - 1);
      range.setEnd(text, length);
      const r = range.getBoundingClientRect();
      return { text: el.textContent, x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    expect(tail?.text).toBe("src/cache.ts:40-44");

    // Click that last character — the `4` of `-44`, nowhere near the path.
    await page.mouse.click(tail?.x ?? 0, tail?.y ?? 0);
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("src/cache.ts");
    await expect(preview.getByRole("status")).toHaveText(`lines 10–74 of ${CACHE_TS_LINES}`);
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
    await planSurface(page);

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
    await planSurface(page);

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
    await planSurface(page);

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
    await planSurface(page);
    await expect.poll(() => fileRefCount(page)).toBe(1);

    await page.locator("[data-file-ref]").first().click();
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    // Measure at the lane's settled size, not part-way through its opening wipe.
    await settleDrawer(page);

    // The whole 60-line opening window is loaded, not a handful of lines. How
    // many of those rows are mounted is the window's business (EXC-970); what
    // this spec is about is that the panel pages them inside its own lane.
    await expect(preview.getByRole("status")).toHaveText("lines 1–60 of 400");

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
    await expect(preview.getByRole("status")).toHaveText("lines 1–60 of 400");
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
    await planSurface(page);
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
    await expect(preview.getByRole("status")).toHaveText(`${CACHE_TS_LINES} lines`);
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
    await planSurface(page);
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
    await expect(preview.getByRole("status")).toHaveText(`${CACHE_TS_LINES} lines`);
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
    await planSurface(page);
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().click();

    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await settleDrawer(page);

    // Reading to the end is what loads the file (EXC-969), so walking it is a
    // repeated scroll rather than a click; it settles once nothing is left below.
    await expect(async () => {
      await scrollRegion(page, "bottom");
      await expect(preview.getByRole("status")).toHaveText(`${CACHE_TS_LINES} lines`, {
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
    await planSurface(page);
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
    await expect(preview.getByRole("status")).toHaveText(`lines 1–60 of ${CACHE_TS_LINES}`);
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
    await planSurface(page);
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
    await expect(preview.getByRole("status")).toHaveText(`lines 1–72 of ${CACHE_TS_LINES}`);

    // Still on screen inside the region — not pushed off either edge by the 11
    // lines that just appeared above it — and not merely on screen: exactly where
    // it was. Scrolling to the top left the cited row `offset + scrollTop` down
    // the region, and a chunk landing above it must not move it a pixel. The
    // slack is one: the browser quantizes a fractional scrollTop to whole CSS px.
    const after = await citedRowInRegion(page);
    expectCitedRowVisible(after);
    expect(Math.abs((after?.offset ?? Number.NaN) - offsetAtTop(before))).toBeLessThanOrEqual(1);
  } finally {
    await proj.cleanup();
  }
});

// The companion to the spec above, for a reader who has NOT stopped. Loading is
// scroll-driven (EXC-969) and key-driven (EXC-972), so the gesture that fires a
// load is usually still going when it lands: the anchor has to shift the offset
// the reader holds *now* by the height that arrived, not restore the one they
// held when the fetch left. Restoring the stale one throws away everything they
// scrolled in between and slides the cited line out from under their eye — which
// needs a real scroller and a real in-flight request, so it lives here.
//
// Both cited lines, because they land in different regimes for the browser's own
// scroll anchoring, which compensates for content growing above the viewport and
// would double a shift the component has already made. Mid-file the arriving
// chunk is larger than the mounted window and the rows are keyed by line number,
// so every mounted row is replaced and the browser has no surviving anchor. Near
// the head the chunk is truncated to the lines that actually exist, most of the
// window survives, and the browser does have one.
for (const cited of [150, 42]) {
  test(`an upward chunk landing mid-gesture keeps the cited line under the reader (:${cited})`, async ({
    daemon,
    page,
  }) => {
    const proj = await makeProject({ "src/cache.ts": CACHE_TS });
    try {
      await daemon.seed({
        cwd: proj.dir,
        plan: `# Refs\n\nThe key lives in \`src/cache.ts:${cited}\` today.\n`,
      });
      await page.goto("/");
      await planSurface(page);
      await expect.poll(() => fileRefCount(page)).toBe(1);
      await page.locator("[data-file-ref]").first().click();

      const preview = page.locator("[data-file-preview]");
      await expect(preview).toBeVisible();
      await settleDrawer(page);
      await expect(preview.locator(".fp-target")).toHaveCount(1);
      const opened = await citedRowInRegion(page);
      expectCitedRowVisible(opened);
      // The opening offset is also this spec's whole discriminating margin: the
      // pre-fix code landed at `0 + arrived` where the fix lands at
      // `opened.scrollTop + arrived`, so that is the error the closing assertion
      // has to resolve against a one-pixel tolerance. More than a row of it, or
      // the spec could pass against the bug it was written for.
      expect(opened?.scrollTop ?? 0).toBeGreaterThan(opened?.row ?? 0);

      // Hold the next excerpt request open so a gesture can outrun it, the way a
      // real one does. A promise the spec resolves, never a delay — a fixed sleep
      // would race the very window it is waiting on.
      const { promise: held, resolve: release } = Promise.withResolvers<void>();
      let requests = 0;
      try {
        await page.route(
          (url) => url.pathname.endsWith("/file"),
          async (route) => {
            requests++;
            await held;
            await route.continue();
          },
        );

        // Reaching the top edge fires the upward load…
        const framed = await preview.getByRole("status").textContent();
        expect(framed).not.toBeNull();
        await scrollRegion(page, "top");
        await expect.poll(() => requests).toBe(1);

        // …and the reader carries on while it is in flight, back down to where
        // the panel opened. Single-flight, so this scroll asks for nothing
        // further. Through renderedRows rather than scrollRegion for the frame it
        // waits on: without it the window has not re-rendered when the cited row
        // is measured next, and the row may not be mounted yet.
        await renderedRows(page, opened?.scrollTop ?? 0);
        const moved = await citedRowInRegion(page);
        // The same rows at the offset the panel opened at, so the rect is the
        // same rect: a fractional scrollTop does not round-trip bit-exact
        // through the browser, so this is within a pixel rather than equal. The
        // margin the spec discriminates on is a whole opening offset (asserted
        // above), so a pixel of slack here costs it nothing.
        expect(
          Math.abs((moved?.offset ?? Number.NaN) - (opened?.offset ?? Number.NaN)),
        ).toBeLessThanOrEqual(1);

        release();
        await expect(preview.getByRole("status")).not.toHaveText(framed ?? "\0");

        // The chunk landed entirely above the reader, so the cited line is still
        // exactly where they left it — the region moved down by what arrived
        // rather than back to the offset the fetch started from.
        const after = await citedRowInRegion(page);
        expectCitedRowVisible(after);
        expect(
          Math.abs((after?.offset ?? Number.NaN) - (moved?.offset ?? Number.NaN)),
        ).toBeLessThanOrEqual(1);
      } finally {
        // Idempotent, and the only thing that lets a failed assertion above fail
        // in seconds: an unreleased handler parks a real request until teardown.
        release();
      }
    } finally {
      await proj.cleanup();
    }
  });
}

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
    await planSurface(page);
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
    await planSurface(page);
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
    await planSurface(page);
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
    await planSurface(page);
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

    await waitForTwoPollTicks(page); // pointer parked across the ticks

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
    await planSurface(page);
    await expect.poll(() => fileRefCount(page)).toBe(1);

    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator("[data-file-preview]")).toBeVisible();
    const afterOpen = excerptFetches;

    // Pointer parked: the fetch effect must not re-fire on a tick.
    await waitForTwoPollTicks(page);
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
    await planSurface(page);

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
    await expect(preview.getByRole("status")).toHaveText("lines 1–60 of 300");

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
    await planSurface(page);

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

test("switching references lets the outgoing file leave before the next arrives", async ({
  daemon,
  page,
}) => {
  // EXC-975. The panel used to blank to "Loading…" between two references —
  // the one place it emptied mid-load, and the switch the reader triggers most
  // deliberately. Now the outgoing rows stay up and animate away while the next
  // file loads. This needs a real browser: happy-dom runs no animations, so the
  // unit suite can only pin which element carries .fp-leaving, not that the
  // departure is ever painted.
  //
  // The excerpt request is gated open, because that is the whole window the
  // outgoing file is on screen for. Ungated, a warm local daemon can answer
  // inside a frame — which is exactly the case awaitDeparture() exists to stop
  // from swallowing the animation, and is asserted after the gate is released.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS, "src/other.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nFirst `src/cache.ts:42`, then `src/other.ts:150`.\n",
    });
    await page.goto("/");
    await planSurface(page);
    await expect.poll(() => fileRefCount(page)).toBe(2);

    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator(".fp-path")).toHaveText("src/cache.ts");
    await settleDrawer(page);

    // Hold the second file's excerpt in flight.
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/file?*", async (route) => {
      await gate;
      await route.continue();
    });

    await page.locator("[data-file-ref]").nth(1).click();

    // The first file is still on screen, marked as leaving, and there is no
    // loading message — there is something to animate away, which is the point.
    await expect(page.locator(".fp-code.fp-leaving")).toHaveCount(1);
    await expect(page.locator(".fp-path")).toHaveText("src/cache.ts");
    await expect(page.locator('[data-preview-state="loading"]')).toHaveCount(0);
    // On the exit curve, at the exit duration — both off the tokens.
    await expect(page.locator(".fp-code")).toHaveCSS("animation-duration", "0.12s");
    await expect(page.locator(".fp-code")).toHaveCSS(
      "animation-timing-function",
      "cubic-bezier(0.4, 0, 1, 1)",
    );

    release();

    // The second file replaces it in a NEW region — a reused one would neither
    // restart the enter animation nor start unscrolled — on the enter curve.
    await expect(page.locator(".fp-path")).toHaveText("src/other.ts");
    await expect(page.locator(".fp-code")).toHaveCount(1);
    await expect(page.locator(".fp-code.fp-leaving")).toHaveCount(0);
    await expect(page.locator(".fp-code")).toHaveCSS(
      "animation-timing-function",
      "cubic-bezier(0.22, 1, 0.36, 1)",
    );
  } finally {
    await proj.cleanup();
  }
});
