import { beforeEach, expect, test } from "bun:test";
import { rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { setupTempStateDir } from "@test/support/env.ts";
import { expectNeverLogsBody } from "@test/support/redaction.ts";
import { reviewsDir } from "@/config/paths.ts";
import { DEFAULTS } from "@/config/settings.ts";
import {
  collectReport,
  countLogLevels,
  type DiscoveryDeps,
  listProcesses,
  listReviewFiles,
  logStats,
  parsePsLines,
  type Report,
  renderReport,
  tallyReviews,
} from "@/discovery.ts";
import { scrubValue } from "@/redact/node.ts";

function boom(): never {
  throw new Error("probe boom");
}

// Happy-path fakes for every injected probe; each test overrides only what it
// exercises (mirrors review.test.ts's reviewDeps factory).
function discoveryDeps(over: Partial<DiscoveryDeps> = {}): DiscoveryDeps {
  return {
    now: () => new Date("2026-06-04T12:00:00.000Z"),
    version: "1.2.3",
    system: () => ({ platform: "darwin", os: "macos", arch: "arm64" }),
    install: () => ({ kind: "dev", binaryPath: "/bin/caret", bunVersion: "1.2.0" }),
    settings: () => DEFAULTS,
    configPath: "/cfg/config.toml",
    configExists: () => true,
    effective: () => ({
      port: 42718,
      idleMs: 60000,
      reviewTimeoutMs: 3600000,
      heartbeatMs: 8000,
    }),
    baseUrl: "http://localhost:42718",
    health: async () => ({ service: "caret", version: "1.2.3", build: "abc", commit: "def" }),
    readLock: () => ({ pid: 111, port: 42718, build: "abc", version: "1.2.3", startedAt: 9 }),
    isPidAlive: () => true,
    listProcesses: () => [{ pid: 111, name: "caret-native" }],
    listReviewFiles: () => [{ id: "abcdef12-0000", status: "pending" }],
    readAgentInstallState: () => ({
      pluginVersion: "0.0.3",
      pluginEnabled: true,
      hookInUserSettings: false,
    }),
    logStats: async (path: string) => ({ path, exists: true, size: 10, errors: 0, warns: 0 }),
    logPaths: {
      caret: "/state/logs/caret.log",
      daemon: "/state/logs/daemon.log",
      daemonStderr: "/state/logs/daemon-stderr.log",
    },
    ...over,
  };
}

// ---- happy path ----

test("collectReport assembles a full document with every section present", async () => {
  const report = await collectReport(discoveryDeps());
  expect(report.schema).toBe("caret-discovery/1");
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
  ]) {
    expect(report).toHaveProperty(key);
  }
});

test("happy path populates the section scalars from the deps", async () => {
  const report = await collectReport(discoveryDeps());
  expect(report.system).toEqual({ platform: "darwin", os: "macos", arch: "arm64" });
  expect(report.install).toEqual({ kind: "dev", binaryPath: "/bin/caret", bunVersion: "1.2.0" });
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
  const report = await collectReport(discoveryDeps());
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
];

// Each injectable probe gets a throwing fake. The probe's consuming section(s)
// degrade to { error }; every other section stays intact; the promise always
// resolves. Most probes feed one section, but a few are genuinely shared:
// health feeds daemon+lockAndPort, and readLock/isPidAlive feed
// lockAndPort+processes — those rows declare every affected section.
const degradations: Array<
  [label: string, over: Partial<DiscoveryDeps>, affected: Array<keyof Report>]
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
];

