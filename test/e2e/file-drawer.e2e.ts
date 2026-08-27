// The file preview's container (EXC-937). file-refs.e2e.ts owns the reference
// layer — what gets marked, what the excerpt says, how it is dismissed; this
// spec owns the drawer the excerpt lives in: which edge it docks to, that it
// takes layout space instead of covering the plan, that it resizes and remembers
// its size per edge, and that a second filename swaps its contents in place.
// Since EXC-1129 the folder card can sit open beside the lane, so where the card
// LANDS is this spec's too: it is geometry between the two surfaces, measured
// against the lane's own rect, and the helpers for that already live here — which
// now includes where a lane opened FROM the card leaves it (EXC-1137). The
// coexistence RULES — click routing, Escape order, what a row click opens — stay
// in folder-refs.e2e.ts.
//
// All of it is layout a browser decides (doc/agents/browser-testing.md): the
// docking edge comes from a live matchMedia subscription, the sizes from real
// rects, and the drag from real pointer events. The clamping math itself stays a
// unit (ui/src/lib/fileDrawer.test.ts).

import type { Page } from "@playwright/test";

import { fileRefCount, makeProject, settleDrawer } from "@test/e2e/support/file-refs.ts";
import { expect, test } from "@test/e2e/support/fixtures.ts";
import { PLAN_SURFACE, planSurface } from "@test/e2e/support/source-view.ts";
import { MIN_APP_WIDTH_PX, NARROW_WIDTH_PX, TIGHT_WIDTH_PX } from "@ui/src/lib/layout.ts";

// Comfortably inside the narrow regime rather than a pixel off the breakpoint,
// so a rounding difference in matchMedia can't decide the docking edge.
const NARROW = { width: NARROW_WIDTH_PX - 160, height: 900 };
const WIDE = { width: NARROW_WIDTH_PX + 440, height: 900 };

const CACHE_TS = Array.from({ length: 300 }, (_, i) => `const line${i + 1} = ${i + 1};`).join("\n");
const OTHER_TS = Array.from(
  { length: 120 },
  (_, i) => `export const other${i + 1} = "OTHER_MARKER_${i + 1}";`,
).join("\n");

/** Viewport rects of the surface, the plan pane, and the drawer — the three the
 * docking assertions compare. Drawer is null when none is open. */
function laneGeometry(page: Page): Promise<{
  surface: DOMRect;
  pane: DOMRect;
  drawer: DOMRect | null;
} | null> {
  return page.evaluate(() => {
    const rect = (sel: string) => {
      const el = document.querySelector(sel);
      return el === null ? null : (el.getBoundingClientRect().toJSON() as DOMRect);
    };
    const surface = rect(".diff-surface");
    const pane = rect(".plan-pane");
    if (surface === null || pane === null) return null;
    return { surface, pane, drawer: rect("[data-file-drawer]") };
  });
}

/** Open the preview for the first resolved reference in the plan, and wait out
 * the lane's opening wipe so every rect below is measured at its settled size. */
async function openPreview(page: Page): Promise<void> {
  await planSurface(page);
  await expect.poll(() => fileRefCount(page)).toBeGreaterThan(0);
  await page.locator("[data-file-ref]").first().click();
  await expect(page.locator("[data-file-drawer]")).toBeVisible();
  await expect(page.locator("[data-file-preview]")).toBeVisible();
  await settleDrawer(page);
}

