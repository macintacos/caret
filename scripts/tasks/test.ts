// `test` task group (EXC-739): the bun unit suite and the Playwright e2e suite,
// consolidated into one command whose `unit`/`e2e` positional targets map to
// `mise run test <target>`. Bare `mise run test` (and `mise run test unit`) run
// the unit suite, preserving today's `mise run test == unit` behaviour.

import { existsSync } from "node:fs";

import { ensureUi } from "./build.ts";
import { execAndExit } from "./lib/exec.ts";

// --- test unit --------------------------------------------------------------
// `--conditions browser` selects svelte's client runtime entry so the UI
// component suite can mount components under happy-dom (see bunfig.toml and
// ui/test-svelte-preload.ts); the backend suite passes unchanged under it. Extra
// args (a path, --test-name-pattern, …) are forwarded to `bun test`.

/** The argv `test unit` runs, plus forwarded args. */
export function testCommand(args: string[]): string[] {
  return ["bun", "test", "--conditions", "browser", ...args];
}

export async function runTest(args: string[]): Promise<never> {
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
