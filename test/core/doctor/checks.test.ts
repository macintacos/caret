import { expect, test } from "bun:test";

import { runChecks } from "@/doctor/checks.ts";
import type { Check, LogStats, Report } from "@/doctor/report.ts";

function log(path: string, errors = 0): LogStats {
  return { path, exists: true, size: 10, errors, warns: 0 };
}

/** An install with nothing wrong with it; each test breaks exactly one thing. */
function report(over: Partial<Report> = {}): Report {
  return {
    schema: "caret-doctor/1",
    version: "1.2.3",
    generatedAt: "2026-06-04T12:00:00.000Z",
    system: { platform: "darwin", os: "macos", arch: "arm64" },
    install: { kind: "prod", binaryPath: "/bin/caret", bunVersion: "0.0.0" },
    settings: {},
    daemon: { reachable: true, serviceInstalled: true },
    lockAndPort: { lockExists: true, lockPid: 111, pidAlive: true, portMismatch: false },
    processes: { count: 1, items: [{ pid: 111, name: "caret-native", identifiedBy: "ps comm" }] },
    reviews: {
      pending: 0,
      approved: 0,
      rejected: 0,
      expired: 0,
      other: 0,
      total: 0,
      pendingIds: [],
    },
    installState: { pluginVersion: "1.2.3", pluginEnabled: true, hookInUserSettings: false },
    logs: {
      caret: log("/logs/caret.log"),
      daemon: log("/logs/daemon.log"),
      daemonStderr: log("/logs/daemon-stderr.log"),
    },
    ...over,
  };
}

function check(checks: Check[], id: string): Check {
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check with id ${id}`);
  return found;
}

test("a healthy install passes every check", () => {
  const checks = runChecks(report());
  expect(checks.map((c) => c.status)).toEqual(checks.map(() => "pass"));
  expect(checks.map((c) => c.id)).toEqual([
    "daemon-reachable",
    "daemon-lock",
    "agent-install",
    "log-errors",
  ]);
});

// ---- daemon-reachable ----

test("an unreachable daemon with a supervisor installed fails daemon-reachable", () => {
  const checks = runChecks(report({ daemon: { reachable: false, serviceInstalled: true } }));
  expect(check(checks, "daemon-reachable").status).toBe("fail");
});

test("an unreachable daemon with no supervisor installed passes — on-demand daemons idle-exit", () => {
  const checks = runChecks(report({ daemon: { reachable: false, serviceInstalled: false } }));
  expect(check(checks, "daemon-reachable").status).toBe("pass");
});

test("a degraded daemon section cannot fail daemon-reachable", () => {
  const checks = runChecks(report({ daemon: { error: "probe boom" } }));
  expect(check(checks, "daemon-reachable").status).toBe("pass");
});

// ---- daemon-lock ----

test("a lock whose pid is dead fails daemon-lock", () => {
  const checks = runChecks(
    report({
      lockAndPort: { lockExists: true, lockPid: 111, pidAlive: false, portMismatch: false },
    }),
  );
  expect(check(checks, "daemon-lock").status).toBe("fail");
});

test("a lock on a port other than the effective one fails daemon-lock", () => {
  const checks = runChecks(
    report({ lockAndPort: { lockExists: true, lockPid: 111, pidAlive: true, portMismatch: true } }),
  );
  expect(check(checks, "daemon-lock").status).toBe("fail");
});

test("no lock at all passes daemon-lock", () => {
  const checks = runChecks(report({ lockAndPort: { lockExists: false, portServesCaret: false } }));
  expect(check(checks, "daemon-lock").status).toBe("pass");
});

// ---- agent-install ----

test("an agent that has caret disabled fails agent-install", () => {
  const checks = runChecks(
    report({
      installState: { pluginVersion: "1.2.3", pluginEnabled: false, hookInUserSettings: false },
    }),
  );
  expect(check(checks, "agent-install").status).toBe("fail");
});

test("an unreadable pluginEnabled passes agent-install rather than failing on a guess", () => {
  const checks = runChecks(
    report({
      installState: {
        pluginVersion: "unknown",
        pluginEnabled: "unknown",
        hookInUserSettings: "unknown",
      },
    }),
  );
  expect(check(checks, "agent-install").status).toBe("pass");
});

// ---- log-errors ----

test("an error record in any live log fails log-errors and names the log to read", () => {
  const checks = runChecks(
    report({
      logs: {
        caret: log("/logs/caret.log"),
        daemon: log("/logs/daemon.log", 3),
        daemonStderr: log("/logs/daemon-stderr.log"),
      },
    }),
  );
  const failed = check(checks, "log-errors");
  expect(failed.status).toBe("fail");
  expect(failed.status === "fail" && failed.remedy).toContain("/logs/daemon.log");
});

// ---- the remedy contract ----

test("every failing check names a remedy and every unknown names a reason", () => {
  const checks = runChecks(
    report({
      daemon: { reachable: false, serviceInstalled: true },
      lockAndPort: { lockExists: true, lockPid: 111, pidAlive: false, portMismatch: true },
      installState: { pluginVersion: "1.2.3", pluginEnabled: false, hookInUserSettings: false },
      logs: {
        caret: log("/logs/caret.log", 1),
        daemon: log("/logs/daemon.log"),
        daemonStderr: log("/logs/daemon-stderr.log"),
      },
    }),
    { id: "x", title: "X", status: "unknown", detail: "d", reason: "offline" },
  );
  expect(checks.filter((c) => c.status === "fail")).toHaveLength(4);
  for (const c of checks) {
    if (c.status === "fail") expect(c.remedy.length).toBeGreaterThan(0);
    if (c.status === "unknown") expect(c.reason.length).toBeGreaterThan(0);
  }
});

test("the caller's own check is appended after the report-derived ones", () => {
  const opencode: Check = {
    id: "opencode-caret-version",
    title: "OpenCode's caret",
    status: "pass",
    detail: "current",
  };
  expect(runChecks(report(), opencode).at(-1)).toEqual(opencode);
});

test("a fully degraded report yields checks without failing any of them", () => {
  const degraded = report({
    daemon: { error: "x" },
    lockAndPort: { error: "x" },
    installState: { error: "x" },
    logs: { error: "x" },
  });
  const checks = runChecks(degraded);
  expect(checks).toHaveLength(4);
  expect(checks.some((c) => c.status === "fail")).toBe(false);
});