test("at a wide width the drawer docks right, taking space rather than covering the plan", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nEdit `src/cache.ts` to fix it.\n" });
    await page.setViewportSize(WIDE);
    await page.goto("/");

    const before = await laneGeometry(page);
    expect(before?.drawer).toBeNull();
    // With nothing docked the pane is the surface.
    expect(before?.pane.width ?? 0).toBeCloseTo(before?.surface.width ?? -1, 0);

    await openPreview(page);
    await expect(page.getByRole("separator", { name: "Resize file preview" })).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );

    const after = await laneGeometry(page);
    const drawer = after?.drawer;
    expect(drawer).not.toBeNull();
    // The surface is unchanged and the pane gave up exactly the drawer's width —
    // the drawer took layout space, it did not overlay.
    expect(after?.surface.width ?? 0).toBeCloseTo(before?.surface.width ?? -1, 0);
    expect((after?.pane.width ?? 0) + (drawer?.width ?? 0)).toBeCloseTo(
      after?.surface.width ?? -1,
      0,
    );
    // …and they do not overlap: the drawer starts where the plan ends.
    expect(drawer?.left ?? 0).toBeGreaterThanOrEqual((after?.pane.right ?? Infinity) - 1);
    expect(drawer?.right ?? 0).toBeCloseTo(after?.surface.right ?? -1, 0);
    // Full height of the surface: the lane is a column beside the plan.
    expect(drawer?.height ?? 0).toBeCloseTo(after?.surface.height ?? -1, 0);
  } finally {
    await proj.cleanup();
  }
});

/** One `animationstart` observation, carrying the keyframes of the animation
 * that fired it — captured at that instant because they are unreadable after. */
interface Wipe {
  name: string;
  onLane: boolean;
  keyframes: Record<string, unknown>[];
}

test("the lane wipes in from the edge it docks to", async ({ daemon, page }) => {
  // The open is an animation on the docking dimension, so the plan reflows every
  // frame instead of the drawer appearing at full size. Recorded through
  // animationstart rather than read off computed style: an animation-name
  // pointing at deleted keyframes still computes, but never fires.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nEdit `src/cache.ts` to fix it.\n" });

    for (const [viewport, dimension] of [
      [WIDE, "width"],
      [NARROW, "height"],
    ] as const) {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await planSurface(page);
      await expect.poll(() => fileRefCount(page)).toBe(1);

      // The keyframes are read HERE, inside the listener, not from a later
      // getAnimations() call: the wipe runs for --dur-enter (220ms) and then
      // leaves the element's animation list empty forever, so any read that
      // costs a round-trip is racing a window it loses on a loaded host.
      // animationstart is the one instant the animation is guaranteed live.
      await page.evaluate(() => {
        const w = window as unknown as { __wipes: Wipe[] };
        w.__wipes = [];
        window.addEventListener(
          "animationstart",
          (e) => {
            const t = e.target as Element | null;
            w.__wipes.push({
              name: e.animationName,
              onLane: t?.hasAttribute("data-file-drawer") ?? false,
              keyframes: (t?.getAnimations() ?? []).flatMap((a) =>
                a.effect instanceof KeyframeEffect ? a.effect.getKeyframes() : [],
              ),
            });
          },
          { capture: true },
        );
      });

      await page.locator("[data-file-ref]").first().click();
      await expect(page.locator("[data-file-drawer]")).toBeVisible();

      // Svelte scopes keyframe names, so match the declared name rather than
      // pinning the hash it compiles to.
      const wipeName = dimension === "width" ? "fd-open-right" : "fd-open-bottom";
      await expect
        .poll(() =>
          page.evaluate(
            (name) =>
              (window as unknown as { __wipes: Wipe[] }).__wipes
                .filter((wipe) => wipe.onLane)
                .some((wipe) => wipe.name.includes(name)),
            wipeName,
          ),
        )
        .toBe(true);

      // …and it really moves that dimension: the keyframes start the lane at 0.
      const from = await page.evaluate(
        ([name, dim]) =>
          (window as unknown as { __wipes: Wipe[] }).__wipes
            .filter((wipe) => wipe.onLane && wipe.name.includes(name))
            .flatMap((wipe) => wipe.keyframes)
            .map((k) => (k as Record<string, unknown>)[dim]),
        [wipeName, dimension] as [string, string],
      );
      expect(from).toContain("0px");
    }
  } finally {
    await proj.cleanup();
  }
});

