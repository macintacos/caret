import { describe, expect, test } from "bun:test";

import { runForward } from "@/tasks/lib/exec.ts";
import type { underProgressLine } from "@/tasks/lib/progress.ts";
import {
  buildTestReport,
  collectE2eJsonRun,
  collectUnitJsonRun,
  e2eModeArgs,
  ensureUiForE2e,
  resolveTestMode,
  unitModeArgs,
} from "@/tasks/test.ts";

// The `test` task's output modes (EXC-1146). One pure resolver decides the mode
// from the flags plus whether stdout is a terminal, and two pure builders turn
// that mode into the runner flags prepended to the forwarded args. `verbose`
// injects nothing, so today's stream is preserved by construction.
describe("resolveTestMode", () => {
  test("no flags: quiet at a terminal, verbose when piped", () => {
    expect(resolveTestMode({}, true)).toBe("quiet");
    expect(resolveTestMode({}, false)).toBe("verbose");
  });

  test("--json wins over every other flag, on a TTY or not", () => {
    expect(resolveTestMode({ json: true }, true)).toBe("json");
    expect(resolveTestMode({ json: true }, false)).toBe("json");
    expect(resolveTestMode({ json: true, verbose: true, quiet: true }, true)).toBe("json");
  });

  test("--verbose beats --quiet", () => {
    expect(resolveTestMode({ verbose: true, quiet: true }, true)).toBe("verbose");
  });

  test("--verbose restores the full stream at a terminal", () => {
    expect(resolveTestMode({ verbose: true }, true)).toBe("verbose");
  });

  test("--quiet applies when piped, where the default would be verbose", () => {
    expect(resolveTestMode({ quiet: true }, false)).toBe("quiet");
  });
});

describe("unitModeArgs", () => {
  test("verbose injects nothing, so the stream is today's", () => {
    expect(unitModeArgs("verbose")).toEqual([]);
  });

  // The dots reporter is the whole point of quiet on this target: bun's console
  // reporter prints NOTHING between the banner and the summary, so a green run
  // shows no sign of life for its whole minute. Not --only-failures alongside it:
  // that flag trims the console reporter, which --dots has already replaced.
  test("quiet selects bun's dots reporter, and nothing else", () => {
    expect(unitModeArgs("quiet")).toEqual(["--dots"]);
  });

  // bun's junit reporter REQUIRES an outfile, so the mode carries the path the
  // run function will read the report back from.
  test("json points bun's junit reporter at the outfile", () => {
    expect(unitModeArgs("json", "/tmp/x/report.xml")).toEqual([
      "--reporter=junit",
      "--reporter-outfile=/tmp/x/report.xml",
    ]);
  });
});

describe("e2eModeArgs", () => {
  test("verbose injects nothing", () => {
    expect(e2eModeArgs("verbose")).toEqual([]);
  });

  test("quiet selects Playwright's dot reporter", () => {
    expect(e2eModeArgs("quiet")).toEqual(["--reporter=dot"]);
  });

  // Where that reporter WRITES is not a flag — the run path sets
  // PLAYWRIGHT_JSON_OUTPUT_FILE so the report lands in a file, not on stdout.
  test("json selects Playwright's json reporter", () => {
    expect(e2eModeArgs("json")).toEqual(["--reporter=json"]);
  });
});

// The UI build an e2e run does first. Quiet hides vite's ~400-line transcript
// behind one live progress line; verbose leaves the stream as it always was. The
// display is injected out for these — what matters here is which side of it the
// build's output lands on, not how listr2 renders.
describe("ensureUiForE2e", () => {
  /** underProgressLine with the live display removed: run the work, drop the lines. */
  const noDisplay: typeof underProgressLine = (_title, work) => work(() => {});

  test("verbose streams the build, so there is nothing captured to replay", async () => {
    const { code, output } = await ensureUiForE2e("verbose", async () => 7, noDisplay);
    expect(code).toBe(7);
    expect(output).toBe("");
  });

  test("quiet captures what the build writes instead of letting it stream", async () => {
    const { code, output } = await ensureUiForE2e(
      "quiet",
      (run = runForward) => run(["bun", "-e", "console.log('vite noise')"]),
      noDisplay,
    );
    expect(code).toBe(0);
    expect(output).toContain("vite noise");
  });

  // Hiding a build is only safe if a broken one is still diagnosable: the code
  // and the whole captured log come back for the caller to replay.
  test("quiet keeps a failed build's exit code and its log", async () => {
    const { code, output } = await ensureUiForE2e(
      "quiet",
      (run = runForward) => run(["bun", "-e", "console.error('vite exploded'); process.exit(2)"]),
      noDisplay,
    );
    expect(code).toBe(2);
    expect(output).toContain("vite exploded");
  });
});

