// `test` task group (EXC-739): the bun unit suite and the Playwright e2e suite,
// consolidated into one command whose `unit`/`e2e` positional targets map to
// `mise run test <target>`. Bare `mise run test` (and `mise run test unit`) run
// the unit suite, preserving today's `mise run test == unit` behaviour.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ensureUi, paletteCssCommand } from "@/tasks/build.ts";
import { execAndExit, runCaptureSplit, runForward, stripAnsi } from "@/tasks/lib/exec.ts";

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

// --- the --json result document ----------------------------------------------
// One document per run, on stdout, and nothing else. The envelope is shared
// between the two targets; each runner's native report is nested UNNORMALISED
// beneath it — JUnit XML text for unit, Playwright's parsed JSON for e2e — so
// this file never has to model what a "test result" is in two dialects.

/** Bumpable integer so a machine consumer detects a breaking shape change.
 * Numbered independently of scripts/preflight.ts's: separate contracts, which
 * will version separately. */
const REPORT_SCHEMA_VERSION = 1;

export interface TestReport {
  schemaVersion: number;
  target: "unit" | "e2e";
  /** The runner's own verdict — its exit code, never one re-derived from counts. */
  ok: boolean;
  passed: number;
  failed: number;
  durationMs: number;
  /** The runner's native report, unnormalised: JUnit XML text (unit) or
   * Playwright's JSON (e2e). Null when the runner produced none. */
  report: string | Record<string, unknown> | null;
  /** Captured runner output — present only when `report` is null, so a runner
   * that died before writing one is diagnosable rather than a black hole. */
  output?: string;
}

export interface TestReportInput {
  target: "unit" | "e2e";
  exitCode: number;
  durationMs: number;
  /** The runner's native report as written: JUnit XML read back from bun's
   * outfile, or Playwright's json reporter on stdout. */
  native: string | null;
  /** Everything the runner wrote, for the case where it produced no report. */
  output: string;
}

/** The result document for one run. */
export function buildTestReport(input: TestReportInput): TestReport {
  const envelope = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    target: input.target,
    ok: input.exitCode === 0,
    durationMs: input.durationMs,
  };
  const parsed = input.native === null ? null : parseNative(input.target, input.native);
  if (parsed === null) {
    return { ...envelope, passed: 0, failed: 0, report: null, output: input.output };
  }
  return { ...envelope, ...parsed };
}

/** Counts plus the report to nest, or null when the text isn't a report at all. */
function parseNative(
  target: "unit" | "e2e",
  native: string,
): Pick<TestReport, "passed" | "failed" | "report"> | null {
  return target === "unit" ? parseJUnit(native) : parsePlaywrightReport(native);
}

/** bun's junit reporter puts the whole-run totals on the root `<testsuites>`
 * element, so the counts are its attributes rather than a walk over the cases. */
function parseJUnit(xml: string): Pick<TestReport, "passed" | "failed" | "report"> | null {
  const root = /<testsuites\b[^>]*>/.exec(xml)?.[0];
  if (!root) return null;
  const attr = (name: string): number =>
    Number(new RegExp(`\\b${name}="(\\d+)"`).exec(root)?.[1] ?? 0);
  const failed = attr("failures") + attr("errors");
  return { passed: attr("tests") - failed - attr("skipped"), failed, report: stripAnsi(xml) };
}

/** Playwright's json reporter carries the whole-run totals under `stats`. */
function parsePlaywrightReport(
  text: string,
): Pick<TestReport, "passed" | "failed" | "report"> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const stats = (parsed as { stats?: { expected?: number; unexpected?: number } }).stats;
  return {
    passed: stats?.expected ?? 0,
    failed: stats?.unexpected ?? 0,
    report: stripAnsiDeep(parsed) as Record<string, unknown>,
  };
}

/** ANSI stripped from every string in a parsed report. The escapes live inside
 * string VALUES and survive JSON encoding, so they have to be removed after the
 * parse rather than scrubbed off the source text. */
function stripAnsiDeep(value: unknown): unknown {
  if (typeof value === "string") return stripAnsi(value);
  if (Array.isArray(value)) return value.map(stripAnsiDeep);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripAnsiDeep(v)]));
  }
  return value;
}