test("at a narrow width the drawer docks bottom, shortening the plan the same way", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nEdit `src/cache.ts` to fix it.\n" });
    await page.setViewportSize(NARROW);
    await page.goto("/");

    const before = await laneGeometry(page);
    await openPreview(page);
    await expect(page.getByRole("separator", { name: "Resize file preview" })).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );

    const after = await laneGeometry(page);
    const drawer = after?.drawer;
    expect(drawer).not.toBeNull();
    expect(after?.surface.height ?? 0).toBeCloseTo(before?.surface.height ?? -1, 0);
    expect((after?.pane.height ?? 0) + (drawer?.height ?? 0)).toBeCloseTo(
      after?.surface.height ?? -1,
      0,
    );
    expect(drawer?.top ?? 0).toBeGreaterThanOrEqual((after?.pane.bottom ?? Infinity) - 1);
    expect(drawer?.width ?? 0).toBeCloseTo(after?.surface.width ?? -1, 0);
  } finally {
    await proj.cleanup();
  }
});

test("crossing the breakpoint re-docks the open drawer without closing it", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nEdit `src/cache.ts` to fix it.\n" });
    await page.setViewportSize(WIDE);
    await page.goto("/");
    await openPreview(page);

    const drawer = page.locator("[data-file-drawer]");
    const handle = page.getByRole("separator", { name: "Resize file preview" });
    await expect(handle).toHaveAttribute("aria-orientation", "vertical");

    // Count every time the lane leaves the DOM, so "it re-docked" can be told
    // apart from "it closed and a new one opened" — the drawer is deliberately
    // NOT keyed on the edge, so the same instance survives and the excerpt is
    // never refetched.
    await page.evaluate(() => {
      const w = window as unknown as { __drawerRemovals: number };
      w.__drawerRemovals = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const node of r.removedNodes) {
            if (node instanceof Element && node.hasAttribute("data-file-drawer")) {
              w.__drawerRemovals += 1;
            }
          }
        }
      }).observe(document.querySelector(".diff-surface") as Node, { childList: true });
    });

    await page.setViewportSize(NARROW);
    await expect(handle).toHaveAttribute("aria-orientation", "horizontal");
    await expect(drawer).toHaveCount(1);
    await expect(page.locator("[data-file-preview] .fp-path")).toHaveText("src/cache.ts");

    await page.setViewportSize(WIDE);
    await expect(handle).toHaveAttribute("aria-orientation", "vertical");
    await expect(page.locator("[data-file-preview] .fp-path")).toHaveText("src/cache.ts");

    expect(
      await page.evaluate(
        () => (window as unknown as { __drawerRemovals: number }).__drawerRemovals,
      ),
    ).toBe(0);
  } finally {
    await proj.cleanup();
  }
});

test("dragging the handle resizes the lane, and each edge remembers its own size", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nEdit `src/cache.ts` to fix it.\n" });
    // Record the bottom lane's height first, so the right-edge drag below has a
    // before-value to be measured against.
    await page.setViewportSize(NARROW);
    await page.goto("/");
    await openPreview(page);
    const bottomBefore = (await laneGeometry(page))?.drawer?.height ?? 0;
    expect(bottomBefore).toBeGreaterThan(0);

    // Re-docking swaps the lane's animation-name, which re-triggers the wipe, so
    // settle again before measuring or aiming a drag at the handle.
    await page.setViewportSize(WIDE);
    await expect(page.getByRole("separator", { name: "Resize file preview" })).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
    await settleDrawer(page);
    const startWidth = (await laneGeometry(page))?.drawer?.width ?? 0;
    expect(startWidth).toBeGreaterThan(0);

    // Drag the handle left by 120px: the lane grows by that much, since the
    // handle sits on the drawer's inner edge.
    const box = await page.getByRole("separator", { name: "Resize file preview" }).boundingBox();
    expect(box).not.toBeNull();
    const y = (box?.y ?? 0) + (box?.height ?? 0) / 2;
    await page.mouse.move((box?.x ?? 0) + (box?.width ?? 0) / 2, y);
    await page.mouse.down();
    await page.mouse.move((box?.x ?? 0) - 120, y, { steps: 8 });
    await page.mouse.up();

    // Bounded on BOTH sides: "greater than" alone would also pass for a
    // regression that snapped the lane to its maximum, or inverted the direction
    // and then clamped there. What is pinned is that it moved by the drag.
    const dragged = startWidth + 120;
    await expect
      .poll(async () => (await laneGeometry(page))?.drawer?.width ?? 0)
      .toBeGreaterThan(dragged - 8);
    expect((await laneGeometry(page))?.drawer?.width ?? 0).toBeLessThan(dragged + 8);

    // The new width survives a reload — it is remembered, not just live state.
    await page.reload();
    await openPreview(page);
    const reloaded = (await laneGeometry(page))?.drawer?.width ?? 0;
    expect(reloaded).toBeGreaterThan(dragged - 8);
    expect(reloaded).toBeLessThan(dragged + 8);

    // Back at the bottom edge, the height is exactly what it was before the
    // right-edge drag: the two edges are remembered under separate keys, so
    // resizing one never carries over as the other's size.
    await page.setViewportSize(NARROW);
    await expect(page.getByRole("separator", { name: "Resize file preview" })).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
    await settleDrawer(page);
    await expect
      .poll(async () => (await laneGeometry(page))?.drawer?.height ?? 0)
      .toBeCloseTo(bottomBefore, 0);
  } finally {
    await proj.cleanup();
  }
});

