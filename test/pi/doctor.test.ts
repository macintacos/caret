import { expect, test } from "bun:test";

import type { SpawnRunner } from "@bridge/review-bridge.ts";
import {
  DOCTOR_ENTRY,
  DOCTOR_TIMEOUT_MS,
  type DoctorApi,
  type DoctorCommandContext,
  type DoctorOutcome,
  doctorText,
  FAILED_VERDICT,
  installDoctor,
  NO_REPORT_VERDICT,
  PASSED_VERDICT,
  type renderDoctorEntry,
} from "@piext/doctor.ts";
import { rejectingRunner } from "@test/support/spawn-runner.ts";

const BIN = "/opt/caret/bin/caret";
const REPORT = "caret doctor 1.2.3 · v1 · now\n\n✓ daemon";

const settles =
  (stdout: string, exitCode: number, stderr = ""): SpawnRunner =>
  async (_cmd, _env, _stdin, onStderr) => {
    if (stderr) onStderr?.(stderr);
    return { stdout, exitCode };
  };

function fakePi(run: SpawnRunner, mode: DoctorCommandContext["mode"] = "tui") {
  const commands: Record<string, (args: string, ctx: unknown) => Promise<void>> = {};
  const entries: { customType: string; data: DoctorOutcome }[] = [];
  const renderers: Record<string, typeof renderDoctorEntry> = {};
  const statuses: (string | undefined)[] = [];
  const printed: string[] = [];
  const ctx = { mode, ui: { setStatus: (_k: string, t: string | undefined) => statuses.push(t) } };
  const pi: DoctorApi = {
    registerCommand: (name, options) => {
      commands[name] = options.handler as (a: string, c: unknown) => Promise<void>;
    },
    appendEntry: (customType, data) => entries.push({ customType, data }),
    registerEntryRenderer: (customType, renderer) => {
      renderers[customType] = renderer;
    },
  };
  installDoctor(pi, {
    bin: BIN,
    run,
    env: { HOST_KEY: "kept" },
    stdout: (t) => printed.push(t),
  });
  return {
    entries,
    renderers,
    statuses,
    printed,
    command: () => commands["caret:doctor"]?.("", ctx),
    outcome: () => entries[0]?.data as DoctorOutcome,
  };
}

test("runs caret doctor without colour as the pi agent, over the host env", async () => {
  let call: Parameters<SpawnRunner> | undefined;
  const pi = fakePi(async (...args) => {
    call = args;
    return { stdout: REPORT, exitCode: 0 };
  });
  await pi.command();
  expect(call?.[0]).toEqual([BIN, "doctor", "--no-color"]);
  expect(call?.[1]).toEqual({ HOST_KEY: "kept", CARET_AGENT: "pi" });
  expect(call?.[2]).toBe("");
  expect(call?.[4]).toBeInstanceOf(AbortSignal);
});

test("a passing report is appended as a custom entry and reads as passed", async () => {
  const pi = fakePi(settles(`${REPORT}\n`, 0));
  await pi.command();
  expect(pi.entries).toEqual([
    { customType: DOCTOR_ENTRY, data: { kind: "report", exitCode: 0, report: REPORT } },
  ]);
  expect(doctorText(pi.outcome()).split("\n")[0]).toContain(PASSED_VERDICT);
});

test("a failing report reads as failed and carries the report", async () => {
  const pi = fakePi(settles(REPORT, 1));
  await pi.command();
  const text = doctorText(pi.outcome());
  expect(text.split("\n")[0]).toContain(FAILED_VERDICT);
  expect(text).toContain(REPORT);
});

test("exit 2 carries doctor's stderr as the reason", async () => {
  const pi = fakePi(settles("", 2, "caret doctor: boom\n"));
  await pi.command();
  expect(pi.outcome()).toEqual({ kind: "no-report", exitCode: 2, reason: "caret doctor: boom" });
  expect(doctorText(pi.outcome())).toContain(NO_REPORT_VERDICT);
});

test("a run with no report names its exit code", async () => {
  const pi = fakePi(settles("  \n", 0));
  await pi.command();
  expect(pi.outcome()).toEqual({
    kind: "no-report",
    exitCode: 0,
    reason: expect.stringContaining("exited 0"),
  });
});

test("a caret that can't start names the binary", async () => {
  const err = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  const pi = fakePi(rejectingRunner(err));
  await pi.command();
  expect(pi.outcome()).toEqual({
    kind: "no-report",
    exitCode: null,
    reason: expect.stringContaining(BIN),
  });
});

test("a timed-out run names the timeout it gave up after", async () => {
  const err = Object.assign(new Error("aborted"), { name: "AbortError" });
  const pi = fakePi(rejectingRunner(err));
  await pi.command();
  expect(pi.outcome()).toEqual({
    kind: "no-report",
    exitCode: null,
    reason: expect.stringContaining(`${DOCTOR_TIMEOUT_MS / 1000} seconds`),
  });
});

test("shows a running status while doctor runs, then clears it", async () => {
  let duringRun: (string | undefined)[] = [];
  const pi = fakePi(async () => {
    duringRun = [...pi.statuses];
    return { stdout: REPORT, exitCode: 0 };
  });
  await pi.command();
  expect(duringRun).toEqual([expect.stringContaining("running caret doctor")]);
  expect(pi.statuses.at(-1)).toBeUndefined();
});

test("print mode writes the plain report to stdout", async () => {
  const pi = fakePi(settles(REPORT, 0), "print");
  await pi.command();
  expect(pi.printed).toEqual([`${doctorText(pi.outcome())}\n`]);
});

test.each(["tui", "json"] as const)("%s mode writes nothing to stdout", async (mode) => {
  const pi = fakePi(settles(REPORT, 0), mode);
  await pi.command();
  expect(pi.printed).toEqual([]);
});

test("the entry renderer draws the verdict and report, and skips an entry with no data", () => {
  const render = fakePi(settles(REPORT, 0)).renderers[DOCTOR_ENTRY];
  const theme = { fg: (_c: string, s: string) => s };
  expect(render?.({ data: undefined }, {}, theme)).toBeUndefined();
  const lines =
    render?.({ data: { kind: "report", exitCode: 0, report: REPORT } }, {}, theme)?.render(120) ??
    [];
  const text = lines.join("\n");
  expect(text).toContain(PASSED_VERDICT);
  expect(text).toContain("✓ daemon");
});

test.each([
  {},
  "x",
  { kind: "report", report: 3 },
  { kind: "report", report: "x" },
  { kind: "report", exitCode: 7, report: "x" },
  { kind: "no-report", exitCode: "1", reason: "x" },
])("the entry renderer skips persisted data of an unknown shape: %p", (data) => {
  const render = fakePi(settles(REPORT, 0)).renderers[DOCTOR_ENTRY];
  expect(render?.({ data }, {}, { fg: (_c: string, s: string) => s })).toBeUndefined();
});
