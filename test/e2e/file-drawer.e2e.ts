// The file preview's container (EXC-937). file-refs.e2e.ts owns the reference
// layer — what gets marked, what the excerpt says, how it is dismissed; this
// spec owns the drawer the excerpt lives in: which edge it docks to, that it
// takes layout space instead of covering the plan, that it resizes and remembers
// its size per edge, and that a second filename swaps its contents in place.
//
// All of it is layout a browser decides (doc/agents/browser-testing.md): the
// docking edge comes from a live matchMedia subscription, the sizes from real
// rects, and the drag from real pointer events. The clamping math itself stays a
// unit (ui/src/lib/fileDrawer.test.ts).

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
function laneGeometry(page: import("@playwright/test").Page): Promise<{
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
async function openPreview(page: import("@playwright/test").Page): Promise<void> {
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
      // getAnimations() call: the wipe runs for --dur-base (180ms) and then
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
