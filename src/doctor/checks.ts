// The verdict layer over a collected doctor report (EXC-1188): a flat list of checks,
// each failing one naming the remedy that closes it. Every check here is a pure function
// of fields collectReport already gathered, so the verdict costs no extra probe and no
// network — which is what lets `caret doctor` render one offline. A check the composition
// layer builds itself (the OpenCode version gap, which does need the registry) is passed
// in and appended.
//
// A check never fails on what it could not read: a degraded { error } section, or an
// install probe that answered "unknown", passes. The report already reports the
// degradation, and a `fail` is a claim caret has to be able to support.

import { type Check, isSectionError, type Report } from "@/doctor/report.ts";

/** A section's value, or undefined when it degraded to { error }. */
function present<T>(value: T | { error: string }): T | undefined {
  return isSectionError(value) ? undefined : value;
}

/** A daemon that is simply not running is healthy — an on-demand daemon idle-exits by
 * design. Only a machine whose install recorded a service unit has a supervisor that
 * should be keeping one up, which is the same gate prodEnsureDeps uses to decide whether
 * there is a supervisor at all. */
function daemonReachable(report: Report): Check {
  const daemon = present(report.daemon);
  const reachable = daemon?.reachable;
  if (daemon?.serviceInstalled === true && reachable === false) {
    return {
      id: "daemon-reachable",
      title: "Daemon",
      status: "fail",
      detail: "a caret service is installed, but /api/health did not answer",
      remedy: "run `caret install --refresh`, then read logs/daemon-stderr.log",
    };
  }
  return {
    id: "daemon-reachable",
    title: "Daemon",
    status: "pass",
    detail: reachable === true ? "answering on the effective port" : "not running",
  };
}

function daemonLock(report: Report): Check {
  const lock = present(report.lockAndPort);
  const faults: string[] = [];
  const remedies: string[] = [];
  if (lock?.pidAlive === false) {
    faults.push(`its pid ${String(lock.lockPid)} is not alive`);
    remedies.push("delete the stale daemon.lock in caret's state dir");
  }
  if (lock?.portMismatch === true) {
    faults.push(`its port ${String(lock.lockPort)} is not the effective one`);
    remedies.push("restart caret so it binds the configured port");
  }
  if (faults.length === 0) {
    return {
      id: "daemon-lock",
      title: "Daemon lock",
      status: "pass",
      detail: lock?.lockExists === true ? "live, on the effective port" : "no lock file",
    };
  }
  return {
    id: "daemon-lock",
    title: "Daemon lock",
    status: "fail",
    detail: faults.join("; "),
    remedy: remedies.join("; "),
  };
}

function agentInstall(report: Report): Check {
  const probe = present(report.installState);
  if (probe?.pluginEnabled === false) {
    return {
      id: "agent-install",
      title: "Agent install",
      status: "fail",
      detail: "the active agent does not have caret enabled",
      remedy: "run `caret install`",
    };
  }
  return {
    id: "agent-install",
    title: "Agent install",
    status: "pass",
    detail:
      probe?.pluginEnabled === true
        ? `caret ${String(probe.pluginVersion)} is enabled`
        : "the agent's install state could not be read",
  };
}

function logErrors(report: Report): Check {
  const logs = present(report.logs);
  const noisy = Object.values(logs ?? {}).filter((l) => l.errors > 0);
  if (noisy.length === 0) {
    return { id: "log-errors", title: "Logs", status: "pass", detail: "no error records" };
  }
  return {
    id: "log-errors",
    title: "Logs",
    status: "fail",
    detail: noisy.map((l) => `${l.errors} error record(s) in ${l.path}`).join("; "),
    remedy: `read ${noisy.map((l) => l.path).join(" and ")}, then /systematic-debugging`,
  };
}

/** Every verdict doctor can reach, in report order, with the caller's own check — the
 * one that needs an adapter — appended last. */
export function runChecks(report: Report, opencode?: Check): Check[] {
  const checks = [
    daemonReachable(report),
    daemonLock(report),
    agentInstall(report),
    logErrors(report),
  ];
  return opencode === undefined ? checks : [...checks, opencode];
}
