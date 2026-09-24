import { beforeEach, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { doctorDeps } from "@test/support/doctor-deps.ts";
import { setupTempStateDir } from "@test/support/env.ts";
import { expectNeverLogsBody } from "@test/support/redaction.ts";
import { daemonLock, reviewsDir } from "@/config/paths.ts";
import {
  type Check,
  collectReport,
  countLogLevels,
  type DoctorDeps,
  type DoctorDocument,
  type ErrorRecord,
  groupFailures,
  listProcesses,
  listReviewFiles,
  logErrorRecords,
  logStats,
  parseErrorRecords,
  parsePsLines,
  type Report,
  renderDocument,
  renderStdout,
  tallyReviews,
} from "@/doctor/report.ts";
import { scrubValue } from "@/redact/node.ts";

function boom(): never {
  throw new Error("probe boom");
}

/** The emitted document: a collected report plus whatever checks ran over it. */
async function document(
  over: Partial<DoctorDeps> = {},
  checks: Check[] = [],
): Promise<DoctorDocument> {
  return { ...(await collectReport(doctorDeps(over))), checks };
}

// ---- happy path ----

test("collectReport assembles a full document with every section present", async () => {
  const report = await collectReport(doctorDeps());
  expect(report.schema).toBe("caret-doctor/1");
  expect(report.version).toBe("1.2.3");
  expect(report.generatedAt).toBe("2026-06-04T12:00:00.000Z");
  for (const key of [
    "system",
    "install",
    "settings",
    "daemon",
    "lockAndPort",
    "processes",
    "reviews",
    "installState",
    "logs",
    "failures",
  ]) {
    expect(report).toHaveProperty(key);
  }
});

test("happy path populates the section scalars from the deps", async () => {
  const report = await collectReport(doctorDeps());
  expect(report.system).toEqual({ platform: "darwin", os: "macos", arch: "arm64" });
  expect(report.install).toEqual({ kind: "dev", binaryPath: "/bin/caret", bunVersion: "0.0.0" });
  expect(report.daemon).toMatchObject({
    reachable: true,
    service: "caret",
    daemonVersion: "1.2.3",
  });
  expect(report.settings).toMatchObject({
    configPath: "/cfg/config.toml",
    configExists: true,
    "logging.level": "info",
    "daemon.port": 42718,
    effectivePort: 42718,
    effectiveTimeoutMs: 3600000,
  });
});

test("the logs section carries one LogStats per live log path", async () => {
  const report = await collectReport(doctorDeps());
  expect(report.logs).toEqual({
    caret: { path: "/state/logs/caret.log", exists: true, size: 10, errors: 0, warns: 0 },
    daemon: { path: "/state/logs/daemon.log", exists: true, size: 10, errors: 0, warns: 0 },
    daemonStderr: {
      path: "/state/logs/daemon-stderr.log",
      exists: true,
      size: 10,
      errors: 0,
      warns: 0,
    },
  });
});

// ---- per-section degradation ----

const ALL_SECTIONS: Array<keyof Report> = [
  "system",
  "install",
  "settings",
  "daemon",
  "lockAndPort",
  "processes",
  "reviews",
  "installState",
  "logs",
  "failures",
];

// Each injectable probe gets a throwing fake. The probe's consuming section(s)
// degrade to { error }; every other section stays intact; the promise always
// resolves. Most probes feed one section, but a few are genuinely shared:
// health feeds daemon+lockAndPort, and readLock/isPidAlive feed
// lockAndPort+processes — those rows declare every affected section.
const degradations: Array<
  [label: string, over: Partial<DoctorDeps>, affected: Array<keyof Report>]
> = [
  ["system", { system: boom }, ["system"]],
  ["install", { install: boom }, ["install"]],
  ["settings", { settings: boom }, ["settings"]],
  ["health", { health: async () => boom() }, ["daemon", "lockAndPort"]],
  ["readLock", { readLock: boom }, ["lockAndPort", "processes"]],
  ["isPidAlive", { isPidAlive: boom }, ["lockAndPort", "processes"]],
  ["listProcesses", { listProcesses: boom }, ["processes"]],
  ["listReviewFiles", { listReviewFiles: boom }, ["reviews"]],
  ["readAgentInstallState", { readAgentInstallState: boom }, ["installState"]],
  [
    "logStats",
    {
      logStats: async () => {
        throw new Error("stat boom");
      },
    },
    ["logs"],
  ],
  [
    "logErrorRecords",
    {
      logErrorRecords: async () => {
        throw new Error("read boom");
      },
    },
    ["failures"],
  ],
];

for (const [label, over, affected] of degradations) {
  test(`a throwing ${label} probe degrades only its section(s) to { error } and still resolves`, async () => {
    const report = await collectReport(doctorDeps(over));
    for (const section of affected) expect(report[section]).toHaveProperty("error");
    for (const section of ALL_SECTIONS) {
      if (affected.includes(section)) continue;
      expect(report[section]).not.toHaveProperty("error");
    }
  });
}

// ---- shared single health probe ----

test("the daemon health is probed exactly once and shared between sections", async () => {
  let calls = 0;
  await collectReport(
    doctorDeps({
      health: async () => {
        calls++;
        return { service: "caret" };
      },
    }),
  );
  expect(calls).toBe(1);
});

// ---- daemon / lock / port reconciliation ----

test("lock port mismatch sets portMismatch and surfaces pidAlive from the fake", async () => {
  const report = await collectReport(
    doctorDeps({
      readLock: () => ({ pid: 222, port: 9999 }),
      isPidAlive: () => true,
      effective: () => ({
        port: 42718,
        idleMs: 60000,
        reviewTimeoutMs: 3600000,
        heartbeatMs: 8000,
      }),
    }),
  );
  expect(report.lockAndPort).toMatchObject({ lockPort: 9999, portMismatch: true, pidAlive: true });
});

test("a lock section carries the lock's own path, so the stale-lock remedy can name it", async () => {
  const report = await collectReport(doctorDeps());
  expect(report.lockAndPort).toMatchObject({ lockPath: daemonLock() });
});

test("a port held by a non-caret process is reachable but portServesCaret is false", async () => {
  const report = await collectReport(doctorDeps({ health: async () => ({ service: "other" }) }));
  expect(report.daemon).toMatchObject({ reachable: true, service: "other" });
  expect(report.lockAndPort).toMatchObject({ portServesCaret: false });
});

test("an unreachable daemon (null health) reports reachable:false without throwing", async () => {
  const report = await collectReport(doctorDeps({ health: async () => null }));
  expect(report.daemon).toEqual({ reachable: false, serviceInstalled: false });
  expect(report.lockAndPort).toMatchObject({ portServesCaret: false });
});

test("with no lock, lockAndPort still reports portServesCaret", async () => {
  const report = await collectReport(
    doctorDeps({ readLock: () => null, health: async () => ({ service: "caret" }) }),
  );
  expect(report.lockAndPort).toEqual({ lockExists: false, portServesCaret: true });
});

// A booting daemon has no lock yet, so the marker is reported whether or not one exists.
test("a boot marker reports its pid and age beside a missing lock", async () => {
  const report = await collectReport(
    doctorDeps({
      readLock: () => null,
      readBootMarker: () => ({ pid: 333, claimedAt: Date.parse("2026-06-04T11:59:58.000Z") }),
    }),
  );
  expect(report.lockAndPort).toMatchObject({
    lockExists: false,
    bootMarkerPid: 333,
    bootMarkerAgeMs: 2000,
  });
});

// ---- process merge ----

test("a live lock pid not already listed is merged in, tagged daemon.lock", async () => {
  const report = await collectReport(
    doctorDeps({
      listProcesses: () => [{ pid: 5, name: "caret-native" }],
      readLock: () => ({ pid: 99, port: 42718 }),
      isPidAlive: () => true,
    }),
  );
  expect(report.processes).toMatchObject({
    count: 2,
    items: [
      { pid: 5, name: "caret-native", identifiedBy: "ps comm" },
      { pid: 99, name: "caret-native", identifiedBy: "daemon.lock" },
    ],
  });
});

test("a lock pid already in the ps list is not duplicated", async () => {
  const report = await collectReport(
    doctorDeps({
      listProcesses: () => [{ pid: 99, name: "caret-native" }],
      readLock: () => ({ pid: 99, port: 42718 }),
      isPidAlive: () => true,
    }),
  );
  expect((report.processes as { count: number }).count).toBe(1);
});

test("a dead lock pid is not merged into the process list", async () => {
  const report = await collectReport(
    doctorDeps({
      listProcesses: () => [],
      readLock: () => ({ pid: 99, port: 42718 }),
      isPidAlive: () => false,
    }),
  );
  expect(report.processes).toEqual({ count: 0, items: [] });
});

// ---- reviews ----

test("an absent reviews dir yields zeroed tallies and no pending ids", async () => {
  const report = await collectReport(doctorDeps({ listReviewFiles: () => [] }));
  expect(report.reviews).toEqual({
    pending: 0,
    approved: 0,
    rejected: 0,
    expired: 0,
    other: 0,
    total: 0,
    pendingIds: [],
  });
});

test("pendingIds are truncated to 8 chars and capped at 8 entries", async () => {
  const records = Array.from({ length: 10 }, (_, i) => ({
    id: `pending-id-${i}-with-a-long-tail`,
    status: "pending",
  }));
  const report = await collectReport(doctorDeps({ listReviewFiles: () => records }));
  const reviews = report.reviews as { pending: number; pendingIds: string[] };
  expect(reviews.pending).toBe(10); // full count survives
  expect(reviews.pendingIds).toHaveLength(8); // sample is capped
  for (const id of reviews.pendingIds) expect(id.length).toBeLessThanOrEqual(8);
  expect(reviews.pendingIds[0]).toBe("pending-"); // first 8 chars of the first id
});

// ---- installState ----

test("installState unknowns pass through untouched", async () => {
  const report = await collectReport(
    doctorDeps({
      readAgentInstallState: () => ({
        agent: "test-agent",
        pluginVersion: "unknown",
        pluginEnabled: "unknown",
        hookInUserSettings: "unknown",
      }),
    }),
  );
  expect(report.installState).toEqual({
    agent: "test-agent",
    pluginVersion: "unknown",
    pluginEnabled: "unknown",
    hookInUserSettings: "unknown",
  });
});

// ---- redaction integration (the CLI caller always scrubs) ----

test("a leaked plan body in a review record is censored by scrubValue and the tally stays correct", async () => {
  const leaky = [
    { id: "abcdef12-0000", status: "pending", plan: "SECRET PLAN BODY TEXT" } as never,
  ];
  const report = await collectReport(doctorDeps({ listReviewFiles: () => leaky }));
  const scrubbed = scrubValue(report, true);
  expectNeverLogsBody(scrubbed, "SECRET PLAN BODY TEXT");
  // The tally is built from { id, status } only, so it is unaffected.
  expect(report.reviews).toMatchObject({ pending: 1, total: 1, pendingIds: ["abcdef12"] });
});

test("home paths and foreign usernames are scrubbed in the finished report", async () => {
  const home = homedir();
  const report = await collectReport(
    doctorDeps({
      install: () => ({
        kind: "prod",
        binaryPath: `${home}/.local/share/caret/bin/caret`,
        bunVersion: "0.0.0",
      }),
      configPath: "/Users/somebodyelse/.config/caret/config.toml",
    }),
  );
  const out = JSON.stringify(scrubValue(report, true));
  expect(out).toContain("~/.local/share/caret/bin/caret"); // own home → ~
  expect(out).toContain("/Users/<redacted>/.config"); // foreign username censored
  expect(out).not.toContain(home);
});

test("the report is flat enough that scrubValue never depth-caps a leaf", async () => {
  const report = await collectReport(
    doctorDeps({
      listProcesses: () => [{ pid: 1, name: "caret-native" }],
      readLock: () => ({ pid: 2, port: 42718, build: "b", version: "v", startedAt: 9 }),
      isPidAlive: () => true,
      listReviewFiles: () => [{ id: "abcdef12-0000", status: "pending" }],
      logErrorRecords: async () => [{ reviewId: "r1", step: "request", code: "request-failed" }],
    }),
  );
  expect(JSON.stringify(scrubValue(report, true))).not.toContain("<depth-capped>");
});

// ---- failures ----

/** Relative to the fixture's generatedAt of 2026-06-04T12:00:00.000Z. */
const NOW = Date.parse("2026-06-04T12:00:00.000Z");
const RECENT = "2026-06-04T11:00:00.000Z";

test("the failures section groups both logs' error records by review", async () => {
  const report = await collectReport(
    doctorDeps({
      logErrorRecords: async (path) =>
        path.endsWith("caret.log")
          ? [
              {
                time: RECENT,
                source: "hook",
                step: "longPoll",
                code: "review-timeout",
                reviewId: "r1",
              },
            ]
          : [
              {
                time: RECENT,
                source: "daemon",
                step: "request",
                code: "request-failed",
                reviewId: "r1",
              },
            ],
    }),
  );
  expect(report.failures).toEqual({
    windowHours: 24,
    total: 2,
    omitted: 0,
    groups: [
      {
        reviewId: "r1",
        records: [
          { time: RECENT, source: "hook", step: "longPoll", code: "review-timeout" },
          { time: RECENT, source: "daemon", step: "request", code: "request-failed" },
        ],
      },
    ],
    ungrouped: [],
  });
});

test("groupFailures groups by review, else session, in order of first appearance", () => {
  const records: ErrorRecord[] = [
    { time: "2026-06-04T11:00:00.000Z", step: "a", sessionId: "s1" },
    { time: "2026-06-04T11:01:00.000Z", step: "b", reviewId: "r1", sessionId: "s1" },
    { time: "2026-06-04T11:02:00.000Z", step: "c" },
    { time: "2026-06-04T11:03:00.000Z", step: "d", sessionId: "s1" },
  ];
  const { groups, ungrouped } = groupFailures(records, NOW);
  expect(groups).toEqual([
    {
      sessionId: "s1",
      records: [
        { time: "2026-06-04T11:00:00.000Z", step: "a" },
        { time: "2026-06-04T11:03:00.000Z", step: "d" },
      ],
    },
    { reviewId: "r1", records: [{ time: "2026-06-04T11:01:00.000Z", step: "b" }] },
  ]);
  expect(ungrouped).toEqual([{ time: "2026-06-04T11:02:00.000Z", step: "c" }]);
});

test("groupFailures shows an uncoded record without a code and passes an unknown code through", () => {
  const { ungrouped } = groupFailures(
    [
      { time: RECENT, step: "old" },
      { time: RECENT, step: "new", code: "not-yet-minted" },
    ],
    NOW,
  );
  expect(ungrouped).toEqual([
    { time: RECENT, step: "old" },
    { time: RECENT, step: "new", code: "not-yet-minted" },
  ]);
});

test("groupFailures leaves out records older than the window, but keeps undated ones", () => {
  const section = groupFailures(
    [{ time: "2026-06-01T12:00:00.000Z", step: "stale" }, { step: "undated" }],
    NOW,
  );
  expect(section.total).toBe(1);
  expect(section.ungrouped).toEqual([{ step: "undated" }]);
});

test("groupFailures keeps the newest 50 records and counts the rest as omitted", () => {
  const records: ErrorRecord[] = Array.from({ length: 60 }, (_, i) => ({
    time: new Date(NOW - (60 - i) * 1000).toISOString(),
    step: `s${i}`,
  }));
  const section = groupFailures([...records].reverse(), NOW);
  expect([section.total, section.omitted]).toEqual([60, 10]);
  expect(section.ungrouped.map((r) => r.step)).toEqual(records.slice(10).map((r) => r.step));
});

// ---- renderDocument ----

test("renderDocument renders the header and every section title for a happy report", async () => {
  const text = renderDocument(await document());
  expect(typeof text).toBe("string");
  expect(text).toContain("caret-doctor/1");
  for (const title of [
    "system:",
    "install:",
    "settings:",
    "daemon:",
    "lockAndPort:",
    "processes:",
    "reviews:",
    "installState:",
    "logs:",
    "failures:",
  ]) {
    expect(text).toContain(title);
  }
  // renderSection walks whatever keys a section carries, so a third log needs
  // no rendering change to show up.
  expect(text).toContain("daemonStderr");
});

test("renderDocument renders a degraded section as an error line and never throws", async () => {
  const text = renderDocument(await document({ system: boom }));
  expect(text).toContain("system error: probe boom");
});

test("renderDocument tolerates an all-degraded report without throwing", () => {
  const allError = {
    schema: "caret-doctor/1",
    version: "1.0.0",
    generatedAt: "2026-06-04T00:00:00.000Z",
    system: { error: "x" },
    install: { error: "x" },
    settings: { error: "x" },
    daemon: { error: "x" },
    lockAndPort: { error: "x" },
    processes: { error: "x" },
    reviews: { error: "x" },
    installState: { error: "x" },
    logs: { error: "x" },
    failures: { error: "x" },
    checks: [],
  } as DoctorDocument;
  expect(() => renderDocument(allError)).not.toThrow();
});

test("the checks block renders before the first state section", async () => {
  const text = renderDocument(
    await document({}, [
      { id: "daemon-lock", title: "Daemon lock", status: "pass", detail: "on port 42718" },
    ]),
  );
  expect(text.indexOf("checks:")).toBeGreaterThan(-1);
  expect(text.indexOf("checks:")).toBeLessThan(text.indexOf("system:"));
  expect(text).toContain("✓ daemon-lock");
});

test("a failing check renders its remedy and an unknown one its reason", async () => {
  const text = renderDocument(
    await document({}, [
      { id: "log-errors", title: "Logs", status: "fail", detail: "2 errors", remedy: "read x.log" },
      {
        id: "opencode-caret-version",
        title: "OpenCode",
        status: "unknown",
        detail: "",
        reason: "offline",
      },
    ]),
  );
  expect(text).toContain("✗ log-errors");
  expect(text).toContain("remedy: read x.log");
  expect(text).toContain("? opencode-caret-version");
  expect(text).toContain("reason: offline");
  // A check that claims nothing — every degraded section's — carries no detail, so it
  // must not render a separator with nothing after it.
  expect(text).not.toContain("opencode-caret-version —");
});

test("the status markers stay uncolored unless the caller asks for color", async () => {
  const checks: Check[] = [
    { id: "daemon-lock", title: "Daemon lock", status: "pass", detail: "live" },
    { id: "log-errors", title: "Logs", status: "fail", detail: "2 errors", remedy: "read x.log" },
    { id: "opencode-caret-version", title: "OpenCode", status: "unknown", detail: "", reason: "x" },
  ];
  const doc = await document({}, checks);
  expect(renderStdout(doc, "text")).not.toContain("\x1b[");
  const colored = renderStdout(doc, "text", true);
  expect(colored).toContain("\x1b[32m✓\x1b[0m daemon-lock");
  expect(colored).toContain("\x1b[31m✗\x1b[0m log-errors");
  expect(colored).toContain("\x1b[33m?\x1b[0m opencode-caret-version");
  // Only the marker is colored: the rest of the line pastes clean.
  expect(colored).toContain("daemon-lock — live");
});

test("the json format carries no color, whatever the caller asked for", async () => {
  const doc = await document({}, [
    { id: "daemon-lock", title: "Daemon lock", status: "pass", detail: "live" },
  ]);
  const json = renderStdout(doc, "json", true);
  expect(json).not.toContain("\x1b[");
  expect(JSON.parse(json).checks[0].status).toBe("pass");
});

// ---- the stdout path is scrubbed as one document ----

for (const format of ["text", "json"] as const) {
  test(`renderStdout (${format}) scrubs the checks alongside the report sections`, async () => {
    const home = homedir();
    const doc = await document({ configPath: `${home}/.config/caret/config.toml` }, [
      {
        id: "log-errors",
        title: "Logs",
        status: "fail",
        detail: `2 errors in ${home}/.local/state/caret/logs/caret.log`,
        remedy: `read ${home}/.local/state/caret/logs/caret.log`,
      },
    ]);
    const out = renderStdout(doc, format);
    expectNeverLogsBody(out, home);
    expect(out).toContain("~/.local/state/caret/logs/caret.log");
  });
}

// ---- pure helpers ----

test("parsePsLines extracts caret entries, basenames full-path comms, and ignores noise", () => {
  const text = [
    "  101 /usr/local/bin/caret-native",
    "202 caret-native",
    "303 node",
    "505 /home/u/.local/share/caret/bin/caret", // the shim, not the daemon binary
    "404 /Applications/Some.app/Contents/MacOS/caretaker", // not the "caret-native" basename
    "garbage line with no pid",
    "   ",
  ].join("\n");
  expect(parsePsLines(text)).toEqual([
    { pid: 101, name: "caret-native" },
    { pid: 202, name: "caret-native" },
  ]);
});

test("countLogLevels tallies levels, skips malformed and raw crash lines", () => {
  const text = [
    '{"level":30,"msg":"info"}',
    '{"level":40,"msg":"warn"}',
    '{"level":50,"time":"2026-06-04T10:00:00.000Z","msg":"error"}',
    // >= 50 counts as an error too, and the last one dates the tally.
    '{"level":60,"time":"2026-06-04T11:00:00.000Z","msg":"fatal"}',
    "not json at all (raw crash output)",
    '{"level":"oops"}', // non-numeric level — skipped
    "{ malformed json",
  ].join("\n");
  expect(countLogLevels(text, false)).toEqual({
    errors: 2,
    warns: 1,
    lastErrorAt: "2026-06-04T11:00:00.000Z",
  });
});

test("countLogLevels leaves the error time unknown when the newest error carries none", () => {
  const text = [
    '{"level":50,"time":"2026-06-04T10:00:00.000Z","msg":"dated"}',
    '{"level":50,"msg":"undated"}',
  ].join("\n");
  // Reporting the older record's time would date the tally as settled when the newest
  // error is in fact undatable.
  expect(countLogLevels(text, false)).toEqual({ errors: 2, warns: 0, lastErrorAt: undefined });
});

test("countLogLevels drops a partial first line when the tail started mid-file", () => {
  const text = ['l":50,"msg":"partial"}', '{"level":40,"msg":"warn"}'].join("\n");
  // First line is a mid-record fragment; with dropFirstLine it is ignored.
  expect(countLogLevels(text, true)).toMatchObject({ errors: 0, warns: 1 });
  // Without the drop, that fragment still doesn't start with "{" so it's skipped
  // anyway — here the drop matters only for a fragment that DID start with "{".
  const startsWithBrace = ['{"level":50}', '{"level":40}'].join("\n");
  expect(countLogLevels(startsWithBrace, true)).toMatchObject({ errors: 0, warns: 1 });
  expect(countLogLevels(startsWithBrace, false)).toMatchObject({ errors: 1, warns: 1 });
});

test("parseErrorRecords keeps only the triage fields of error records, never their text", () => {
  const text = [
    '{"level":40,"step":"warned","msg":"warn"}',
    JSON.stringify({
      level: 50,
      time: RECENT,
      source: "hook",
      step: "longPoll",
      code: "review-timeout",
      reviewId: "r1",
      sessionId: "s1",
      cwd: "/Users/someone/proj",
      msg: "SENSITIVE MSG",
      err: { message: "SENSITIVE ERR", stack: "SENSITIVE STACK" },
    }),
    '{"level":50,"step":7,"code":null}',
    "raw crash output line",
  ].join("\n");
  const records = parseErrorRecords(text, false);
  expect(records).toEqual([
    {
      time: RECENT,
      source: "hook",
      step: "longPoll",
      code: "review-timeout",
      reviewId: "r1",
      sessionId: "s1",
    },
    {},
  ]);
  expectNeverLogsBody(records, ["SENSITIVE MSG", "SENSITIVE ERR", "SENSITIVE STACK"]);
});

test("tallyReviews counts mixed statuses, routing an unknown status to other", () => {
  const records = [
    { id: "p1xxxxxx", status: "pending" },
    { id: "p2xxxxxx", status: "pending" },
    { id: "a1xxxxxx", status: "approved" },
    { id: "r1xxxxxx", status: "rejected" },
    { id: "e1xxxxxx", status: "expired" },
    { id: "u1xxxxxx", status: "superseded" }, // unknown → other
  ];
  expect(tallyReviews(records)).toEqual({
    pending: 2,
    approved: 1,
    rejected: 1,
    expired: 1,
    other: 1,
    total: 6,
    pendingIds: ["p1xxxxxx", "p2xxxxxx"],
  });
});

// ---- production probe readers (filesystem / process) ----

// Point XDG_STATE_HOME at a throwaway temp dir so the readers touch disposable
// state, never the real ~/.local/state/caret. The state dir + its XDG wiring
// come from the shared helper.
const stateDir = setupTempStateDir("caret-doctor-");
let tmp: string;
beforeEach(() => {
  tmp = stateDir();
});

test("listReviewFiles returns [] when the reviews dir is absent", () => {
  expect(listReviewFiles()).toEqual([]);
});

test("listReviewFiles plucks only id+status and skips corrupt files and non-json", async () => {
  const dir = reviewsDir();
  await rm(dir, { recursive: true, force: true });
  const { mkdir } = await import("node:fs/promises");
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "good.json"),
    JSON.stringify({
      id: "rid-1",
      status: "pending",
      plan: "SECRET PLAN",
      generalCommentDraft: "SECRET DRAFT",
      composerScratches: [{ startLine: 1, endLine: 1, text: "SECRET SCRATCH" }],
    }),
  );
  await writeFile(join(dir, "corrupt.json"), "{ not valid json");
  await writeFile(join(dir, "notes.txt"), "ignored, not json");
  const out = listReviewFiles();
  expect(out).toEqual([{ id: "rid-1", status: "pending" }]);
  // The plan/draft bodies — including the persisted composer scratches — are
  // never read into the return value.
  expectNeverLogsBody(out, ["SECRET PLAN", "SECRET DRAFT", "SECRET SCRATCH"]);
});