/** Write the result document as the only thing on stdout, then exit with the
 * runner's code. The write is awaited because `process.exit()` truncates a piped
 * write at the pipe buffer — the 64KB cliff scripts/preflight.ts documents — and
 * a whole-suite JUnit report clears that many times over. */
async function emitTestReport(
  target: "unit" | "e2e",
  exitCode: number,
  startedAt: number,
  native: string | null,
  captured: { stdout: string; stderr: string },
): Promise<never> {
  const report = buildTestReport({
    target,
    exitCode,
    durationMs: Date.now() - startedAt,
    native,
    output: captured.stdout + captured.stderr,
  });
  const line = `${JSON.stringify(report)}\n`;
  await new Promise<void>((resolve) => process.stdout.write(line, () => resolve()));
  process.exit(exitCode);
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
  if (mode === "json") return runTestJson(args);
  // The CSS-contract suites read app.css's generated palette partial through
  // lib/appCss.ts, and this path never runs Vite — so emit it here.
  const palette = await runForward(paletteCssCommand());
  if (palette !== 0) process.exit(palette);
  return execAndExit(testCommand([...unitModeArgs(mode, null), ...args]));
}

/** The unit suite with stdout reserved for the result document. bun writes its
 * banner to stdout and its console stream to stderr, so BOTH children run
 * captured — the palette generator included, which is why that step streams
 * normally in the other two modes and only here does not. The report itself
 * arrives out-of-band: bun's junit reporter requires an outfile. */
async function runTestJson(args: string[]): Promise<never> {
  const started = Date.now();
  const palette = await runCaptureSplit(paletteCssCommand());
  if (palette.code !== 0) return emitTestReport("unit", palette.code, started, null, palette);
  const dir = mkdtempSync(join(tmpdir(), "caret-test-json-"));
  const junitPath = join(dir, "report.xml");
  const run = await runCaptureSplit(testCommand([...unitModeArgs("json", junitPath), ...args]));
  // Read before the cleanup, and both before the emit: emitTestReport exits, so
  // nothing after it — a `finally` included — would ever run.
  const native = existsSync(junitPath) ? readFileSync(junitPath, "utf8") : null;
  rmSync(dir, { recursive: true, force: true });
  return emitTestReport("unit", run.code, started, native, run);
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

/** What to tell a caller whose Chromium install is missing — the probe below
 * fails actionably here rather than mid-suite with Playwright's runtime error. */
const CHROMIUM_MISSING =
  "caret e2e: Chromium not installed. Run: mise run setup  (or: bunx playwright install chromium)\n";

export async function runTestE2e(args: string[], flags: TestFlags = {}): Promise<never> {
  const mode = resolveTestMode(flags, process.stdout.isTTY === true);
  if (mode === "json") return runTestE2eJson(args);
  // Build the UI first so the suite drives a freshly built ui/dist. ensureUi
  // honours CARET_SKIP_BUILD_UI, so the preflight gate (which runs `build ui`
  // itself and spawns `test e2e` with the skip set) never double-builds it.
  const ui = await ensureUi();
  if (ui !== 0) process.exit(ui);
  if (!(await chromiumInstalled())) {
    process.stderr.write(CHROMIUM_MISSING);
    process.exit(1);
  }
  return execAndExit(e2eCommand([...e2eModeArgs(mode), ...args]));
}

/** The e2e suite with stdout reserved for the result document. Playwright's json
 * reporter writes its report THERE, so the run is captured and that stdout is
 * the report; ensureUi takes an injectable runner, so the Vite build is captured
 * with it rather than streaming into the middle of the document. */
async function runTestE2eJson(args: string[]): Promise<never> {
  const started = Date.now();
  let uiLog = "";
  const ui = await ensureUi(async (cmd, opts) => {
    const built = await runCaptureSplit(cmd, opts);
    uiLog += built.stdout + built.stderr;
    return built.code;
  });
  if (ui !== 0) return emitTestReport("e2e", ui, started, null, { stdout: uiLog, stderr: "" });
  if (!(await chromiumInstalled())) {
    return emitTestReport("e2e", 1, started, null, { stdout: "", stderr: CHROMIUM_MISSING });
  }
  const run = await runCaptureSplit(e2eCommand([...e2eModeArgs("json"), ...args]));
  return emitTestReport("e2e", run.code, started, run.stdout, run);
}