test("a reference on the plan's last line is still visible once the bottom drawer opens", async ({
  daemon,
  page,
}) => {
  // The drawer takes layout space, so opening it shortens the plan by exactly
  // the space it took — which raises the plan's maximum scroll by the same
  // amount. Together with the scroll-past-the-end room (EXC-772) that makes
  // clearing the reference a guarantee rather than best effort, even for the
  // very last line of the plan.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    const filler = Array.from({ length: 40 }, (_, i) => `Paragraph ${i + 1} of the plan.`).join(
      "\n\n",
    );
    await daemon.seed({
      cwd: proj.dir,
      plan: `# Refs\n\n${filler}\n\nFinally, edit \`src/cache.ts\` to fix it.\n`,
    });
    await page.setViewportSize(NARROW);
    await page.goto("/");
    await planSurface(page);
    await expect.poll(() => fileRefCount(page)).toBe(1);

    // Scroll the plan to its end so the reference is the bottom-most thing on
    // screen — the worst case for a lane opening underneath it.
    await page.locator(PLAN_SURFACE).evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator("[data-file-drawer]")).toBeVisible();

    await expect
      .poll(async () => {
        const token = await page.locator("[data-file-ref]").first().boundingBox();
        const geo = await laneGeometry(page);
        if (token === null || geo === null) return null;
        return {
          clearsBottom: token.y + token.height <= geo.pane.bottom + 1,
          clearsTop: token.y >= geo.pane.top - 1,
        };
      })
      .toEqual({ clearsBottom: true, clearsTop: true });
  } finally {
    await proj.cleanup();
  }
});

test("clicking a second filename swaps the drawer's contents in place", async ({
  daemon,
  page,
}) => {
  // A file-ref token's own click handler reassigns `filePreview` in place, so a
  // click on another filename swaps the drawer's contents on that same click,
  // with nothing between the click and the token handler to spend it.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS, "src/other.ts": OTHER_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nEdit `src/cache.ts` first.\n\nThen edit `src/other.ts` as well.\n",
    });
    await page.setViewportSize(WIDE);
    await page.goto("/");
    await planSurface(page);
    await expect.poll(() => fileRefCount(page)).toBe(2);

    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator("[data-file-preview] .fp-path")).toHaveText("src/cache.ts");

    await page.evaluate(() => {
      const w = window as unknown as { __drawerRemovals: number };
      w.__drawerRemovals = 0;
      new MutationObserver((records) => {
        for (const r of records) {
          for (const node of r.removedNodes) {
            if (node instanceof Element && node.hasAttribute("data-file-drawer")) {
              w.__drawerRemovals += 1;
            }
          }
        }
      }).observe(document.querySelector(".diff-surface") as Node, { childList: true });
    });

    await page.locator("[data-file-ref]").nth(1).click();
    await expect(page.locator("[data-file-preview] .fp-path")).toHaveText("src/other.ts");
    await expect(page.locator("[data-file-preview]")).toContainText("OTHER_MARKER_1");

    // One click, one swap — the lane never closed in between.
    expect(
      await page.evaluate(
        () => (window as unknown as { __drawerRemovals: number }).__drawerRemovals,
      ),
    ).toBe(0);
  } finally {
    await proj.cleanup();
  }
});

