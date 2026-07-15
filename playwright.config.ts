import { defineConfig, devices } from "@playwright/test";

import { REFERENCE_WIDTH_PX } from "./ui/src/lib/layout.ts";

// EXC-587: worker cap from CARET_E2E_WORKERS — a positive int, else the "50%"
// default. Validated (not a bare Number()) so a typo like "auto" or "0" falls
// back to the default rather than handing Playwright NaN/0, matching the
// positive-int contract documented in the README and CARET_PREFLIGHT_JOBS.
const e2eWorkers: number | string = (() => {
  const raw = process.env.CARET_E2E_WORKERS;
  if (!raw) return "50%";
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : "50%";
})();

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
  // EXC-587: bound the fan-out. Each worker drives a Chromium tree plus a
  // spawned daemon, so an uncapped count is the dominant driver of the orphan
  // storm when several preflight runs stack; cap it at half the cores
  // (CARET_E2E_WORKERS overrides for a constrained host).
  workers: e2eWorkers,
  // EXC-587: a wedged suite self-aborts instead of needing an external SIGKILL
  // (the path that orphans Chromium). Generous so it can't flake a slow or
  // loaded host's normal pass.
  globalTimeout: 15 * 60 * 1000,
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
