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
import { NARROW_WIDTH_PX } from "@ui/src/lib/layout.ts";

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
  await expect(page.locator(".diff-plan")).toBeVisible();
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

    await page.setViewportSize(WIDE);
    await expect(page.getByRole("separator", { name: "Resize file preview" })).toHaveAttribute(
      "aria-orientation",
      "vertical",
    );
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

    const dragged = startWidth + 120;
    await expect
      .poll(async () => (await laneGeometry(page))?.drawer?.width ?? 0)
      .toBeGreaterThan(dragged - 8);

    // The new width survives a reload — it is remembered, not just live state.
    await page.reload();
    await openPreview(page);
    await expect
      .poll(async () => (await laneGeometry(page))?.drawer?.width ?? 0)
      .toBeGreaterThan(dragged - 8);

    // Back at the bottom edge, the height is exactly what it was before the
    // right-edge drag: the two edges are remembered under separate keys, so
    // resizing one never carries over as the other's size.
    await page.setViewportSize(NARROW);
    await expect(page.getByRole("separator", { name: "Resize file preview" })).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
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
    await expect(page.locator(".diff-plan")).toBeVisible();
    await expect.poll(() => fileRefCount(page)).toBe(1);

    // Scroll the plan to its end so the reference is the bottom-most thing on
    // screen — the worst case for a lane opening underneath it.
    await page.locator(".diff-plan").evaluate((el) => {
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
  // The dismissal handler swallows the first click outside the lane, so without
  // a carve-out a click on another filename would only close the drawer. A click
  // whose path contains a file-ref token passes through instead, so the token
  // handler fires and the drawer's contents change on that same click.
  const proj = await makeProject({ "src/cache.ts": CACHE_TS, "src/other.ts": OTHER_TS });
  try {
    await daemon.seed({
      cwd: proj.dir,
      plan: "# Refs\n\nEdit `src/cache.ts` first.\n\nThen edit `src/other.ts` as well.\n",
    });
    await page.setViewportSize(WIDE);
    await page.goto("/");
    await expect(page.locator(".diff-plan")).toBeVisible();
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
