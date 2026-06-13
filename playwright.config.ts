import { defineConfig, devices } from "@playwright/test";
import { REFERENCE_WIDTH_PX } from "./ui/src/lib/layout.ts";

// Real-browser e2e for the review UI (EXC-453). Specs are named *.e2e.ts so
// `bun test` (which collects *.test.ts AND *.spec.ts repo-wide) never picks
// them up — the two runners stay disjoint. Each test boots its own isolated
// daemon via test/e2e/support/fixtures.ts (OS-assigned port, ephemeral state),
// so there is no static baseURL or webServer here.
export default defineConfig({
  testDir: "test/e2e",
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
        // After the device spread (which pins 1280x720): widen to the reference
        // layout width plus headroom so the source view and its contents pane
        // both have room — derived from the constant so the e2e viewport tracks
        // the reference width instead of being coupled to it by prose.
        viewport: { width: REFERENCE_WIDTH_PX + 200, height: 900 },
      },
    },
  ],
});
