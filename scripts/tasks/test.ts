// `test` task group (EXC-739): the bun unit suite and the Playwright e2e suite,
// consolidated into one command whose `unit`/`e2e` positional targets map to
// `mise run test <target>`. Bare `mise run test` (and `mise run test unit`) run
// the unit suite, preserving today's `mise run test == unit` behaviour.

import { existsSync } from "node:fs";

import { ensureUi, paletteCssCommand } from "@/tasks/build.ts";
import { execAndExit, runForward } from "@/tasks/lib/exec.ts";

// --- output modes -----------------------------------------------------------
// `mise run test` is the loudest command in the repo, and it printed its whole
// transcript to every consumer alike (EXC-1146). Three modes now split that, the
// same way `mise run preflight` splits a live display from a --json contract:
// `verbose` is the historical stream, `quiet` asks each runner for a dots
// reporter that shows failures only, and `json` emits one result document and
// nothing else. Which one applies is decided by one pure function.

export type TestOutputMode = "verbose" | "quiet" | "json";

/** The mode flags, as commander parses them off `test unit` / `test e2e`. */
export interface TestFlags {
  json?: boolean;
  verbose?: boolean;
  quiet?: boolean;
}

/**
 * The mode a run uses. `--json` outranks everything (it is a different output
 * contract, not a volume); `--verbose` then outranks `--quiet` so the louder
 * explicit flag wins. With no flag the default follows the audience: a terminal
 * gets `quiet`, anything piped — a gate, an agent, a CI log — keeps today's
 * full stream, so no existing non-interactive consumer changes.
 *
 * `isTty` is passed in rather than read here: the caller reads
 * `process.stdout.isTTY` at its entry point, leaving this decidable in a test.
 */
export function resolveTestMode(flags: TestFlags, isTty: boolean): TestOutputMode {
  if (flags.json) return "json";
  if (flags.verbose) return "verbose";
  if (flags.quiet) return "quiet";
  return isTty ? "quiet" : "verbose";
}

/** The `bun test` flags a mode injects ahead of the forwarded args. `junitPath`
 * is used only by json mode, where bun's junit reporter requires an outfile —
 * it writes its own console stream to stderr and its banner to stdout, so the
 * report cannot simply be read back off a captured stream. */
export function unitModeArgs(mode: TestOutputMode, junitPath: string | null): string[] {
  if (mode === "quiet") return ["--dots", "--only-failures"];
  if (mode === "json" && junitPath) return ["--reporter=junit", `--reporter-outfile=${junitPath}`];
  return [];
}

/** The `playwright test` flags a mode injects ahead of the forwarded args. The
 * json reporter writes its report to stdout, which is why the json run path
 * captures the child's streams instead of inheriting them. */
export function e2eModeArgs(mode: TestOutputMode): string[] {
  if (mode === "quiet") return ["--reporter=dot"];
  if (mode === "json") return ["--reporter=json"];
  return [];
}

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

export async function runTest(args: string[], flags: TestFlags = {}): Promise<never> {
  const mode = resolveTestMode(flags, process.stdout.isTTY === true);
  // The CSS-contract suites read app.css's generated palette partial through
  // lib/appCss.ts, and this path never runs Vite — so emit it here.
  const palette = await runForward(paletteCssCommand());
  if (palette !== 0) process.exit(palette);
  return execAndExit(testCommand([...unitModeArgs(mode, null), ...args]));
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

export async function runTestE2e(args: string[], flags: TestFlags = {}): Promise<never> {
  const mode = resolveTestMode(flags, process.stdout.isTTY === true);
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
  return execAndExit(e2eCommand([...e2eModeArgs(mode), ...args]));
}
