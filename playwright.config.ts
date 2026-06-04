import { defineConfig, devices } from "@playwright/test";

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
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
