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
    daemon: { reachable: true, serviceInstalled: true, service: "caret" },
    lockAndPort: {
      lockExists: true,
      portServesCaret: true,
      lockPath: "/state/daemon.lock",
      lockPid: 111,
      pidAlive: true,
      portMismatch: false,
    },
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

test("a foreign server on the effective port fails daemon-reachable and names it", () => {
  const checks = runChecks(
    report({ daemon: { reachable: true, serviceInstalled: false, service: "other" } }),
  );
  const failed = check(checks, "daemon-reachable");
  expect(failed.status).toBe("fail");
  expect(failed.detail).toContain("other");
});

test("a degraded daemon section yields unknown, claiming nothing about the daemon", () => {
  const checks = runChecks(report({ daemon: { error: "probe boom" } }));
  const undecided = check(checks, "daemon-reachable");
  expect(undecided.status).toBe("unknown");
  expect(undecided.detail).toBe("");
});

// ---- daemon-lock ----

test("a lock whose pid is dead fails daemon-lock and names the file to delete", () => {
  const checks = runChecks(
    report({
      lockAndPort: {
        lockExists: true,
        portServesCaret: true,
        lockPath: "/state/daemon.lock",
        lockPid: 111,
        pidAlive: false,
        portMismatch: false,
      },
    }),
  );
  const failed = check(checks, "daemon-lock");
  expect(failed.status).toBe("fail");
  expect(failed.status === "fail" && failed.remedy).toContain("/state/daemon.lock");
});

test("a lock on a port other than the effective one fails daemon-lock", () => {
  const checks = runChecks(
    report({
      lockAndPort: {
        lockExists: true,
        portServesCaret: true,
        lockPid: 111,
        pidAlive: true,
        portMismatch: true,
      },
    }),
  );
  expect(check(checks, "daemon-lock").status).toBe("fail");
});

test("a degraded lockAndPort section yields unknown, claiming no lock state", () => {
  const checks = runChecks(report({ lockAndPort: { error: "probe boom" } }));
  const undecided = check(checks, "daemon-lock");
  expect(undecided.status).toBe("unknown");
  expect(undecided.detail).toBe("");
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

test("a degraded installState section yields unknown rather than the probe's own answer", () => {
  const checks = runChecks(report({ installState: { error: "probe boom" } }));
  const undecided = check(checks, "agent-install");
  expect(undecided.status).toBe("unknown");
  expect(undecided.detail).toBe("");
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

test("a degraded logs section yields unknown, claiming no log is clean", () => {
  const checks = runChecks(report({ logs: { error: "probe boom" } }));
  const undecided = check(checks, "log-errors");
  expect(undecided.status).toBe("unknown");
  expect(undecided.detail).toBe("");
});

// ---- the remedy contract ----

test("every failing check names a remedy and every unknown names a reason", () => {
  const checks = runChecks(
    report({
      daemon: { reachable: false, serviceInstalled: true },
      lockAndPort: {
        lockExists: true,
        portServesCaret: true,
        lockPath: "/state/daemon.lock",
        lockPid: 111,
        pidAlive: false,
        portMismatch: true,
      },
      installState: { pluginVersion: "1.2.3", pluginEnabled: false, hookInUserSettings: false },
      logs: {
        caret: log("/logs/caret.log", 1),
        daemon: log("/logs/daemon.log"),
        daemonStderr: log("/logs/daemon-stderr.log"),
      },
    }),
    [{ id: "x", title: "X", status: "unknown", detail: "d", reason: "offline" }],
  );
  expect(checks.filter((c) => c.status === "fail")).toHaveLength(4);
  for (const c of checks) {
    if (c.status === "fail") expect(c.remedy.length).toBeGreaterThan(0);
    if (c.status === "unknown") expect(c.reason.length).toBeGreaterThan(0);
  }
});

test("the caller's own checks are appended, in order, after the report-derived ones", () => {
  const adapterChecks: Check[] = [
    { id: "adapter-a", title: "A", status: "pass", detail: "current" },
    { id: "adapter-b", title: "B", status: "pass", detail: "current" },
  ];
  expect(runChecks(report(), adapterChecks).slice(-2)).toEqual(adapterChecks);
});

test("a fully degraded report decides nothing rather than passing every check", () => {
  const degraded = report({
    daemon: { error: "x" },
    lockAndPort: { error: "x" },
    installState: { error: "x" },
    logs: { error: "x" },
  });
  const checks = runChecks(degraded);
  expect(checks).toHaveLength(4);
  expect(checks.map((c) => c.status)).toEqual(checks.map(() => "unknown"));
  for (const c of checks) {
    expect(c.detail).toBe("");
    expect(c.status === "unknown" && c.reason.length).toBeGreaterThan(0);
  }
});
