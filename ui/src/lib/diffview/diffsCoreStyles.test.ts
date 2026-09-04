// Drift guard: diffsCoreStyles.ts is a verbatim copy of @pierre/diffs's core
// stylesheet. If a @pierre/diffs upgrade changes it, this fails — regenerate
// diffsCoreStyles.ts from the library's dist/style.js default export.

import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import { DIFFS_CORE_STYLES } from "$lib/diffview/diffsCoreStyles.ts";

describe("diffs core styles", () => {
  test("carries the structural grid the content column depends on", () => {
    expect(DIFFS_CORE_STYLES).toContain("[data-code]");
    expect(DIFFS_CORE_STYLES).toContain("grid");
    expect(DIFFS_CORE_STYLES.length).toBeGreaterThan(1000);
  });

  test("stays verbatim with the pinned @pierre/diffs core stylesheet", async () => {
    const styleModule = join(
      import.meta.dir,
      "../../../../node_modules/@pierre/diffs/dist/style.js",
    );
    const source = await Bun.file(styleModule).text();
    // dist/style.js is `var style_default = "<json string>"; export default ...`.
    const match = source.match(/style_default\s*=\s*("(?:[^"\\]|\\.)*")/s);
    const literal = match?.[1];
    expect(literal).toBeDefined();
    const upstream = JSON.parse(literal as string) as string;
    expect(DIFFS_CORE_STYLES).toBe(upstream);
  });
});
