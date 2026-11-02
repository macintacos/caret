// Shared scaffolding for the filename-reference specs (file-refs, file-drawer).
// Both need a real project on disk for the daemon subprocess to resolve against,
// and both wait on the same shadow-root tagging before they can click a token.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { Locator, Page } from "@playwright/test";

import type { Daemon } from "@test/e2e/support/fixtures.ts";
import { expect } from "@test/e2e/support/fixtures.ts";
import { planSurface } from "@test/e2e/support/source-view.ts";

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
 * Resolve once the preview drawer has slid into place, and the plan beside it with
 * any outline column it folded. Until then every rect in the body, and the
 * coordinates a drag is aimed at, keeps moving. Awaiting the slides is exact and
 * returns instantly once they are done, including under reduced motion, where the
 * global guard leaves nothing to wait for.
 */
export async function settleDrawer(page: Page): Promise<void> {
  await page.locator("[data-file-drawer]").evaluate(async (el) => {
    const body = el.closest(".plan-body") ?? el;
    // A slide another one interrupts is cancelled, which rejects its `finished` with
    // AbortError. Cancelled is settled for our purposes, so swallow it rather than
    // failing the spec.
    await Promise.all(
      body
        .getAnimations({ subtree: true })
        .filter((a) => a instanceof CSSTransition)
        .map((a) => a.finished.catch(() => undefined)),
    );
  });
}

/** Seed `plan` in a project at `cwd`, open it, and wait until exactly `refCount`
 * file references are tagged — the arrange every file-refs spec opens with,
 * before it decides which token to click. */
export async function seedFileRefs(
  page: Page,
  daemon: Daemon,
  cwd: string,
  plan: string,
  refCount = 1,
): Promise<void> {
  await daemon.seed({ cwd, plan });
  await page.goto("/");
  await planSurface(page);
  await expect.poll(() => fileRefCount(page)).toBe(refCount);
}

/** `seedFileRefs`, then click the first tagged reference and wait for its
 * preview to open. */
export async function openFileRefPreview(
  page: Page,
  daemon: Daemon,
  cwd: string,
  plan: string,
  opts: { refCount?: number } = {},
): Promise<Locator> {
  const { refCount = 1 } = opts;
  await seedFileRefs(page, daemon, cwd, plan, refCount);
  await page.locator("[data-file-ref]").first().click();
  const preview = page.locator("[data-file-preview]");
  await expect(preview).toBeVisible();
  return preview;
}
