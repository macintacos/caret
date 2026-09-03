// Assertions over the daemon's own review record — the annotation and decision
// state a UI gesture is supposed to have persisted. Shared because the same
// polls show up wherever a spec drives the composer or the Request Changes
// dialog and then checks what actually reached the daemon (typescript-rules.md
// § Shared-helper policy).

import type { Locator, Page } from "@playwright/test";

import { type Daemon, expect } from "@test/e2e/support/fixtures.ts";
import type { ClientReview } from "@/lib/types.ts";

/** Poll until the review's persisted annotation count reaches `count`. */
export async function awaitAnnotationCount(
  daemon: Daemon,
  id: string,
  count: number,
): Promise<void> {
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.length ?? 0)
    .toBe(count);
}

/** Poll until exactly one annotation is persisted, then assert it matches
 * `expected`. */
export async function expectSingleAnnotation(
  daemon: Daemon,
  id: string,
  expected: Record<string, unknown>,
): Promise<void> {
  await awaitAnnotationCount(daemon, id, 1);
  const ann = (await daemon.getReview(id)).body?.annotations?.[0];
  expect(ann).toMatchObject(expected);
}

/** Poll until the review's persisted composer-scratch count reaches `count`. */
export async function awaitScratchCount(daemon: Daemon, id: string, count: number): Promise<void> {
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.composerScratches?.length ?? 0)
    .toBe(count);
}

/** Poll until the review's first annotation's comment reads `comment` —
 * the composer submit tests, which assert on the edited text rather than the
 * line span. */
export async function awaitAnnotationComment(
  daemon: Daemon,
  id: string,
  comment: string,
): Promise<void> {
  await expect
    .poll(async () => (await daemon.getReview(id)).body?.annotations?.[0]?.comment)
    .toBe(comment);
}

/** Poll until the review resolves as a denial (Request Changes), then return
 * the resulting review body — `decision.feedback` is what nearly every caller
 * wants, but the full body is returned since a couple also check `status`. */
export async function awaitDenied(daemon: Daemon, id: string): Promise<ClientReview | undefined> {
  await expect.poll(async () => (await daemon.getReview(id)).body?.decision?.behavior).toBe("deny");
  return (await daemon.getReview(id)).body;
}

/** Click a Request Changes dialog's submit, wait for the review to leave the
 * pending list, and return the feedback the denial carried. */
export async function submitForRevision(
  page: Page,
  dialog: Locator,
  daemon: Daemon,
  id: string,
): Promise<string> {
  await dialog.getByRole("button", { name: "Send for revision" }).click();
  await expect(page.getByRole("heading", { name: "No plans awaiting review" })).toBeVisible();
  return (await awaitDenied(daemon, id))?.decision?.feedback ?? "";
}
