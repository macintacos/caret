import { defineConfig, devices } from "@playwright/test";
import { TOC_BREAKPOINT_PX } from "./ui/src/lib/layout.ts";

// Real-browser e2e for the review UI (EXC-453). Specs are named *.e2e.ts so
// `bun test` (which collects *.test.ts AND *.spec.ts repo-wide) never picks
// them up — the two runners stay disjoint. Each test boots its own isolated
// daemon via e2e/support/fixtures.ts (OS-assigned port, ephemeral state), so
// there is no static baseURL or webServer here.
export default defineConfig({
  testDir: "e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  retries: 0,
  forbidOnly: true,
  // Non-interactive reporter so the preflight gate can't hang on a TTY pager.
  reporter: "list",
  use: {
    // Failure artifacts only; they can capture rendered plan text, so they
    // stay gitignored and local (never-log-identifiable-data posture).
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // After the device spread (which pins 1280x720): the contents rail
        // (Toc.svelte) is display:none below the shared breakpoint, so the
        // viewport is derived from it with headroom — a breakpoint change moves
        // the viewport in lockstep instead of leaving it coupled by prose.
        viewport: { width: TOC_BREAKPOINT_PX + 200, height: 900 },
      },
    },
  ],
});
