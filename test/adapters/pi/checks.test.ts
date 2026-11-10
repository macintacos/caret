// doctor's pi checks: which of `pi-host`, `pi-caret-entry`, and `pi-caret-version` run
// for pi's user settings, and how each passes, fails, or goes unknown.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readPiChecks } from "@/adapters/pi/checks.ts";
import { PI_FLOOR, PI_PACKAGE, type PiVersion } from "@/adapters/pi/host.ts";
import type { Check } from "@/doctor/report.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "install");
const ALL_IDS = ["pi-host", "pi-caret-entry", "pi-caret-version"];

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-pi-checks-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** An agent dir whose settings list `packages`, with caret's npm package at `npmVersion`. */
function agentDir(packages: unknown[], npmVersion?: string): string {
  const dir = join(tmp, "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify({ packages }));
  if (npmVersion !== undefined) {
    const pkg = join(dir, "npm", "node_modules", "@macintacos", "caret");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(
      join(pkg, "package.json"),
      JSON.stringify({ name: "@macintacos/caret", version: npmVersion }),
    );
  }
  return dir;
}

async function run(dir: string, opts: { piVersion?: PiVersion; published?: string | null } = {}) {
  const called = { piVersion: false, published: false };
  const checks = await readPiChecks({
    agentDir: dir,
    home: tmp,
    piVersion: () => {
      called.piVersion = true;
      return opts.piVersion ?? { status: "ok", version: "1.5.0" };
    },
    published: async () => {
      called.published = true;
      return opts.published === undefined ? "1.8.1" : opts.published;
    },
  });
  return { checks, called };
}

function byId(checks: Check[], id: string): Check {
  const check = checks.find((c) => c.id === id);
  if (check === undefined) throw new Error(`no ${id} check`);
  return check;
}

function remedy(check: Check): string {
  return check.status === "fail" ? check.remedy : "";
}

function reason(check: Check): string {
  return check.status === "unknown" ? check.reason : "";
}

test.each([
  ["no caret entry", () => join(FIXTURES, "no-entry")],
  ["no settings.json", () => join(tmp, "missing")],
])("settings with %s run no check, spawn no pi, and fetch nothing", async (_, dir) => {
  const { checks, called } = await run(dir());
  expect(checks).toEqual([]);
  expect(called).toEqual({ piVersion: false, published: false });
});

function malformedDir(): string {
  const dir = join(tmp, "malformed");
  mkdirSync(dir);
  writeFileSync(join(dir, "settings.json"), "{ not json");
  return dir;
}

test.each([
  ["unreadable", () => join(FIXTURES, "unreadable")],
  ["malformed", malformedDir],
])("%s settings report every pi check unknown without spawning pi", async (_, dir) => {
  const { checks, called } = await run(dir());
  expect(checks.map((c) => c.id)).toEqual(ALL_IDS);
  expect(checks.every((c) => c.status === "unknown")).toBe(true);
  expect(checks.every((c) => reason(c).includes("settings.json"))).toBe(true);
  expect(called.piVersion).toBe(false);
});

const HOST_CASES: {
  version: PiVersion;
  status: Check["status"];
  detail: string[];
  remedy: string[];
}[] = [
  {
    version: { status: "missing" },
    status: "fail",
    detail: ["pi --version"],
    remedy: [PI_PACKAGE],
  },
  {
    version: { status: "too-old", version: "1.4.9" },
    status: "fail",
    detail: ["1.4.9", PI_FLOOR],
    remedy: [PI_PACKAGE],
  },
  {
    version: { status: "pre-rename", version: "0.9.0" },
    status: "fail",
    detail: ["@mariozechner/pi-coding-agent"],
    remedy: [PI_PACKAGE],
  },
  { version: { status: "ok", version: "1.5.0" }, status: "pass", detail: ["1.5.0"], remedy: [] },
];

test.each(HOST_CASES)("pi-host for $version.status is $status", async (c) => {
  const { checks } = await run(join(FIXTURES, "npm-entry"), { piVersion: c.version });
  const host = byId(checks, "pi-host");
  expect(host.status).toBe(c.status);
  for (const s of c.detail) expect(host.detail).toContain(s);
  for (const s of c.remedy) expect(remedy(host)).toContain(s);
});

test("several entry faults join into one fail with each remedy named once", async () => {
  const dir = agentDir(["npm:@macintacos/caret", "npm:@macintacos/caret"]);
  const entry = byId((await run(dir)).checks, "pi-caret-entry");
  expect(entry.status).toBe("fail");
  expect(entry.detail).toContain("2 times");
  expect(entry.detail).toContain("isn't installed");
  expect(remedy(entry).split("pi install npm:@macintacos/caret").length - 1).toBe(1);
});

test.each([
  ["npm's", "garbage", "1.8.1", "npm reported an unreadable version"],
  ["pi's caret", "1.9.0", "not-a-version", "pi's caret has an unreadable version"],
])(
  "an unreadable %s version leaves the version check unknown",
  async (_, published, installed, why) => {
    const { checks } = await run(agentDir(["npm:@macintacos/caret"], installed), { published });
    const version = byId(checks, "pi-caret-version");
    expect(version.status).toBe("unknown");
    expect(reason(version)).toContain(why);
  },
);

test("one npm entry runs all three checks and passes the entry check", async () => {
  const { checks } = await run(join(FIXTURES, "npm-entry"));
  expect(checks.map((c) => c.id)).toEqual(ALL_IDS);
  const entry = byId(checks, "pi-caret-entry");
  expect(entry.status).toBe("pass");
  expect(entry.detail).toContain("1.8.1");
  expect(entry.detail).toContain("npm:@macintacos/caret");
});

test("two caret entries fail the entry check with a pi remove for each", async () => {
  const checkout = join(FIXTURES, "local-entry", "checkout");
  const { checks } = await run(agentDir(["npm:@macintacos/caret", checkout], "1.8.1"));
  const entry = byId(checks, "pi-caret-entry");
  expect(entry.status).toBe("fail");
  expect(entry.detail).toContain("2 times");
  expect(remedy(entry)).toContain("caret install");
  expect(remedy(entry)).toContain("pi remove npm:@macintacos/caret");
  expect(remedy(entry)).toContain(`pi remove ${checkout}`);
});

test("an entry that filters out extensions fails the entry check", async () => {
  const { checks } = await run(join(FIXTURES, "no-extensions"));
  const entry = byId(checks, "pi-caret-entry");
  expect(entry.status).toBe("fail");
  expect(entry.detail).toContain("filters out");
  expect(remedy(entry)).toContain("pi remove npm:@macintacos/caret");
});

test("an npm entry behind the published version fails, and passes once current", async () => {
  const behind = byId(
    (await run(join(FIXTURES, "npm-entry"), { published: "1.9.0" })).checks,
    "pi-caret-version",
  );
  expect(behind.status).toBe("fail");
  expect(behind.detail).toContain("1.8.1");
  expect(behind.detail).toContain("1.9.0");
  expect(remedy(behind)).toContain("caret install");
  const current = byId((await run(join(FIXTURES, "npm-entry"))).checks, "pi-caret-version");
  expect(current.status).toBe("pass");
});

test("a pinned entry behind fails with the unpin command, and passes when current", async () => {
  const dir = join(FIXTURES, "pinned-entry");
  const behind = byId((await run(dir, { published: "1.9.0" })).checks, "pi-caret-version");
  expect(behind.status).toBe("fail");
  expect(behind.detail).toContain("pins");
  expect(remedy(behind)).toContain("pi install npm:@macintacos/caret");
  const current = byId((await run(dir, { published: "1.8.0" })).checks, "pi-caret-version");
  expect(current.status).toBe("pass");
  expect(current.detail).toContain("pinned");
});

test("a local path skips the version check and never fetches npm", async () => {
  const { checks, called } = await run(join(FIXTURES, "local-entry"));
  expect(checks.map((c) => c.id)).toEqual(["pi-host", "pi-caret-entry"]);
  expect(called.published).toBe(false);
});

test("an unreachable npm leaves the version check unknown", async () => {
  const { checks } = await run(join(FIXTURES, "npm-entry"), { published: null });
  const version = byId(checks, "pi-caret-version");
  expect(version.status).toBe("unknown");
  expect(reason(version)).toContain("could not reach npm");
});

test("an npm entry whose package is missing fails the entry check", async () => {
  const { checks } = await run(agentDir(["npm:@macintacos/caret"]));
  const entry = byId(checks, "pi-caret-entry");
  expect(entry.status).toBe("fail");
  expect(entry.detail).toContain("isn't installed");
  expect(entry.detail).not.toContain("unknown");
  const version = byId(checks, "pi-caret-version");
  expect(version.status).toBe("unknown");
  expect(reason(version)).toContain("isn't installed");
});