test("no surface overflows the viewport at any breakpoint with the drawer open", async ({
  daemon,
  page,
}) => {
  // narrow-regression.e2e.ts sweeps the breakpoints with nothing docked; this is
  // the same guarantee with a lane taking layout space, which is the case that
  // could push the document wider than the window. The drawer is opened once and
  // left open across the sweep, so each width is measured with it docked.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nEdit `src/cache.ts` to fix it.\n" });
    await page.setViewportSize(WIDE);
    await page.goto("/");
    await openPreview(page);

    for (const width of [
      NARROW_WIDTH_PX + 440,
      NARROW_WIDTH_PX,
      NARROW_WIDTH_PX - 160,
      TIGHT_WIDTH_PX,
      MIN_APP_WIDTH_PX,
    ]) {
      await page.setViewportSize({ width, height: 900 });
      // The lane must still be open — a width that closed it would make the
      // overflow check below vacuous.
      await expect(page.locator("[data-file-drawer]")).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), {
          message: `document overflows the ${width}px viewport with the drawer open`,
        })
        .toBeLessThanOrEqual(1);
    }
  } finally {
    await proj.cleanup();
  }
});

test("the lane wipes out again when the preview is dismissed", async ({ daemon, page }) => {
  // The close is the open run backwards on the same dimension, so the pane reads
  // as one object sliding shut. It matters that the drawer stays mounted while
  // it plays — a lane that unmounted first would blink out with no motion at all
  // — so this watches the collapse start, checks the excerpt is still in the
  // lane at that moment, and only then expects it gone.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nEdit `src/cache.ts` to fix it.\n",
    });
    await page.setViewportSize(WIDE);
    await page.goto("/");
    await openPreview(page);

    await page.evaluate(() => {
      const w = window as unknown as { __wipes: string[] };
      w.__wipes = [];
      window.addEventListener(
        "animationstart",
        (e) => {
          const t = e.target as Element | null;
          if (t?.hasAttribute("data-file-drawer")) w.__wipes.push(e.animationName);
        },
        { capture: true },
      );
    });

    // Dismiss through the header's close circle — the pointer's route out; an
    // outside click closes nothing (EXC-1067).
    await page.getByRole("button", { name: "Close preview" }).click();

    // The collapse starts on the lane, and the excerpt is still inside it.
    await expect
      .poll(() =>
        page.evaluate(() =>
          (window as unknown as { __wipes: string[] }).__wipes.some((n) =>
            n.includes("fd-close-right"),
          ),
        ),
      )
      .toBe(true);

    // …and once it has played, the lane is gone and the plan has the room back.
    await expect(page.locator("[data-file-drawer]")).toHaveCount(0);
    const after = await laneGeometry(page);
    expect(after?.pane.width ?? 0).toBeCloseTo(after?.surface.width ?? -1, 0);
  } finally {
    await proj.cleanup();
  }
});

// EXC-1129: the card is placed against the viewport LESS the open lane, so the
// two surfaces the reader is using at once never overlap. A project whose `src`
// holds the referenced file too, so one plan carries both kinds of reference.
// The file is cited FIRST so `openPreview`'s "first reference" is the one that
// opens the lane; the directory below it is what the card then opens on.
const COEXIST = {
  "src/cache.ts": CACHE_TS,
  "src/other.ts": OTHER_TS,
  "src/lib/util.ts": "export {};\n",
};
// The directory token sits well right of the margin on purpose: the card is
// anchored on it, so a token near the left edge would put the card clear of the
// lane without anything having to move it, and the EXC-1137 tests below would
// pass vacuously. They assert the overlap exists before asserting it was
// resolved, so a line that grew long enough to wrap the token back to the margin
// fails loudly rather than going quiet.
const COEXIST_PLAN =
  "# Refs\n\nEdit `src/cache.ts` and `src/other.ts`, both of which live under `src`.\n";

