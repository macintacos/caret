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
 * Per-test deadline for the lane, in milliseconds (EXC-1056).
 *
 * bun's own default is 5000, which sizes every test against an idle host. The lane's
 * gate is not one: inside `mise run preflight`, lint, both builds, the Playwright
 * suite and smoke all run alongside it. What breaks first there is not the CPU-heavy
 * test but the SPAWN-heavy one — `test/scripts/dev-driver.test.ts` posts several plan
 * versions through the real submit → reflow → store path and each reflow spawns rumdl,
 * so it measures a few hundred ms standalone and crosses 5s in the gate. That is better
 * than 10x, against a suite average nearer 2.8x.
 *
 * A deadline is not a retry: the test still runs once and asserts the same thing, so
 * nothing is hidden — the budget only stops the suite asserting the machine was idle.
 * Finite, so a genuine hang is still bounded.
 *
 * This flag covers CONTENTION, and only on the entry points that carry it. Intrinsic
 * slowness is a different claim and stays a per-test third argument (the shiki pattern
 * sweep's `60_000`), which every entry point honours — including a bare
 * `bun test <file>`, where this flag is absent. A preload calling `setDefaultTimeout`
 * would cover all three at once and was tried: bun 1.3 applies it to some files in a
 * multi-file run and not others, so it is not a usable home. `bunfig.toml`'s `[test]`
 * has no `timeout` key at all.
 */
const UNIT_TEST_TIMEOUT_MS = 30_000;

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
 * Playwright — only this task pays for it. Shared with the `assets` task
 * (scripts/tasks/assets.ts), which drives the same Chromium through the library
 * API rather than the runner. */
export async function chromiumInstalled(): Promise<boolean> {
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
