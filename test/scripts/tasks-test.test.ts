import { describe, expect, test } from "bun:test";

import { e2eModeArgs, resolveTestMode, unitModeArgs } from "@/tasks/test.ts";

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
