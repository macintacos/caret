// `test` task group (EXC-739): the bun unit suite, the Playwright e2e suite, and
// the hermetic bats suites, consolidated into one command whose `unit`/`e2e`/`bats`
// positional targets map to `mise run test <target>`. Bare `mise run test` (and
// `mise run test unit`) run the unit suite, preserving today's `mise run test ==
// unit` behaviour.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ensureUi, paletteCssCommand } from "@/tasks/build.ts";
import {
  execAndExit,
  runCapture,
  runForward,
  runQuietly,
  stripAnsi,
  writeAndFlush,
} from "@/tasks/lib/exec.ts";
import { underProgressLine } from "@/tasks/lib/progress.ts";

// --- output modes -----------------------------------------------------------
// Three output modes (EXC-1146), splitting the run the way `mise run preflight`
// splits a live display from a --json contract: `verbose` is the historical
// stream, `quiet` is progress without a transcript, and `json` emits one result
// document and nothing else. Which one applies is decided by one pure function.
// What `quiet` has to FIX differs by target — see unitModeArgs and e2eModeArgs.

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

/**
 * The `bun test` flags a mode injects ahead of the forwarded args. The overloads
 * put json's requirement in the type: bun's junit reporter refuses to run without
 * `--reporter-outfile`, so the path is not optional there and a json call without
 * one does not compile.
 *
 * `quiet` is the dots reporter, because on this target the problem is the opposite
 * of noise: bun's console reporter prints nothing at all between its banner and its
 * summary, so a green run sits silent for its whole minute. `--dots` emits one
 * character per test as it lands — ~4900 across the suite, which the terminal wraps
 * into some dozens of rows — and still prints each failure in full. `--only-failures`
 * is NOT passed with it: that flag trims the console reporter, which `--dots`
 * (`--reporter=dots`) has already replaced.
 */
export function unitModeArgs(mode: "verbose" | "quiet"): string[];
export function unitModeArgs(mode: "json", junitPath: string): string[];
export function unitModeArgs(mode: TestOutputMode, junitPath?: string): string[] {
  if (mode === "quiet") return ["--dots"];
  if (mode === "json") return ["--reporter=junit", `--reporter-outfile=${junitPath}`];
  return [];
}

/** The `playwright test` flags a mode injects ahead of the forwarded args. Where
 * the json reporter WRITES is not a flag — it follows PLAYWRIGHT_JSON_OUTPUT_FILE,
 * which the json run path sets so the report lands in a file instead of on stdout. */
export function e2eModeArgs(mode: TestOutputMode): string[] {
  if (mode === "quiet") return ["--reporter=dot"];
  if (mode === "json") return ["--reporter=json"];
  return [];
}

// --- the --json result document ----------------------------------------------
// One document per run, on stdout, and nothing else. The envelope is shared
// across all three targets; a runner's native report is nested UNNORMALISED
// beneath it — JUnit XML text for unit and bats, Playwright's parsed JSON for
// e2e — so this file never has to model what a "test result" is in more than
// two dialects.
//
// What rides along depends on the verdict, the same discipline
// scripts/preflight.ts applies to its own --json result: a GREEN run is the
// envelope and the counts, nothing more, because a passing run's native report
// says only what `passed` already says and costs 1.1MB of <testcase/> rows to say
// it. A FAILING run carries both the native report and the captured output —
// output because it is the human-formatted stream: both runners put the diagnosis in
// their XML too, but reading a diff out of `&#10;`-escaped attributes is not the job.

/** Bumpable integer so a machine consumer detects a breaking shape change.
 * Numbered independently of scripts/preflight.ts's: separate contracts, which
 * will version separately. */
const REPORT_SCHEMA_VERSION = 1;

/** The suites a run can target, each with its own runner. */
export type TestTarget = "unit" | "e2e" | "bats";

export interface TestReport {
  schemaVersion: number;
  target: TestTarget;
  /** The runner's own verdict — its exit code, never one re-derived from counts. */
  ok: boolean;
  passed: number;
  failed: number;
  durationMs: number;
  /** The runner's native report, unnormalised: JUnit XML text (unit, bats) or
   * Playwright's JSON (e2e). Null on a passing run, where the envelope is the
   * whole answer, and on a run whose runner produced no report at all. */
  report: string | Record<string, unknown> | null;
  /** Everything the runner wrote. Carried on every failing run — it is where the
   * failure reads as a human wrote it — and never on a passing one. */
  output?: string;
}

