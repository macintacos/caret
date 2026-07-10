// `test-e2e` task: the Playwright end-to-end suite against an isolated daemon.
// Extra args (a spec path, --grep, …) are forwarded to `playwright test`.
// build-ui runs first (the `#MISE depends=["build-ui"]` on the forwarder) so the
// UI the suite drives is built.

import { existsSync } from "node:fs";
import { runForward } from "../tasks/exec.ts";

/** The argv `test-e2e` runs, plus forwarded args. */
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
  // Probe for the Chromium binary so a missing install fails actionably instead
  // of mid-suite with Playwright's runtime error.
  if (!(await chromiumInstalled())) {
    process.stderr.write(
      "caret e2e: Chromium not installed. Run: mise run setup  (or: bunx playwright install chromium)\n",
    );
    process.exit(1);
  }
  process.exit(await runForward(e2eCommand(args)));
}
