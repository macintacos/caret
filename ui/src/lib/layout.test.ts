import { describe, expect, test } from "bun:test";
import { TOC_BREAKPOINT_PX } from "./layout.ts";

// The responsive breakpoint can't live in a CSS custom property (media-query
// conditions can't read them), so it is hand-written into three `@media (width
// ... 1400px)` rules. This test parses each rule's px value straight out of its
// source and asserts it matches TOC_BREAKPOINT_PX — a CSS edit that drifts from
// the constant (or from playwright.config.ts, which derives its viewport from
// the same constant) fails here.

// Each source whose `@media (width ... <N>px)` rule must match the constant.
const SOURCES: Array<[label: string, path: string]> = [
  ["app.css", "../app.css"],
  ["Toc.svelte", "../components/Toc.svelte"],
  ["PlanView.svelte", "../components/PlanView.svelte"],
];

/** Every breakpoint px value declared in `@media (width <op> Npx)` rules. */
function mediaBreakpoints(css: string): number[] {
  return [...css.matchAll(/@media\s*\(\s*width\s*[<>]=?\s*(\d+)px\s*\)/g)].map((m) => Number(m[1]));
}

describe("Toc breakpoint ↔ CSS sources sync", () => {
  for (const [label, relPath] of SOURCES) {
    test(`${label} @media width rules use TOC_BREAKPOINT_PX`, async () => {
      const css = await Bun.file(new URL(relPath, import.meta.url).pathname).text();
      const values = mediaBreakpoints(css);
      // Each source must declare exactly one width breakpoint, and it must be
      // the shared constant. A new/changed value here means the rail's
      // show/hide threshold drifted from the single source of truth.
      expect(values).toEqual([TOC_BREAKPOINT_PX]);
    });
  }
});
