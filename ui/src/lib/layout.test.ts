import { describe, expect, test } from "bun:test";

import { REFERENCE_WIDTH_PX } from "$lib/layout.ts";

// playwright.config.ts derives its e2e viewport width from REFERENCE_WIDTH_PX
// (with headroom) so the e2e layout tracks the reference width instead of being
// coupled to it by prose alone. This test parses the viewport width straight out
// of the config source and asserts it sits above the reference width — a config
// edit that drops the viewport below the reference (or decouples it from the
// constant) fails here.

const CONFIG_PATH = new URL("../../../playwright.config.ts", import.meta.url).pathname;

describe("reference width ↔ playwright viewport", () => {
  test("the e2e viewport is derived from REFERENCE_WIDTH_PX with headroom", async () => {
    const config = await Bun.file(CONFIG_PATH).text();
    // The config sets `viewport: { width: REFERENCE_WIDTH_PX + N, ... }`.
    const match = config.match(/width:\s*REFERENCE_WIDTH_PX\s*\+\s*(\d+)/);
    expect(match).not.toBeNull();
    const headroom = Number(match![1]);
    expect(headroom).toBeGreaterThan(0);
    expect(REFERENCE_WIDTH_PX + headroom).toBeGreaterThan(REFERENCE_WIDTH_PX);
  });
});