test("logStats reports a missing file as not-existing with zeroed counts", async () => {
  const stats = await logStats(join(tmp, "nope.log"));
  expect(stats).toEqual({
    path: join(tmp, "nope.log"),
    exists: false,
    size: 0,
    errors: 0,
    warns: 0,
  });
});

test("logStats counts error/warn records and reports the size, never the text", async () => {
  const path = join(tmp, "caret.log");
  const body = [
    '{"level":30,"msg":"info SENSITIVE"}',
    '{"level":40,"msg":"warn"}',
    '{"level":50,"time":"2026-06-04T10:00:00.000Z","msg":"error"}',
    "raw crash output line",
  ].join("\n");
  await writeFile(path, body);
  const stats = await logStats(path);
  expect(stats).toMatchObject({
    exists: true,
    errors: 1,
    warns: 1,
    lastErrorAt: "2026-06-04T10:00:00.000Z",
  });
  expect(stats.size).toBeGreaterThan(0);
  // Only the contract fields are present — no log text leaks.
  expect(Object.keys(stats).sort()).toEqual([
    "errors",
    "exists",
    "lastErrorAt",
    "path",
    "size",
    "warns",
  ]);
  expectNeverLogsBody(stats, "SENSITIVE");
});

test("logErrorRecords reads a missing log as no failures", async () => {
  expect(await logErrorRecords(join(tmp, "nope.log"))).toEqual([]);
});

test("logErrorRecords reads the error records from a log's tail", async () => {
  const path = join(tmp, "daemon.log");
  await writeFile(
    path,
    ['{"level":30,"step":"listen"}', '{"level":50,"step":"request","code":"request-failed"}'].join(
      "\n",
    ),
  );
  expect(await logErrorRecords(path)).toEqual([{ step: "request", code: "request-failed" }]);
});

test("listProcesses returns an array and never throws", () => {
  // Hits the real `ps`; we assert the contract (an array of {pid,name}), not a
  // particular process — caret may or may not be running.
  const procs = listProcesses();
  expect(Array.isArray(procs)).toBe(true);
  for (const p of procs) {
    expect(typeof p.pid).toBe("number");
    expect(p.name).toBe("caret-native");
  }
});
