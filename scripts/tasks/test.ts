// `test` task group (EXC-739): the bun unit suite and the Playwright e2e suite,
// consolidated into one command whose `unit`/`e2e` positional targets map to
// `mise run test <target>`. Bare `mise run test` (and `mise run test unit`) run
// the unit suite, preserving today's `mise run test == unit` behaviour.

import { existsSync } from "node:fs";

import { ensureUi, paletteCssCommand } from "@/tasks/build.ts";
import { execAndExit, runForward } from "@/tasks/lib/exec.ts";

// --- test unit --------------------------------------------------------------
// `--conditions browser` selects svelte's client runtime entry so the UI
// component suite can mount components under happy-dom (see bunfig.toml and
// ui/test-svelte-preload.ts); the backend suite passes unchanged under it. Extra
// args (a path, --test-name-pattern, …) are forwarded to `bun test`.

/**
 * Per-test timeout for the whole unit lane, in milliseconds (EXC-1056).
 *
 * bun's own default is 5000, which sizes every test against an idle host. Inside
 * `mise run preflight` the lane never has one: lint, both builds, the e2e suite and
 * smoke run alongside it, and the unit suite measures 31s standalone against 88s in
 * the gate (2.8x — the same figure `doc/agents/browser-testing.md` sizes the e2e
 * budgets against). The slowest test in the suite translates all 14,234 bundled shiki
 * patterns and takes ~10s on its own, so 5000 leaves it no room at all.
 *
 * 60s is a budget, not a retry: the test still runs once and still asserts the same
 * thing, so nothing is hidden — a deadline only stops the suite claiming the machine
 * was idle. It stays finite so a genuine hang is still bounded. One number for the
 * lane, here, rather than a literal sprinkled per test.
 */
const UNIT_TEST_TIMEOUT_MS = 60_000;

/** The argv `test unit` runs, plus forwarded args. The timeout precedes them so a
 * caller passing its own `--timeout` still wins. */
export function testCommand(args: string[]): string[] {
  return [
    "bun",
    "test",
    "--conditions",
    "browser",
    "--timeout",
    String(UNIT_TEST_TIMEOUT_MS),
    ...args,
  ];
}

export async function runTest(args: string[]): Promise<never> {
  // The CSS-contract suites read app.css's generated palette partial through
  // lib/appCss.ts, and this path never runs Vite — so emit it here.
  const palette = await runForward(paletteCssCommand());
  if (palette !== 0) process.exit(palette);
  return execAndExit(testCommand(args));
}

// --- test e2e ---------------------------------------------------------------
// The Playwright end-to-end suite against an isolated daemon. Extra args (a spec
// path, --grep, …) are forwarded to `playwright test`. The UI is built first so
// the suite drives the shipped ui/dist artifact — honouring CARET_SKIP_BUILD_UI
// (via build.ts's ensureUi, invoked by the `build ui` CLI path) so the preflight
// gate never double-builds it. This replaces the old `#MISE depends=["build-ui"]`.

/** The argv `test e2e` runs, plus forwarded args. */
export function e2eCommand(args: string[]): string[] {
  return ["bunx", "playwright", "test", ...args];
}

/** Whether Playwright's Chromium binary is installed. Dynamic-imports
 * @playwright/test so a plain `caret-tasks lint`/`dev` invocation never loads
 * Playwright — only this task pays for it. */
async function chromiumInstalled(): Promise<boolean> {
  const { chromium } = await import("@playwright/test");
  return existsSync(chromium.executablePath());
}

export async function runTestE2e(args: string[]): Promise<never> {
  // Build the UI first so the suite drives a freshly built ui/dist. ensureUi
  // honours CARET_SKIP_BUILD_UI, so the preflight gate (which runs `build ui`
  // itself and spawns `test e2e` with the skip set) never double-builds it.
  const ui = await ensureUi();
  if (ui !== 0) process.exit(ui);
  // Probe for the Chromium binary so a missing install fails actionably instead
  // of mid-suite with Playwright's runtime error.
  if (!(await chromiumInstalled())) {
    process.stderr.write(
      "caret e2e: Chromium not installed. Run: mise run setup  (or: bunx playwright install chromium)\n",
    );
    process.exit(1);
  }
  return execAndExit(e2eCommand(args));
}
