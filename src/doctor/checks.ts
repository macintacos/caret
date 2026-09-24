// The verdict layer over a collected doctor report (EXC-1188): a flat list of checks,
// each failing one naming the remedy that closes it. Every check here is a pure function
// of fields collectReport already gathered, so the verdict costs no extra probe and no
// network — which is what lets `caret doctor` render one offline. A check the composition
// layer builds itself (the OpenCode version gap, which needs an adapter) is passed in and
// appended.
//
// A check never decides on what it could not read: a degraded { error } section yields
// `unknown`, claiming nothing in its detail. An install probe that answered "unknown" is
// a different thing — a real state the adapter reported — and passes. A `fail` is a claim
// caret has to be able to support.

import {
  type Check,
  ERROR_WINDOW_HOURS,
  inErrorWindow,
  isSectionError,
  type LogStats,
  type Report,
} from "@/doctor/report.ts";

/** A section's value, or undefined when it degraded to { error }. */
function present<T>(value: T | { error: string }): T | undefined {
  return isSectionError(value) ? undefined : value;
}

/** A check over a section that never collected: no verdict, and no detail to mistake for
 * one. */
function undecided(id: string, title: string, section: string): Check {
  return {
    id,
    title,
    status: "unknown",
    detail: "",
    reason: `the ${section} section could not be collected`,
  };
}

/** A daemon that is simply not running is healthy — an on-demand daemon idle-exits by
 * design. Only a machine whose install recorded a service unit has a supervisor that
 * should be keeping one up, which is the same gate prodEnsureDeps uses to decide whether
 * there is a supervisor at all. A reachable port is not enough on its own: httpHealth
 * accepts any 200 JSON, so the service it names is what separates caret's daemon from
 * whatever else is bound there. */
function daemonReachable(report: Report): Check {
  const daemon = present(report.daemon);
  if (daemon === undefined) return undecided("daemon-reachable", "Daemon", "daemon");
  if (daemon.serviceInstalled && !daemon.reachable) {
    return {
      id: "daemon-reachable",
      title: "Daemon",
      status: "fail",
      detail: "a caret service is recorded for this install, but /api/health did not answer",
      remedy:
        "run `caret install --refresh` — or check the service is not disabled — then read logs/daemon-stderr.log",
    };
  }
  if (daemon.reachable && daemon.service !== "caret") {
    return {
      id: "daemon-reachable",
      title: "Daemon",
      status: "fail",
      detail: `the effective port is answering as ${daemon.service ?? "an unnamed service"}, not caret`,
      remedy:
        "stop whatever is bound to caret's effective port, or set `[daemon] port` to a free one",
    };
  }
  return {
    id: "daemon-reachable",
    title: "Daemon",
    status: "pass",
    detail: daemon.reachable ? "answering on the effective port" : "not running",
  };
}

function daemonLock(report: Report): Check {
  const lock = present(report.lockAndPort);
  if (lock === undefined) return undecided("daemon-lock", "Daemon lock", "lockAndPort");
  const faults: string[] = [];
  const remedies: string[] = [];
  if (lock.pidAlive === false) {
    faults.push(`its pid ${lock.lockPid} is not alive`);
    remedies.push(`delete the stale lock at ${lock.lockPath}`);
  }
  if (lock.portMismatch === true) {
    faults.push(`its port ${lock.lockPort} is not the effective one`);
    remedies.push("restart caret so it binds the configured port");
  }
  if (faults.length === 0) {
    return {
      id: "daemon-lock",
      title: "Daemon lock",
      status: "pass",
      detail: lock.lockExists ? "live, on the effective port" : "no lock file",
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
  if (probe === undefined) return undecided("agent-install", "Agent install", "installState");
  if (probe.pluginEnabled === false) {
    return {
      id: "agent-install",
      title: "Agent install",
      status: "fail",
      detail: `${probe.agent} does not have caret enabled`,
      remedy: "run `caret install`",
    };
  }
  return {
    id: "agent-install",
    title: "Agent install",
    status: "pass",
    detail:
      probe.pluginEnabled === true
        ? `caret ${probe.pluginVersion} is enabled for ${probe.agent}`
        : `${probe.agent}'s install state could not be read`,
  };
}

function describeErrors(log: LogStats): string {
  const when = log.lastErrorAt ? `, last at ${log.lastErrorAt}` : "";
  return `${log.errors} error record(s) in ${log.path}${when}`;
}

/** Only a counted NDJSON record can move this check: logStats tallies `level` fields, so
 * daemon-stderr.log's raw crash output is summarized in the report but never weighed
 * here. Recency is judged against the report's own generatedAt, so the verdict stays a
 * pure function of the report and needs no clock. */
function logErrors(report: Report): Check {
  const logs = present(report.logs);
  if (logs === undefined) return undecided("log-errors", "Logs", "logs");
  const noisy = Object.values(logs).filter((l) => l.errors > 0);
  if (noisy.length === 0) {
    return {
      id: "log-errors",
      title: "Logs",
      status: "pass",
      detail: "no NDJSON error records",
    };
  }
  const generatedAt = Date.parse(report.generatedAt);
  // Older errors stay in the report, and the detail still names when each log last
  // erred, but they stop being a verdict.
  const erring = noisy.filter((l) => inErrorWindow(l.lastErrorAt, generatedAt));
  if (erring.length === 0) {
    return {
      id: "log-errors",
      title: "Logs",
      status: "pass",
      detail: `none in the last ${ERROR_WINDOW_HOURS}h; ${noisy.map(describeErrors).join("; ")}`,
    };
  }
  return {
    id: "log-errors",
    title: "Logs",
    status: "fail",
    detail: erring.map(describeErrors).join("; "),
    remedy: `read ${erring.map((l) => l.path).join(" and ")}, then /systematic-debugging`,
  };
}

/** Every verdict doctor can reach, in report order, with the caller's own checks — the
 * ones that need an adapter — appended last. */
export function runChecks(report: Report, adapterChecks: readonly Check[] = []): Check[] {
  return [
    daemonReachable(report),
    daemonLock(report),
    agentInstall(report),
    logErrors(report),
    ...adapterChecks,
  ];
}