// The --json result document. A failing run nests the runner's native report
// UNNORMALISED — JUnit XML text for unit, Playwright's parsed JSON for e2e — plus
// the captured output; a passing run is the envelope and the counts alone.
const ESC = String.fromCharCode(27);

// bun 1.3.14's junit reporter, verbatim — a pinned recording, not a version to
// keep current: 3 tests, one skipped, none failing.
const PASSING_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" assertions="2" failures="0" skipped="1" time="0.014287">
  <testsuite name="sample.test.ts" file="sample.test.ts" tests="3" assertions="2" failures="0" skipped="1" time="0" hostname="Mac.localdomain">
    <testcase name="passes" classname="" time="0.000744" file="sample.test.ts" line="3" assertions="1" />
    <testcase name="also passes" classname="" time="0.000038" file="sample.test.ts" line="6" assertions="1" />
    <testcase name="skipped" classname="" time="0" file="sample.test.ts" line="9" assertions="0">
      <skipped />
    </testcase>
  </testsuite>
</testsuites>`;

// Also verbatim, and the reason a failing run must carry `output`: bun's failure
// element is bare — no message, no diff, no stack. Those go to its console
// stream, which is the only place the diagnosis exists.
const FAILING_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="2" assertions="2" failures="1" skipped="0" time="0.011451">
  <testsuite name="fail.test.ts" file="fail.test.ts" tests="2" assertions="2" failures="1" skipped="0" time="0.002" hostname="Mac.localdomain">
    <testcase name="passes" classname="" time="0.000035" file="fail.test.ts" line="3" assertions="1" />
    <testcase name="fails" classname="" time="0.002267" file="fail.test.ts" line="6" assertions="1">
      <failure type="AssertionError" />
    </testcase>
  </testsuite>
</testsuites>`;

/** Playwright's json reporter, trimmed to the fields the envelope reads, with a
 * colorized failure message of the kind its reporters really emit. */
const PLAYWRIGHT_REPORT = {
  suites: [
    {
      title: "approve.e2e.ts",
      specs: [{ title: "approves", tests: [{ results: [{ error: { message: "" } }] }] }],
    },
  ],
  errors: [{ message: `${ESC}[31mExpected 1 got 2${ESC}[39m` }],
  stats: { startTime: "2026-08-31T19:34:02.997Z", duration: 215.6, expected: 7, unexpected: 2 },
};

