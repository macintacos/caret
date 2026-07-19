import { describe, expect, test } from "bun:test";

import { readAppCss } from "$lib/appCss.ts";
import {
  MIN_APP_WIDTH_PX,
  NARROW_WIDTH_PX,
  REFERENCE_WIDTH_PX,
  TIGHT_WIDTH_PX,
} from "$lib/layout.ts";

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

// The width-foundation tokens (EXC-806) are the shared substrate the responsive
// tickets (EXC-807–814) consume. The values live once in layout.ts (node-free,
// importable by e2e) and are MIRRORED as `--w-*` custom properties in app.css so
// surfaces have a retint-safe vocabulary. @media conditions can't read var(), so
// the mirror is the drift risk this suite guards: it asserts each CSS token equals
// its TS constant, mirroring the layout↔config coupling above and the
// css-bridge / motion token-pinning tests.
const appCss = readAppCss();

describe("width foundation tokens ↔ app.css", () => {
  test("the breakpoint constants form a coherent floor < tight < narrow < reference ramp", () => {
    expect(MIN_APP_WIDTH_PX).toBeLessThan(TIGHT_WIDTH_PX);
    expect(TIGHT_WIDTH_PX).toBeLessThan(NARROW_WIDTH_PX);
    expect(NARROW_WIDTH_PX).toBeLessThan(REFERENCE_WIDTH_PX);
  });

  test("app.css :root mirrors each width constant as a --w-* token", () => {
    expect(appCss).toContain(`--w-min: ${MIN_APP_WIDTH_PX}px`);
    expect(appCss).toContain(`--w-narrow: ${NARROW_WIDTH_PX}px`);
    expect(appCss).toContain(`--w-tight: ${TIGHT_WIDTH_PX}px`);
  });

  test(".shell sets a min-width floor from the --w-min token", () => {
    // The floor is what makes the app scroll horizontally below the supported
    // minimum instead of collapsing further; it consumes the token, not a literal.
    const shellBlock = appCss.match(/\.shell\s*\{[^}]*\}/);
    expect(shellBlock).not.toBeNull();
    expect(shellBlock![0]).toMatch(/min-width:\s*var\(--w-min\)/);
  });
});
