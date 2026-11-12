// How much script the app runs per frame while a drawer drag rewraps a long preview. The
// frames come from the browser's own long-animation-frame timing, so this is e2e: happy-dom
// has no layout to make a frame long. Only the app bundle's scripts are bounded — a GC
// pause or a contended host lengthens frames the app spent no script in.
//
// A retained trace snapshots the DOM on every action, which the probe would report as the
// app's frames. Playwright allows `trace` only at a file's top level, hence its own file.

import type { Page } from "@playwright/test";

import { sourceToggle } from "@test/e2e/support/chrome.ts";
import { CACHE_TS, openPreview, ROWS_PROSE, WIDE } from "@test/e2e/support/drawer.ts";
import { makeProject } from "@test/e2e/support/file-refs.ts";
import { expect, test, waitPastSafeModeGrace } from "@test/e2e/support/fixtures.ts";
import { PLAN_PREVIEW, planSurface } from "@test/e2e/support/source-view.ts";

test.use({ trace: "off" });

/** Longest single app-bundle script, in ms, a frame may run during the quickest drag. A fresh
 * Range per line read ran 59–124ms here under parallel workers; one reused range, at most 43. */
const APP_SCRIPT_BUDGET_MS = 50;

/** Drags measured, at most; the first under budget ends the test. */
const SAMPLES = 5;

interface LongFrame {
  duration: number;
  scripts: { sourceURL: string; duration: number }[];
}

type LoafWindow = Window & {
  __loaf: LongFrame[];
  __loafObserver: PerformanceObserver;
  __loafRecord: (entries: PerformanceEntryList) => void;
};

const nextFrames = (page: Page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );

function armLongFrames(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as LoafWindow;
    w.__loaf = [];
    w.__loafRecord = (entries) => {
      for (const e of entries as unknown as LongFrame[]) {
        w.__loaf.push({
          duration: e.duration,
          scripts: e.scripts.map((s) => ({ sourceURL: s.sourceURL, duration: s.duration })),
        });
      }
    };
    w.__loafObserver = new PerformanceObserver((list) => w.__loafRecord(list.getEntries()));
    w.__loafObserver.observe({ type: "long-animation-frame" });
  });
}

function longFrames(page: Page): Promise<LongFrame[]> {
  return page.evaluate(() => {
    const w = window as unknown as LoafWindow;
    w.__loafRecord(w.__loafObserver.takeRecords());
    w.__loafObserver.disconnect();
    return w.__loaf;
  });
}

async function openLongPreview(page: Page): Promise<void> {
  await page.goto("/");
  await planSurface(page);
  await waitPastSafeModeGrace(page);
  // The first gesture unlocks audio in one long frame; spend it here, not in the drag.
  await openPreview(page);
  await sourceToggle(page).click();
  await expect(page.locator(PLAN_PREVIEW)).toBeVisible();
}

/** Drags the drawer wider and reports the frames it ran long, plus the longest single
 * app-bundle script among them. */
async function dragSample(page: Page): Promise<{ longest: number; frames: LongFrame[] }> {
  const box = await page.getByRole("separator", { name: "Resize file preview" }).boundingBox();
  if (!box) throw new Error("the handle did not render");

  await nextFrames(page);
  await armLongFrames(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 300, y, { steps: 30 });
  await page.mouse.up();
  await nextFrames(page);

  const frames = await longFrames(page);
  const appScripts = frames.flatMap((f) =>
    f.scripts.filter((s) => new URL(s.sourceURL || "about:blank").pathname.startsWith("/assets/")),
  );
  return { longest: Math.max(0, ...appScripts.map((s) => s.duration)), frames };
}

test("a drawer drag over a long plan with many comments runs no long app script while it moves", async ({
  daemon,
  page,
}) => {
  const proj = await makeProject({ "src/cache.ts": CACHE_TS });
  try {
    const paragraphs = Array.from({ length: 300 }, (_, i) => `Paragraph ${i + 1}. ${ROWS_PROSE}`);
    const plan = ["# Refs", "Edit `src/cache.ts` to fix it.", ...paragraphs].join("\n\n");
    // Re-applied on every load, so each sample's drag starts from the same layout.
    await page.addInitScript(() => {
      localStorage.setItem("caret.planOutline", "hidden");
      localStorage.setItem("caret.planView", "source");
      localStorage.removeItem("caret.fileDrawer.width");
    });
    const id = await daemon.seed({ cwd: proj.dir, plan });
    const lines = ((await daemon.getReview(id)).body?.currentPlan ?? "").split("\n");
    const starts = lines.flatMap((l, i) => (l.startsWith("Paragraph ") ? [i + 1] : []));
    await daemon.putDraft(id, {
      annotations: Array.from({ length: 30 }, (_, i) => {
        const line = starts[i * 10] ?? 1;
        return { id: `ann-${i}`, startLine: line, endLine: line, comment: `note ${i}` };
      }),
    });
    await page.setViewportSize(WIDE);

    // Host contention only adds time, so the quickest of several drags is the code's own cost.
    // Each drag gets a fresh page: a second drag on the same one runs after GC has swept the
    // live ranges a regression leaves, and so misses it.
    const samples: { longest: number; frames: LongFrame[] }[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      await openLongPreview(page);
      const sample = await dragSample(page);
      samples.push(sample);
      if (sample.longest < APP_SCRIPT_BUDGET_MS) break;
    }
    const quickest = Math.min(...samples.map((s) => s.longest));
    expect(quickest, JSON.stringify(samples)).toBeLessThan(APP_SCRIPT_BUDGET_MS);
  } finally {
    await proj.cleanup();
  }
});
