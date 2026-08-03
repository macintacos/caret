// Shared scaffolding for the filename-reference specs (file-refs, file-drawer).
// Both need a real project on disk for the daemon subprocess to resolve against,
// and both wait on the same shadow-root tagging before they can click a token.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Page } from "@playwright/test";

/** Write a throwaway project dir with the given files, returning its path and a
 * cleanup. The daemon (a real subprocess) reads it via the seeded review's cwd. */
export async function makeProject(files: Record<string, string>): Promise<{
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

/** The number of file-reference icons currently tagged in the plan's shadow root.
 * Resolution is a daemon round-trip, so specs poll this before clicking a token. */
export function fileRefCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const sh = (document.querySelector(".diffview") as HTMLElement)?.shadowRoot ?? null;
    return sh?.querySelectorAll("[data-file-ref]").length ?? 0;
  });
}

/**
 * Resolve once the preview drawer's opening wipe has finished. The lane animates
 * its docking dimension from 0, so every rect inside it — and the coordinates a
 * drag is aimed at — keeps moving until the animation ends. Awaiting the
 * animation is exact and returns instantly once it is done, including under
 * reduced motion, where the global guard leaves nothing to wait for.
 */
export async function settleDrawer(page: Page): Promise<void> {
  await page.locator("[data-file-drawer]").evaluate(async (el) => {
    // A re-dock swaps animation-name mid-wipe, which cancels the running
    // animation and rejects its `finished` with AbortError. Cancelled is settled
    // for our purposes, so swallow it rather than failing the spec.
    await Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined)));
  });
}
