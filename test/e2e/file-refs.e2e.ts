// Intelligent hovering over filename references (EXC-687). The plan renders as
// markdown source through @pierre/diffs; a path-shaped token that resolves to a
// real file in the review's cwd gets a file icon (its token tagged data-file-ref
// in the shadow root) and, on hover, a syntax-highlighted excerpt popover. The
// resolve + read + shadow-DOM token tagging + real hover only exist in a browser
// against a real daemon reading a real cwd, so they are exercised here; the pure
// detection, resolution, and excerpt math stay units (fileRefs / fileRefTag /
// plan-files / api tests).
//
// The daemon is a real subprocess reading the local filesystem, so each test
// writes a synthetic project dir and seeds a review whose cwd points at it. The
// content is throwaway, non-identifying scaffolding — never a real plan.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "./support/fixtures.ts";

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

    // Hovering the missing reference reveals no preview — it gives no impression
    // of being a link. Target the token in the shadow surface, give the pointer
    // pipeline a beat, then assert nothing appeared.
    const ghost = page.locator(".diffview").getByText("src/ghost.ts", { exact: false });
    await expect(ghost.first()).toBeVisible();
    await ghost.first().hover();
    const t0 = await page.evaluate(() => performance.now());
    await page.waitForFunction((t) => performance.now() > t + 300, t0);
    await expect(page.locator("[data-file-preview]")).toHaveCount(0);
  } finally {
    await proj.cleanup();
  }
});

test("hovering a real reference reveals a highlighted excerpt centered on its line", async ({
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

    // Wait for the icon (async resolve), then hover the tagged token.
    await expect.poll(() => fileRefCount(page)).toBe(1);
    await page.locator("[data-file-ref]").first().hover();

    // The preview appears (light DOM, not the shadow root) with the resolved path
    // and a window centered on line 42 — so the line-42 marker shows and the
    // line-1 marker (outside ±12) does not.
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("src/cache.ts");
    await expect(preview).toContainText("MARKER_LINE_FORTYTWO");
    await expect(preview).not.toContainText("MARKER_LINE_ONE");

    // The excerpt is syntax-highlighted, not plain: shiki wraps it in <pre.shiki>.
    await expect(preview.locator("pre.shiki")).toHaveCount(1);

    // Leaving dismisses it (after the short travel grace).
    await page.mouse.move(0, 0);
    await expect(preview).toHaveCount(0);
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
    await page.locator("[data-file-ref]").first().hover();

    // No line number → the excerpt starts at the top, so the line-1 marker shows
    // and the line-42 marker (past the head window) does not.
    const preview = page.locator("[data-file-preview]");
    await expect(preview).toBeVisible();
    await expect(preview).toContainText("MARKER_LINE_ONE");
    await expect(preview).not.toContainText("MARKER_LINE_FORTYTWO");
  } finally {
    await proj.cleanup();
  }
});