describe("buildTestReport", () => {
  test("unit: counts off the testsuites attributes", () => {
    const report = buildTestReport({
      target: "unit",
      exitCode: 0,
      durationMs: 1234,
      native: PASSING_JUNIT,
      output: "bun test",
    });
    expect(report.schemaVersion).toBe(1);
    expect(report.target).toBe("unit");
    expect(report.ok).toBe(true);
    expect(report.passed).toBe(2); // tests - failures - skipped
    expect(report.failed).toBe(0);
    expect(report.durationMs).toBe(1234);
  });

  // The counts ARE the answer when nothing failed, and a whole-suite JUnit report
  // is ~1.1MB of <testcase/> rows saying only what `passed` already said — which
  // would defeat the mode for the machine consumer it exists to serve. Same
  // discipline scripts/preflight.ts applies to a passing task.
  test("a passing run carries neither the native report nor the captured output", () => {
    const report = buildTestReport({
      target: "unit",
      exitCode: 0,
      durationMs: 1234,
      native: PASSING_JUNIT,
      output: "bun test",
    });
    expect(report.report).toBeNull();
    expect(report.output).toBeUndefined();
  });

  test("unit: a failing run nests the XML as a string and keeps the counts", () => {
    const report = buildTestReport({
      target: "unit",
      exitCode: 1,
      durationMs: 99,
      native: FAILING_JUNIT,
      output: "",
    });
    expect(report.ok).toBe(false);
    expect(report.passed).toBe(1);
    expect(report.failed).toBe(1);
    expect(report.report).toBe(FAILING_JUNIT);
  });

  // bun's junit failure element is bare, so without this a red unit run reports
  // WHICH test failed and nothing about why — the exact re-run this mode removes.
  test("unit: a failing run carries the console stream, the only failure detail", () => {
    const report = buildTestReport({
      target: "unit",
      exitCode: 1,
      durationMs: 99,
      native: FAILING_JUNIT,
      output: "error: expect(received).toBe(expected)\nExpected: 2\nReceived: 1\n",
    });
    expect(report.output).toContain("Expected: 2");
    expect(report.report).toContain("<failure type=");
  });

  // `ok` is the runner's exit code, full stop: a run that dies AFTER every test
  // passed (a teardown crash, a leaked handle) is not a green run.
  test("ok follows the exit code even when the native report shows no failures", () => {
    const report = buildTestReport({
      target: "unit",
      exitCode: 1,
      durationMs: 5,
      native: PASSING_JUNIT,
      output: "",
    });
    expect(report.ok).toBe(false);
    expect(report.failed).toBe(0);
  });

  test("e2e: counts off stats, report nested as the parsed object", () => {
    const report = buildTestReport({
      target: "e2e",
      exitCode: 1,
      durationMs: 4321,
      native: JSON.stringify(PLAYWRIGHT_REPORT),
      output: "",
    });
    expect(report.target).toBe("e2e");
    expect(report.ok).toBe(false);
    expect(report.passed).toBe(7);
    expect(report.failed).toBe(2);
    expect(typeof report.report).toBe("object");
  });

  // The escapes survive JSON encoding, so they have to be stripped AFTER the
  // parse — a walk over the parsed object, not a pass over the raw text.
  test("e2e: strips ANSI from every string in the parsed report", () => {
    const report = buildTestReport({
      target: "e2e",
      exitCode: 1,
      durationMs: 1,
      native: JSON.stringify(PLAYWRIGHT_REPORT),
      output: "",
    });
    expect(JSON.stringify(report.report)).not.toContain(ESC);
    expect((report.report as { errors: Array<{ message: string }> }).errors[0]?.message).toBe(
      "Expected 1 got 2",
    );
  });

  test("unit: strips ANSI from the XML string too", () => {
    const report = buildTestReport({
      target: "unit",
      exitCode: 1,
      durationMs: 1,
      native: `<testsuites tests="1" failures="1"><failure>${ESC}[31mboom${ESC}[39m</failure></testsuites>`,
      output: "",
    });
    expect(report.report).toContain("boom");
    expect(report.report).not.toContain(ESC);
  });

  // A runner that died before writing a report must stay diagnosable rather than
  // becoming a black hole, so the captured output rides along instead.
  test("no native report: report null, counts zero, captured output carried", () => {
    const report = buildTestReport({
      target: "e2e",
      exitCode: 1,
      durationMs: 12,
      native: null,
      output: "playwright: config error\n",
    });
    expect(report.report).toBeNull();
    expect(report.passed).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.output).toBe("playwright: config error\n");
  });

  test("an unparseable native report degrades to the null-report shape", () => {
    const report = buildTestReport({
      target: "e2e",
      exitCode: 1,
      durationMs: 12,
      native: "not json at all",
      output: "raw log",
    });
    expect(report.report).toBeNull();
    expect(report.output).toBe("raw log");
  });
});

// The two json run paths, driven through their injected runner so the
// orchestration is asserted without spawning bun or Playwright. Everything each
// one spawns must go through that runner: a child that reached this process's
// stdout would corrupt the document, and the fake would not see it.

/** A `runCapture` stand-in: records each spawn, writes `emits` into the sink, and
 * returns whatever `code` decides for that command. */