for (const [label, over, affected] of degradations) {
  test(`a throwing ${label} probe degrades only its section(s) to { error } and still resolves`, async () => {
    const report = await collectReport(discoveryDeps(over));
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
    discoveryDeps({
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
    discoveryDeps({
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

test("a port held by a non-caret process is reachable but portServesCaret is false", async () => {
  const report = await collectReport(discoveryDeps({ health: async () => ({ service: "other" }) }));
  expect(report.daemon).toMatchObject({ reachable: true, service: "other" });
  expect(report.lockAndPort).toMatchObject({ portServesCaret: false });
});

test("an unreachable daemon (null health) reports reachable:false without throwing", async () => {
  const report = await collectReport(discoveryDeps({ health: async () => null }));
  expect(report.daemon).toEqual({ reachable: false });
  expect(report.lockAndPort).toMatchObject({ portServesCaret: false });
});

test("with no lock, lockAndPort still reports portServesCaret", async () => {
  const report = await collectReport(
    discoveryDeps({ readLock: () => null, health: async () => ({ service: "caret" }) }),
  );
  expect(report.lockAndPort).toEqual({ lockExists: false, portServesCaret: true });
});

// ---- process merge ----

test("a live lock pid not already listed is merged in, tagged daemon.lock", async () => {
  const report = await collectReport(
    discoveryDeps({
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
    discoveryDeps({
      listProcesses: () => [{ pid: 99, name: "caret-native" }],
      readLock: () => ({ pid: 99, port: 42718 }),
      isPidAlive: () => true,
    }),
  );
  expect((report.processes as { count: number }).count).toBe(1);
});

test("a dead lock pid is not merged into the process list", async () => {
  const report = await collectReport(
    discoveryDeps({
      listProcesses: () => [],
      readLock: () => ({ pid: 99, port: 42718 }),
      isPidAlive: () => false,
    }),
  );
  expect(report.processes).toEqual({ count: 0, items: [] });
});

// ---- reviews ----

test("an absent reviews dir yields zeroed tallies and no pending ids", async () => {
  const report = await collectReport(discoveryDeps({ listReviewFiles: () => [] }));
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
  const report = await collectReport(discoveryDeps({ listReviewFiles: () => records }));
  const reviews = report.reviews as { pending: number; pendingIds: string[] };
  expect(reviews.pending).toBe(10); // full count survives
  expect(reviews.pendingIds).toHaveLength(8); // sample is capped
  for (const id of reviews.pendingIds) expect(id.length).toBeLessThanOrEqual(8);
  expect(reviews.pendingIds[0]).toBe("pending-"); // first 8 chars of the first id
});

// ---- installState ----

test("installState unknowns pass through untouched", async () => {
  const report = await collectReport(
    discoveryDeps({
      readAgentInstallState: () => ({
        pluginVersion: "unknown",
        pluginEnabled: "unknown",
        hookInUserSettings: "unknown",
      }),
    }),
  );
  expect(report.installState).toEqual({
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
  const report = await collectReport(discoveryDeps({ listReviewFiles: () => leaky }));
  const scrubbed = scrubValue(report, true);
  expectNeverLogsBody(scrubbed, "SECRET PLAN BODY TEXT");
  // The tally is built from { id, status } only, so it is unaffected.
  expect(report.reviews).toMatchObject({ pending: 1, total: 1, pendingIds: ["abcdef12"] });
});

test("home paths and foreign usernames are scrubbed in the finished report", async () => {
  const home = homedir();
  const report = await collectReport(
    discoveryDeps({
      install: () => ({
        kind: "prod",
        binaryPath: `${home}/.local/share/caret/bin/caret`,
        bunVersion: "1.2.0",
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
    discoveryDeps({
      listProcesses: () => [{ pid: 1, name: "caret-native" }],
      readLock: () => ({ pid: 2, port: 42718, build: "b", version: "v", startedAt: 9 }),
      isPidAlive: () => true,
      listReviewFiles: () => [{ id: "abcdef12-0000", status: "pending" }],
    }),
  );
  expect(JSON.stringify(scrubValue(report, true))).not.toContain("<depth-capped>");
});

// ---- renderReport ----

test("renderReport renders the header and every section title for a happy report", async () => {
  const report = await collectReport(discoveryDeps());
  const text = renderReport(report);
  expect(typeof text).toBe("string");
  expect(text).toContain("caret-discovery/1");
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
  ]) {
    expect(text).toContain(title);
  }
  // renderSection walks whatever keys a section carries, so a third log needs
  // no rendering change to show up.
  expect(text).toContain("daemonStderr");
});

test("renderReport renders a degraded section as an error line and never throws", async () => {
  const report = await collectReport(discoveryDeps({ system: boom }));
  const text = renderReport(report);
  expect(text).toContain("system error: probe boom");
});

test("renderReport tolerates an all-degraded report without throwing", () => {
  const allError = {
    schema: "caret-discovery/1",
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
  } as Report;
  expect(() => renderReport(allError)).not.toThrow();
});

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
    '{"level":50,"msg":"error"}',
    '{"level":60,"msg":"fatal"}', // >= 50 counts as an error too
    "not json at all (raw crash output)",
    '{"level":"oops"}', // non-numeric level — skipped
    "{ malformed json",
  ].join("\n");
  expect(countLogLevels(text, false)).toEqual({ errors: 2, warns: 1 });
});

test("countLogLevels drops a partial first line when the tail started mid-file", () => {
  const text = ['l":50,"msg":"partial"}', '{"level":40,"msg":"warn"}'].join("\n");
  // First line is a mid-record fragment; with dropFirstLine it is ignored.
  expect(countLogLevels(text, true)).toEqual({ errors: 0, warns: 1 });
  // Without the drop, that fragment still doesn't start with "{" so it's skipped
  // anyway — here the drop matters only for a fragment that DID start with "{".
  const startsWithBrace = ['{"level":50}', '{"level":40}'].join("\n");
  expect(countLogLevels(startsWithBrace, true)).toEqual({ errors: 0, warns: 1 });
  expect(countLogLevels(startsWithBrace, false)).toEqual({ errors: 1, warns: 1 });
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
const stateDir = setupTempStateDir("caret-discovery-");
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
    '{"level":50,"msg":"error"}',
    "raw crash output line",
  ].join("\n");
  await writeFile(path, body);
  const stats = await logStats(path);
  expect(stats).toMatchObject({ exists: true, errors: 1, warns: 1 });
  expect(stats.size).toBeGreaterThan(0);
  // Only the contract fields are present — no log text leaks.
  expect(Object.keys(stats).sort()).toEqual(["errors", "exists", "path", "size", "warns"]);
  expectNeverLogsBody(stats, "SENSITIVE");
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