export interface TestReportInput {
  target: TestTarget;
  exitCode: number;
  durationMs: number;
  /** The runner's native report as written, read back from the file each runner
   * was pointed at. Null when the runner produced none. */
  native: string | null;
  /** Everything the runner wrote, interleaved as it arrived. */
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
  const counts = { passed: parsed?.passed ?? 0, failed: parsed?.failed ?? 0 };
  if (envelope.ok) return { ...envelope, ...counts, report: null };
  return { ...envelope, ...counts, report: parsed?.report ?? null, output: input.output };
}

/** Counts plus the report to nest, or null when the text isn't a report at all. */
function parseNative(
  target: TestTarget,
  native: string,
): Pick<TestReport, "passed" | "failed" | "report"> | null {
  return target === "e2e" ? parsePlaywrightReport(native) : parseJUnit(native);
}

/** The JUnit dialect both bun and bats write. The two put their counts in different
 * places, and neither reading serves both:
 *
 * bun states the whole run on the root `<testsuites>` — and also nests a
 * `<testsuite>` inside the file's own for every `describe`, so summing elements
 * counts each grouped test twice. bats leaves the root carrying only a `time` and
 * puts every count on a per-file `<testsuite>`, so there the children are the only
 * counts there are.
 *
 * Hence: read the root where it carries `tests`, sum the children where it does
 * not. The `\s` after `testsuite` is what keeps the root out of that sum. */