function capturingCapture(
  code: (cmd: string[]) => number = () => 0,
  emits: (cmd: string[]) => string = (cmd) => `[${cmd[0]}] ran\n`,
) {
  const calls: Array<{ cmd: string[]; env?: Record<string, string> }> = [];
  const run = async (
    cmd: string[],
    sink: (chunk: string) => void,
    opts: { cwd?: string; env?: Record<string, string> } = {},
  ): Promise<number> => {
    calls.push({ cmd, env: opts.env });
    sink(emits(cmd));
    return code(cmd);
  };
  return { calls, run };
}

describe("collectUnitJsonRun", () => {
  test("emits the palette before running the suite, and captures both", async () => {
    const { calls, run } = capturingCapture();
    const collected = await collectUnitJsonRun(["some/path.test.ts"], run);
    expect(calls[0]?.cmd).toEqual(["bun", "ui/generate-palette-css.ts"]);
    expect(calls[1]?.cmd[0]).toBe("bun");
    expect(calls[1]?.cmd).toContain("test");
    expect(collected.output).toContain("[bun] ran");
  });

  test("points bun's junit reporter at an outfile and forwards the scoped path", async () => {
    const { calls, run } = capturingCapture();
    await collectUnitJsonRun(["some/path.test.ts"], run);
    const suite = calls[1]?.cmd ?? [];
    expect(suite).toContain("--reporter=junit");
    expect(suite.some((a) => a.startsWith("--reporter-outfile="))).toBe(true);
    // The forwarded operand still lands last, after the mode's injected flags.
    expect(suite.at(-1)).toBe("some/path.test.ts");
  });

  // A palette failure means the suite would read a stale or missing partial, so
  // reporting the suite's own verdict would be reporting a run that never happened.
  test("a failing palette step short-circuits before the suite runs", async () => {
    const failsPalette = (cmd: string[]): number =>
      cmd.some((a) => a.endsWith("generate-palette-css.ts")) ? 2 : 0;
    const { calls, run } = capturingCapture(failsPalette);
    const collected = await collectUnitJsonRun([], run);
    expect(collected.exitCode).toBe(2);
    expect(collected.native).toBeNull();
    expect(calls).toHaveLength(1); // the suite never ran
  });

  // The fake never writes the outfile, which is exactly the shape of a runner that
  // died before producing a report: null native, captured log intact.
  test("a runner that wrote no report yields a null native and keeps the log", async () => {
    const { run } = capturingCapture(() => 1);
    const collected = await collectUnitJsonRun([], run);
    expect(collected.exitCode).toBe(1);
    expect(collected.native).toBeNull();
    expect(collected.output).toContain("[bun] ran");
  });
});

describe("collectE2eJsonRun", () => {
  test("builds the UI through the injected runner, then runs the suite", async () => {
    const { calls, run } = capturingCapture();
    const collected = await collectE2eJsonRun([], run, async () => true);
    expect(calls[0]?.cmd).toEqual(["bunx", "vite", "build"]);
    expect(calls[1]?.cmd).toEqual(["bunx", "playwright", "test", "--reporter=json"]);
    expect(collected.output).toContain("[bunx] ran");
  });

  // Playwright's json reporter writes to stdout unless this env var redirects it,
  // and stdout is where the document goes — so this is what keeps them apart.
  test("redirects Playwright's report to a file via PLAYWRIGHT_JSON_OUTPUT_FILE", async () => {
    const { calls, run } = capturingCapture();
    await collectE2eJsonRun([], run, async () => true);
    expect(calls[1]?.env?.PLAYWRIGHT_JSON_OUTPUT_FILE).toMatch(/caret-test-json-.*report\.json$/);
  });

  test("a missing Chromium reports the actionable hint and never runs the suite", async () => {
    const { calls, run } = capturingCapture();
    const collected = await collectE2eJsonRun([], run, async () => false);
    expect(collected.exitCode).toBe(1);
    expect(collected.output).toContain("Chromium not installed");
    expect(calls.some((c) => c.cmd.includes("playwright"))).toBe(false);
  });

  test("a failing UI build short-circuits before the Chromium probe", async () => {
    const { calls, run } = capturingCapture((cmd) => (cmd.includes("vite") ? 3 : 0));
    const collected = await collectE2eJsonRun([], run, async () => {
      throw new Error("probed Chromium despite a failed UI build");
    });
    expect(collected.exitCode).toBe(3);
    expect(calls).toHaveLength(1);
  });
});