/**
 * Open the excerpt lane, let it settle, then open the folder card beside it.
 *
 * This order is the load-bearing half: placement is computed once, at open, so a
 * card is placed against whatever lane is standing at that instant and a lane
 * opened afterwards deliberately does not move it. Only this order asserts the
 * narrowed bounds; the reverse is the accepted overlap — except when the card's
 * own file row is what opened the lane (EXC-1137), which is the one re-placement
 * and is covered by its own tests below.
 */
async function openLaneThenCard(page: Page): Promise<void> {
  await openPreview(page);
  await page.locator('[data-file-ref="directory"]').click();
  await expect(page.locator("[data-folder-tree]")).toBeVisible();
}

/** Open the folder card with NO lane standing — the starting state for the
 * EXC-1137 re-placement tests, where the row click is what opens the lane. */
async function openCardAlone(page: Page): Promise<void> {
  await planSurface(page);
  await expect.poll(() => fileRefCount(page)).toBeGreaterThan(0);
  await page.locator('[data-file-ref="directory"]').click();
  await expect(page.locator("[data-folder-tree]")).toBeVisible();
}

/** The card's settled viewport box. `toBeVisible` resolves as soon as the card is
 * placed, while `ft-in` is still carrying it up its last 4px — so the rise is
 * awaited before measuring rather than left to sit inside CARD_MARGIN's slack. */
