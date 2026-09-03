// Shared assertion for DiffPlanView.test.ts and lib/diffview/SourceView.test.ts:
// both prove a content-key/version change recreates the @pierre/diffs instance
// rather than updating it in place.
import { expect } from "bun:test";

import { until } from "@test/support/poll.ts";

/** Assert a content swap recreated the view: the new text painted, the `<pre>`
 * is a new element (not the one from before the swap), and the old text is
 * gone. `getShadow` reads the current shadow root fresh each poll, so it works
 * whether the caller wraps SourceView (DiffPlanView) or mounts it directly. */
export async function expectViewRecreated(
  getShadow: () => ShadowRoot | null | undefined,
  oldPre: Element | null | undefined,
  newText: string,
  oldText: string,
): Promise<void> {
  const repainted = await until(() => getShadow()?.textContent?.includes(newText) ?? false);
  expect(repainted).toBe(true);
  expect(getShadow()?.querySelector("pre")).not.toBe(oldPre);
  expect(getShadow()?.textContent).not.toContain(oldText);
}
