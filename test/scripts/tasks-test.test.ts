import { describe, expect, test } from "bun:test";

import { buildTestReport, e2eModeArgs, resolveTestMode, unitModeArgs } from "@/tasks/test.ts";

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
    expect(unitModeArgs("verbose", null)).toEqual([]);
  });

  test("quiet asks bun for dots and failures only", () => {
    expect(unitModeArgs("quiet", null)).toEqual(["--dots", "--only-failures"]);
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

  // Playwright's json reporter writes to stdout, which is why the json run path
  // captures rather than inherits.
  test("json selects Playwright's json reporter", () => {
    expect(e2eModeArgs("json")).toEqual(["--reporter=json"]);
  });
});

// The --json result document. Each runner's native report is nested
// UNNORMALISED — JUnit XML text for unit, Playwright's parsed JSON for e2e — so
// only the envelope is shared; the counts are read off whichever shape arrived.
const ESC = String.fromCharCode(27);

// bun's junit reporter, verbatim: 3 tests, one of them skipped, none failing.
const PASSING_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" assertions="2" failures="0" skipped="1" time="0.014287">
  <testsuite name="sample.test.ts" file="sample.test.ts" tests="3" failures="0" skipped="1">
    <testcase name="passes" classname="" time="0.000744" />
    <testcase name="also passes" classname="" time="0.000038" />
    <testcase name="skipped" classname="" time="0"><skipped /></testcase>
  </testsuite>
</testsuites>`;

const FAILING_JUNIT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="2" assertions="2" failures="1" skipped="0" time="0.011451">
  <testsuite name="fail.test.ts" file="fail.test.ts" tests="2" failures="1" skipped="0">
    <testcase name="passes" classname="" time="0.000035" />
    <testcase name="fails" classname="" time="0.002267"><failure type="AssertionError" /></testcase>
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
  test("unit: counts off the testsuites attributes, XML nested as a string", () => {
    const report = buildTestReport({
      target: "unit",
      exitCode: 0,
      durationMs: 1234,
      native: PASSING_JUNIT,
      output: "bun test v1.3.14",
    });
    expect(report.schemaVersion).toBe(1);
    expect(report.target).toBe("unit");
    expect(report.ok).toBe(true);
    expect(report.passed).toBe(2); // tests - failures - skipped
    expect(report.failed).toBe(0);
    expect(report.durationMs).toBe(1234);
    expect(report.report).toBe(PASSING_JUNIT);
    expect(report.output).toBeUndefined(); // a native report displaces the raw log
  });

  test("unit: a failing run reports the runner's verdict, never one re-derived", () => {
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