async function cardRect(page: Page): Promise<DOMRect> {
  const el = page.locator("[data-folder-tree]");
  await el.evaluate(async (node) => {
    await Promise.all(node.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
  return el.evaluate((node) => node.getBoundingClientRect().toJSON() as DOMRect);
}

test("at a wide width the card is placed clear of the right-docked lane", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject(COEXIST);
  try {
    await daemon.seed({ cwd: proj.dir, plan: COEXIST_PLAN });
    await page.setViewportSize(WIDE);
    await page.goto("/");
    await openLaneThenCard(page);

    const drawer = (await laneGeometry(page))?.drawer;
    expect(drawer).toBeTruthy();
    expect((await cardRect(page)).right).toBeLessThanOrEqual(drawer!.left);
  } finally {
    await proj.cleanup();
  }
});

test("at a narrow width the card is placed clear of the bottom-docked lane", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject(COEXIST);
  try {
    await daemon.seed({ cwd: proj.dir, plan: COEXIST_PLAN });
    await page.setViewportSize(NARROW);
    await page.goto("/");
    await openLaneThenCard(page);

    const drawer = (await laneGeometry(page))?.drawer;
    expect(drawer).toBeTruthy();
    expect((await cardRect(page)).bottom).toBeLessThanOrEqual(drawer!.top);
  } finally {
    await proj.cleanup();
  }
});

// EXC-1137: the one exception to placement-once. A file row opened from the card
// is the reader asking for the lane, so the card steps out of the box it just
// created rather than sitting under it. The lane is measured mid-wipe here — it
// is opening as the card re-places — which is why the card reads its settled
// edge rather than its rect.
test("a lane opened from a file row pushes the card clear of it", async ({ daemon, page }) => {
  const proj = await makeProject(COEXIST);
  try {
    await daemon.seed({ cwd: proj.dir, plan: COEXIST_PLAN });
    await page.setViewportSize(WIDE);
    await page.goto("/");
    await openCardAlone(page);

    // The card is where a lane would land: without the re-place it would be sat
    // under one. Asserted rather than assumed, so the test cannot go vacuous if
    // the plan text or the card's width ever changes.
    const before = await cardRect(page);
    await page.locator('[data-folder-tree] [data-item-path="other.ts"]').click();
    await expect(page.locator("[data-file-preview] .fp-path")).toHaveText("src/other.ts");
    // `.fp-path` paints the PROP, so it resolves in the lane's loading state, a
    // few ms into the wipe — every rect below would be read off a lane still a
    // sliver of its settled width. The app measures mid-wipe on purpose (that is
    // what `laneEdge` is for); the assertion must not.
    await settleDrawer(page);

    const drawer = (await laneGeometry(page))?.drawer;
    expect(drawer).toBeTruthy();
    expect(before.right).toBeGreaterThan(drawer!.left);
    expect((await cardRect(page)).right).toBeLessThanOrEqual(drawer!.left);
  } finally {
    await proj.cleanup();
  }
});

test("at a narrow width the row-opened lane pushes the card clear of the bottom dock", async ({
  daemon,
  page,
}) => {
  // The more interesting half of the re-place: `cardBounds` shortens the box's
  // HEIGHT for a bottom dock, which is the dimension `anchorCard` can respond to
  // by flipping the card above its anchor rather than merely sliding it. The right
  // dock only narrows width, where the clamp slides.
  const proj = await makeProject(COEXIST);
  try {
    await daemon.seed({ cwd: proj.dir, plan: COEXIST_PLAN });
    await page.setViewportSize(NARROW);
    await page.goto("/");
    await openCardAlone(page);

    const before = await cardRect(page);
    await page.locator('[data-folder-tree] [data-item-path="other.ts"]').click();
    await expect(page.locator("[data-file-preview] .fp-path")).toHaveText("src/other.ts");
    await settleDrawer(page);

    const drawer = (await laneGeometry(page))?.drawer;
    expect(drawer).toBeTruthy();
    expect(before.bottom).toBeGreaterThan(drawer!.top);
    expect((await cardRect(page)).bottom).toBeLessThanOrEqual(drawer!.top);
  } finally {
    await proj.cleanup();
  }
});

test("a lane the reader opened from the plan leaves the card where it is", async ({
  daemon,
  page,
}) => {
  // The other side of the rule, and the case that makes the re-place imperative
  // rather than reactive. The card is placed with no lane standing; a lane then
  // opens from the PLAN, which deliberately does not move it (EXC-1129's accepted
  // overlap). A row clicked now is not a closed-to-open transition, so the card
  // stays put — overlapping — rather than tidying up after a lane it did not open.
  //
  // Opening the lane FIRST would make this vacuous: the card would already be
  // placed against that lane, so a re-place would recompute the same two numbers
  // and the test would pass with the guard deleted.
  const proj = await makeProject(COEXIST);
  try {
    await daemon.seed({ cwd: proj.dir, plan: COEXIST_PLAN });
    await page.setViewportSize(WIDE);
    await page.goto("/");
    await openCardAlone(page);

    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator("[data-file-drawer]")).toBeVisible();
    await settleDrawer(page);

    const before = await cardRect(page);
    const drawer = (await laneGeometry(page))?.drawer;
    expect(drawer).toBeTruthy();
    // The overlap is what a re-place would resolve, so its presence is what makes
    // "the card did not move" a claim rather than a coincidence.
    expect(before.right).toBeGreaterThan(drawer!.left);

    await page.locator('[data-folder-tree] [data-item-path="other.ts"]').click();
    // The lane swapped contents, so the click did act — a card that did not move
    // because nothing happened would be a different, and passing, test.
    await expect(page.locator("[data-file-preview] .fp-path")).toHaveText("src/other.ts");
    await settleDrawer(page);

    const after = await cardRect(page);
    expect(after.top).toBe(before.top);
    expect(after.left).toBe(before.left);
  } finally {
    await proj.cleanup();
  }
});