function parseJUnit(xml: string): Pick<TestReport, "passed" | "failed" | "report"> | null {
  const root = /<testsuites\b[^>]*>/.exec(xml)?.[0];
  if (!root) return null;
  const counted = /\btests="/.test(root)
    ? [root]
    : [...xml.matchAll(/<testsuite\s[^>]*>/g)].map(([suite]) => suite);
  let tests = 0;
  let failed = 0;
  let skipped = 0;
  for (const suite of counted) {
    const attr = (name: string): number =>
      Number(new RegExp(`\\b${name}="(\\d+)"`).exec(suite)?.[1] ?? 0);
    tests += attr("tests");
    failed += attr("failures") + attr("errors");
    skipped += attr("skipped");
  }
  return { passed: tests - failed - skipped, failed, report: stripAnsi(xml) };
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
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
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

/**
 * Run something that writes its report into a throwaway directory, and read the
 * report back. All three collectors need this and differ only in how the path
 * reaches the runner — a `--reporter-outfile` flag, a `-o` directory, an env var —
 * which is what `spawn` receives it for.
 *
 * The `finally` is not decoration: `Bun.spawn` throws synchronously when the binary
 * is missing, so without it a host lacking `mise` or `bunx` leaks a temp directory
 * per invocation.
 */
async function withReportFile(
  basename: string,
  spawn: (path: string) => Promise<number>,
): Promise<{ exitCode: number; native: string | null }> {
  const dir = mkdtempSync(join(tmpdir(), "caret-test-json-"));
  const path = join(dir, basename);
  try {
    const exitCode = await spawn(path);
    return { exitCode, native: existsSync(path) ? readFileSync(path, "utf8") : null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Write the result document as the only thing on stdout, then exit with the
 * runner's code. The write is flushed first: a failing run's native report clears
 * the pipe buffer many times over, and the exit would truncate it there. */
async function emitTestReport(
  input: Omit<TestReportInput, "durationMs"> & { startedAt: number },
): Promise<never> {
  const report = buildTestReport({ ...input, durationMs: Date.now() - input.startedAt });
  await writeAndFlush(process.stdout, `${JSON.stringify(report)}\n`);
  process.exit(input.exitCode);
}

// --- test unit --------------------------------------------------------------
// `--conditions browser` selects svelte's client runtime entry so the UI
// component suite can mount components under happy-dom (see bunfig.toml and
// ui/support/svelte-preload.ts); the backend suite passes unchanged under it. Extra
// args (a path, --test-name-pattern, …) are forwarded to `bun test`.

/**
 * Per-test deadline for the lane, in milliseconds (EXC-1056).
 *
 * bun's own default is 5000, which sizes every test against an idle host. The lane's gate
 * is not one: inside `mise run preflight`, lint, both builds, the shell suites, the
 * Playwright suite and smoke all run alongside it. The slowest test this flag governs is
 * `test/scripts/dev-tui.test.ts`'s bounded-backlog case, which writes MAX_LOG_LINES +
 * 2000 lines through the TUI's ring buffer — 2.7s standalone against 5.4s in-gate,
 * where contention doubles it. 35s is 6.5x the in-gate figure.
 *
 * A deadline is not a retry: the test still runs once and asserts the same thing, so
 * nothing is hidden — the budget only stops the suite asserting the machine was idle.
 * Finite, so a genuine hang is still bounded.
 *
 * This flag covers CONTENTION, and only on the entry points that carry it. Intrinsic
 * slowness is a different claim and stays a per-test third argument (the shiki pattern
 * sweep's `165_000`), which every entry point honours — including a bare
 * `bun test <file>`, where this flag is absent. A preload calling `setDefaultTimeout`
 * would cover all three at once and does not work: on bun 1.4.0 a preload setting a
 * 50ms default over two 200ms files times out one of them and not the other, so it is
 * not a usable home. `bunfig.toml`'s `[test]` has no `timeout` key — one there is
 * silently ignored rather than rejected, so there is no error to go looking for.
 * Re-probe both on the next bun bump.
 */
const UNIT_TEST_TIMEOUT_MS = 35_000;

/** The argv `test unit` runs, plus forwarded args. `--parallel` fans the ~270 files
 * across worker processes, each isolated (`--parallel` implies `--isolate`), which is
 * what makes a suite that mutates `process.env` in a dozen files safe to fan out.
 * Isolation rides only on the entry points carrying the flag, as `--timeout` does: a
 * bare `bun test <path>` shares one global across files, so cross-file state can make
 * the two forms disagree. Both injected flags precede the forwarded args so a caller
 * passing its own `--parallel=N` or `--timeout` still wins. */
export function testCommand(args: string[]): string[] {
  return [
    "bun",
    "test",
    "--conditions",
    "browser",
    "--parallel",
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
  return execAndExit(testCommand([...unitModeArgs(mode), ...args]));
}

/**
 * Run the unit suite for json mode and collect what the document needs, without
 * emitting or exiting — so the orchestration below is drivable by a test.
 *
 * Every child runs captured, the palette generator included: stdout is reserved
 * for the document, and that capture is the one thing json mode does differently
 * from the streaming modes. The runner is injectable for the same reason
 * `buildBinArtifacts`'s is in build.ts.
 */
export async function collectUnitJsonRun(
  args: string[],
  run: typeof runCapture = runCapture,
): Promise<Omit<TestReportInput, "durationMs">> {
  let log = "";
  const sink = (chunk: string): void => {
    log += chunk;
  };
  // The CSS-contract suites read app.css's generated palette partial through
  // lib/appCss.ts, and this path never runs Vite — so emit it here, and stop if
  // it fails rather than reporting a suite that never ran.
  const palette = await run(paletteCssCommand(), sink);
  if (palette !== 0) return { target: "unit", exitCode: palette, native: null, output: log };
  const { exitCode, native } = await withReportFile("report.xml", (junitPath) =>
    run(testCommand([...unitModeArgs("json", junitPath), ...args]), sink),
  );
  return { target: "unit", exitCode, native, output: log };
}

async function runTestJson(args: string[]): Promise<never> {
  const startedAt = Date.now();
  return emitTestReport({ ...(await collectUnitJsonRun(args)), startedAt });
}

// --- test bats --------------------------------------------------------------
// The hermetic shell suites under scripts/, each covering a shipped script the
// other two runners cannot reach: the plugin entrypoint shim, the service
// launcher, the dep-free bootstrap preamble.

/** The argv `test bats` runs, plus forwarded args. `mise x --` rather than a bare
 * `bats`: mise computes a task's PATH from the tools installed when it launched,
 * so on a fresh clone whose bootstrap just installed bats that PATH is already
 * stale — the same reasoning scripts/bootstrap.sh gives for `mise exec -- bun`.
 * --print-output-on-failure adds `$output` to a failing case, which bats
 * otherwise captures and discards.
 *
 * A forwarded suite REPLACES `scripts/` rather than joining it: bats does not
 * de-duplicate a file already covered by a directory it was handed — it runs the
 * file twice and then dies on a `$BATS_TEST_TMPDIR` collision. Dropping the
 * directory is also what makes `mise run test <path>` mean the same thing here as
 * on `unit` and `e2e`. Flags are not suites, so `--filter <regex>` still narrows
 * the whole directory.
 *
 * The lane's floor is ~35s on any host: `caret-launcher.bats` waits out three of the
 * launcher's real probe windows, which is wall clock rather than CPU, so no amount of
 * headroom shortens it. That is what makes it an IMMEDIATE lane nothing waits on.
 *
 * It carries no deadline, deliberately: bats' own `BATS_TEST_TIMEOUT` shells out to
 * GNU `timeout`, which a stock macOS does not have. A subject that regresses into an
 * unbounded wait hangs the gate rather than failing it. */
export function batsCommand(args: string[]): string[] {
  const targets = args.some((a) => a.endsWith(".bats")) ? [] : ["scripts/"];
  return ["mise", "x", "--", "bats", "--print-output-on-failure", ...targets, ...args];
}

/**
 * `collectUnitJsonRun`'s bats twin. One spawn and no more: bats depends on
 * neither the generated palette nor a UI build, so nothing precedes it.
 *
 * bats writes its report INTO a directory rather than to a named file, and given
 * one that does not exist it writes nothing and reports nothing — which mkdtemp
 * already prevents.
 */
export async function collectBatsJsonRun(
  args: string[],
  run: typeof runCapture = runCapture,
): Promise<Omit<TestReportInput, "durationMs">> {
  let log = "";
  const sink = (chunk: string): void => {
    log += chunk;
  };
  // bats names the file itself, so `-o` takes the directory the path sits in.
  const { exitCode, native } = await withReportFile("report.xml", (reportPath) =>
    run(batsCommand(["--report-formatter", "junit", "-o", dirname(reportPath), ...args]), sink),
  );
  return { target: "bats", exitCode, native, output: log };
}

async function runTestBatsJson(args: string[]): Promise<never> {
  const startedAt = Date.now();
  return emitTestReport({ ...(await collectBatsJsonRun(args)), startedAt });
}

/** `flags` is narrowed to what this target registers — the volume pair is not on it. */
export async function runTestBats(
  args: string[],
  flags: Pick<TestFlags, "json"> = {},
): Promise<never> {
  if (flags.json) return runTestBatsJson(args);
  return execAndExit(batsCommand(args));
}

// --- test e2e ---------------------------------------------------------------
// The Playwright end-to-end suite against an isolated daemon. Extra args (a spec
// path, --grep, …) are forwarded to `playwright test`.

/** The argv `test e2e` runs, plus forwarded args. */
export function e2eCommand(args: string[]): string[] {
  return ["bunx", "playwright", "test", ...args];
}

/** Whether Playwright's Chromium binary is installed. The `assets` task
 * (scripts/tasks/assets.ts) is the only caller: it drives Chromium through the
 * library API for a recording of its own, so it asks about that one browser
 * rather than the e2e matrix's list below. Dynamic-imports @playwright/test so a
 * plain `caret-tasks lint`/`dev` invocation never loads Playwright. */
export async function chromiumInstalled(): Promise<boolean> {
  const { chromium } = await import("@playwright/test");
  return existsSync(chromium.executablePath());
}

/** The Playwright browsers the e2e matrix drives. Must match the project names in
 * playwright.config.ts — nothing checks that, so a project added there is added
 * here too. `setup` spreads this list, so the download and the probe cannot drift
 * from each other. */
export const E2E_BROWSERS = ["chromium", "webkit"] as const;

/** Which of them have no downloaded binary, in list order. Deliberately
 * matrix-wide: it demands every browser regardless of what the invocation would
 * collect, so `test e2e --project=chromium` still fails on a missing WebKit. The
 * alternative — parsing --project and path operands to work out what a run needs —
 * costs more than the one download it saves. Dynamic-imports @playwright/test so a
 * plain lint/dev invocation never loads Playwright. */
export async function missingE2eBrowsers(): Promise<string[]> {
  const pw = await import("@playwright/test");
  return E2E_BROWSERS.filter((name) => !existsSync(pw[name].executablePath()));
}

/** What to tell a caller whose browser downloads are incomplete — the probe above
 * fails actionably here, naming what is actually missing, rather than mid-suite
 * with Playwright's runtime error. The two joins differ on purpose: prose takes
 * commas, the remedy has to stay pasteable as a command. */
function missingBrowsersMessage(missing: string[]): string {
  return `caret e2e: ${missing.join(", ")} not installed. Run: mise run setup  (or: bunx playwright install ${missing.join(" ")})\n`;
}

/**
 * The UI build an e2e run does first, rendered for the mode. Verbose streams it,
 * exactly as it always did. Quiet hides it behind one live progress line — vite
 * prints some four hundred lines and not one of them is the suite you asked to
 * run — and hands back the captured log so the caller can replay a build that
 * broke. Same deal `mise run build` already gives the binary build.
 *
 * The builder and the display are both injectable, so this is drivable in a test
 * without spawning vite or taking over the terminal.
 */
export async function ensureUiForE2e(
  mode: "verbose" | "quiet",
  build: typeof ensureUi = ensureUi,
  progress: typeof underProgressLine = underProgressLine,
): Promise<{ code: number; output: string }> {
  if (mode === "verbose") return { code: await build(), output: "" };
  return await progress("building ui", (onLine) => runQuietly(build, onLine));
}

export async function runTestE2e(args: string[], flags: TestFlags = {}): Promise<never> {
  const mode = resolveTestMode(flags, process.stdout.isTTY === true);
  if (mode === "json") return runTestE2eJson(args);
  // Build the UI first so the suite drives a freshly built ui/dist. ensureUi
  // honours CARET_SKIP_BUILD_UI, so the preflight gate (which runs `build ui`
  // itself and spawns `test e2e` with the skip set) never double-builds it.
  const ui = await ensureUiForE2e(mode);
  if (ui.code !== 0) {
    await writeAndFlush(process.stderr, ui.output);
    process.exit(ui.code);
  }
  const missing = await missingE2eBrowsers();
  if (missing.length > 0) {
    process.stderr.write(missingBrowsersMessage(missing));
    process.exit(1);
  }
  return execAndExit(e2eCommand([...e2eModeArgs(mode), ...args]));
}

/**
 * `collectUnitJsonRun`'s e2e twin: run the suite and collect the document's
 * inputs, emitting and exiting nowhere.
 *
 * Every child runs captured here too, the Vite build included — which is why
 * `ensureUi`'s injectable runner is threaded rather than left to stream.
 * Playwright's json reporter writes to stdout by default, so
 * PLAYWRIGHT_JSON_OUTPUT_FILE redirects it to a file; that is what keeps the
 * document the only thing this process puts on stdout.
 */
export async function collectE2eJsonRun(
  args: string[],
  run: typeof runCapture = runCapture,
  missingBrowsers: () => Promise<string[]> = missingE2eBrowsers,
): Promise<Omit<TestReportInput, "durationMs">> {
  let log = "";
  const sink = (chunk: string): void => {
    log += chunk;
  };
  const ui = await ensureUi((cmd, opts) => run(cmd, sink, opts));
  if (ui !== 0) return { target: "e2e", exitCode: ui, native: null, output: log };
  const missing = await missingBrowsers();
  if (missing.length > 0) {
    return {
      target: "e2e",
      exitCode: 1,
      native: null,
      output: log + missingBrowsersMessage(missing),
    };
  }
  const { exitCode, native } = await withReportFile("report.json", (reportPath) =>
    run(e2eCommand([...e2eModeArgs("json"), ...args]), sink, {
      env: { ...(process.env as Record<string, string>), PLAYWRIGHT_JSON_OUTPUT_FILE: reportPath },
    }),
  );
  return { target: "e2e", exitCode, native, output: log };
}

async function runTestE2eJson(args: string[]): Promise<never> {
  const startedAt = Date.now();
  return emitTestReport({ ...(await collectE2eJsonRun(args)), startedAt });
}
