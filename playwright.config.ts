import { defineConfig, devices } from "@playwright/test";

import type { E2EOptions } from "./test/e2e/support/fixtures.ts";
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

// EXC-1223: the engine probe, routed to the webkit project alone by the
// testMatch/testIgnore pair below. It asserts the JavaScriptCore defect that
// ui/src/lib/diffview/jsc-regex.ts works around is STILL PRESENT, so running it
// under Chromium — an engine that never had the bug — would red the suite for
// the wrong reason. The pair is the whole routing mechanism: a project with
// neither would run every spec.
const JSC_PROBE = "**/jsc-regex.e2e.ts";

// Real-browser e2e for the review UI (EXC-453). Specs are named *.e2e.ts so
// `bun test` (which collects *.test.ts AND *.spec.ts repo-wide) never picks
// them up — the two runners stay disjoint. Each test boots its own isolated
// daemon via test/e2e/support/fixtures.ts (OS-assigned port, ephemeral state),
// so there is no static baseURL or webServer here.
export default defineConfig<E2EOptions>({
  testDir: "test/e2e",
  testMatch: "**/*.e2e.ts",
  fullyParallel: true,
  // EXC-1050: no retries — the budgets below absorb gate contention instead.
  // doc/agents/browser-testing.md § Timeouts are budgets for the loaded host.
  retries: 0,
  forbidOnly: true,
  // EXC-587: bound the fan-out. Each worker drives a browser tree plus a
  // spawned daemon, so an uncapped count is the dominant driver of the orphan
  // storm when several preflight runs stack; cap it at half the cores
  // (CARET_E2E_WORKERS overrides for a constrained host).
  workers: e2eWorkers,
  // EXC-587: a wedged suite self-aborts instead of needing an external SIGKILL
  // (the path that orphans a browser). Generous so it can't flake a slow or
  // loaded host's normal pass.
  globalTimeout: 15 * 60 * 1000,
  // EXC-1050: budgets for the LOADED preflight host, not an idle one.
  // Playwright ships no default actionTimeout, navigationTimeout, or toPass
  // budget, so a starved click/goto/waitForFunction/toPass falls through to
  // whichever deadline is left rather than one of its own — which is why the
  // per-test number binds and why toPass is set explicitly beside expect
  // (expect.timeout does not reach it). Where these numbers come from:
  // doc/agents/browser-testing.md § Timeouts are budgets for the loaded host.
  timeout: 60 * 1000,
  expect: { timeout: 15 * 1000, toPass: { timeout: 15 * 1000 } },
  // Non-interactive reporter so the preflight gate can't hang on a TTY pager.
  reporter: "list",
  use: {
    // EXC-1058: the fixture's daemon-boot budget, reached through a Playwright
    // option fixture (test/e2e/support/fixtures.ts) since none of Playwright's
    // own knobs governs a spawned child process. This value is the one that
    // binds; the fixture carries the same number as the tuple default the
    // option form requires, and documents how each phase spends it.
    // doc/agents/browser-testing.md § Timeouts are budgets for the loaded host.
    bootTimeoutMs: 15 * 1000,
    // Failure artifacts only; they can capture rendered plan text, so they
    // stay gitignored and local (never-log-identifiable-data posture).
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  // Adding a project here means adding its name to E2E_BROWSERS in
  // scripts/tasks/test.ts, which is what `mise run setup` downloads and what the
  // e2e task checks for before it runs. Nothing gates the two lists against
  // each other.
  projects: [
    {
      name: "chromium",
      testIgnore: JSC_PROBE,
      use: {
        ...devices["Desktop Chrome"],
        // After the device spread (which pins 1280x720): widen to the reference
        // layout width plus headroom so the source view has room for the full
        // plan column — derived from the constant so the e2e viewport tracks
        // the reference width instead of being coupled to it by prose.
        viewport: { width: REFERENCE_WIDTH_PX + 200, height: 900 },
        // EXC-773: caret's default appearance mode follows the OS, so the
        // emulated `prefers-color-scheme` now decides what a fresh origin
        // paints. Pin it rather than inherit Playwright's light default — the
        // suite's baseline is caret dark, and a spec that cares about system
        // switching overrides this with page.emulateMedia().
        colorScheme: "dark",
      },
    },
    {
      // EXC-1223: WebKit exists here to run the engine probe and nothing else —
      // it watches shipping Safari's regex engine, it does not double-run the UI
      // suite. The device spread is the whole `use` block, deliberately: the
      // probe renders nothing, so there is no layout to widen a viewport for and
      // no fresh origin for `colorScheme` to decide the paint of.
      name: "webkit",
      testMatch: JSC_PROBE,
      use: {
        ...devices["Desktop Safari"],
      },
    },
  ],
});