test("a row clicked during the lane's closing wipe still pushes the card clear", async ({
  daemon,
  page,
}) => {
  // The lane stays mounted for the length of its closing wipe, so "is a lane
  // open?" asked inside that window has two answers: an element is there, and it
  // is leaving. This click re-opens it — cancelling the pending unmount, so the
  // lane comes straight back at full size — which makes it the closed-to-open
  // transition that owes the card a re-place. Reading the element's presence
  // alone would answer "already open" and skip it, leaving the card under a lane
  // it never measured.
  const proj = await makeProject(COEXIST);
  try {
    await daemon.seed({ cwd: proj.dir, plan: COEXIST_PLAN });
    await page.setViewportSize(WIDE);
    await page.goto("/");
    await openCardAlone(page);

    // A lane opened from the PLAN, which correctly does not move the card
    // (EXC-1129) — so the card is still placed against the whole viewport.
    await page.locator("[data-file-ref]").first().click();
    await expect(page.locator("[data-file-drawer]")).toBeVisible();
    await settleDrawer(page);
    const before = await cardRect(page);

    // Dismiss, and click a row without waiting out the wipe. Both clicks and the check
    // between them run in ONE page task, because the window they have to land in is
    // 140ms of wall clock — DiffPlanView holds the lane with a `CLOSE_ANIM_MS` timer —
    // and a driver round trip is not something this test can afford to spend inside it.
    // Driven from here the whole handoff costs a millisecond or two at any host load;
    // driven across the process boundary it overruns the window on a loaded one, and the
    // closing state is simply gone by the time the assertion arrives (EXC-1193).
    //
    // `element.click()` rather than Playwright's: the tree's activation surface is a
    // single `click` listener covering pointer and keyboard alike (FolderTree.svelte),
    // so this reaches the same handler the real gesture does.
    const sawClosing = await page
      .locator('[data-folder-tree] [data-item-path="other.ts"]')
      .evaluate(async (row) => {
        document.querySelector<HTMLElement>(".fp-close")?.click();
        // Svelte flushes on a microtask, so the closing flag lands a tick after the
        // click rather than synchronously with it.
        let closing = false;
        for (let i = 0; i < 40 && !closing; i++) {
          const lane = document.querySelector("[data-file-drawer]");
          closing = lane?.matches("[data-file-drawer-closing]") ?? false;
          if (!closing) await new Promise((resolve) => setTimeout(resolve, 1));
        }
        (row as HTMLElement).click();
        return closing;
      });
    // Recorded rather than asserted against the live DOM: the lane really was mid-wipe
    // when the row was clicked, which is the premise the rest of this test rests on.
    expect(sawClosing).toBe(true);
    await expect(page.locator("[data-file-preview] .fp-path")).toHaveText("src/other.ts");
    await settleDrawer(page);

    const drawer = (await laneGeometry(page))?.drawer;
    expect(drawer).toBeTruthy();
    expect(before.right).toBeGreaterThan(drawer!.left);
    expect((await cardRect(page)).right).toBeLessThanOrEqual(drawer!.left);
  } finally {
    await proj.cleanup();
  }
});

test("Escape plays the same closing wipe", async ({ daemon, page }) => {
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    await daemon.seed({ cwd: proj.dir, plan: "# Refs\n\nEdit `src/cache.ts` to fix it.\n" });
    await page.setViewportSize(NARROW);
    await page.goto("/");
    await openPreview(page);

    await page.evaluate(() => {
      const w = window as unknown as { __wipes: string[] };
      w.__wipes = [];
      window.addEventListener(
        "animationstart",
        (e) => {
          const t = e.target as Element | null;
          if (t?.hasAttribute("data-file-drawer")) w.__wipes.push(e.animationName);
        },
        { capture: true },
      );
    });

    // Safe mode swallows keystrokes for a beat after the view gains focus, so
    // retry the press until the lane actually starts leaving.
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(page.locator("[data-file-drawer]")).toHaveCount(0, { timeout: 500 });
    }).toPass();

    // The bottom dock collapses on its own dimension, not the right one's.
    const wipes = await page.evaluate(() => (window as unknown as { __wipes: string[] }).__wipes);
    expect(wipes.some((n) => n.includes("fd-close-bottom"))).toBe(true);
    expect(wipes.some((n) => n.includes("fd-close-right"))).toBe(false);
  } finally {
    await proj.cleanup();
  }
});
