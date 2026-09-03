import type { TocHeading } from "$lib/toc.ts";

/** A three-level plan: "Details" sits under "Approach", which shares its level
 * with "Verification". Reading line 9 therefore trails Overview > Approach >
 * Details, and a crumb's menu or the ToC filter both offer Approach and
 * Verification alongside it. Shared by PlanToc.test.ts and
 * PlanBreadcrumbs.test.ts, which read the same shape against their own
 * surfaces. */
export const HEADINGS: TocHeading[] = [
  { level: 1, text: "Overview", line: 1 },
  { level: 2, text: "Approach", line: 5 },
  { level: 3, text: "Details", line: 9 },
  { level: 2, text: "Verification", line: 20 },
];

/** Let a pressed key go, on `window`, where both nav surfaces' hold-to-repeat
 * listens. Every press dispatched against either surface is a PRESS, so each
 * one ends here: a keydown with no keyup leaves a real 250ms run armed
 * (EXC-1122) that outlives the test and walks a panel a later one is
 * asserting against — which a browser never does, since a press always ends. */
export const releaseKey = (key: string) =>
  window.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
