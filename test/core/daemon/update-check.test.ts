// The daemon's "is this caret behind?" check (EXC-1205): the pure verdict over
// gathered facts, the persisted-verdict read, and the throttled runner that gathers
// them. The verdict is a table over every install kind; the runner is driven with an
// in-memory cache, a frozen clock, and counting readers, so no test touches the
// network, the filesystem, or a real 24-hour window.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  fileUpdateCache,
  readCachedStatus,
  runUpdateCheck,
  type UpdateCache,
  type UpdateCheckDeps,
  type UpdateRecord,
  updateReportFor,
  updateStatusFor,
} from "@/daemon/update-check.ts";
import { noopLogger } from "@/lib/log.ts";
import type { UpdateStatus } from "@/lib/types.ts";

const BUNX = "bunx --no-cache @macintacos/caret@latest install --refresh";
const REBUILD = "mise run build --install";
const DAY_MS = 24 * 60 * 60 * 1000;

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-update-check-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

/** The facts a verdict decides over, with every side absent unless a case supplies it. */
function facts(over: Partial<Parameters<typeof updateStatusFor>[0]>) {
  return {
    kind: "binary" as const,
    version: "0.13.0",
    commit: "abc1234",
    npmLatest: null,
    release: null,
    aheadBy: null,
    ...over,
  };
}

// --- the verdict -----------------------------------------------------------------

test("a dev build is unavailable, whatever upstream says", () => {
  expect(updateStatusFor(facts({ kind: "dev", npmLatest: "9.9.9", release: "9.9.9" }))).toEqual({
    kind: "unavailable",
    reason: "dev",
  });
});

test("a bundle behind npm's latest is behind-release, with the bunx refresh", () => {
  expect(updateStatusFor(facts({ kind: "bundle", npmLatest: "0.14.0" }))).toEqual({
    kind: "behind-release",
    available: "0.14.0",
    command: BUNX,
  });
});

test("a bundle at or ahead of npm's latest is current", () => {
  expect(updateStatusFor(facts({ kind: "bundle", npmLatest: "0.13.0" })).kind).toBe("current");
  expect(updateStatusFor(facts({ kind: "bundle", npmLatest: "0.12.0" })).kind).toBe("current");
});

test("a bundle that could not reach npm is unknown, not current", () => {
  const s = updateStatusFor(facts({ kind: "bundle", npmLatest: null }));
  expect(s.kind).toBe("unknown");
  expect(s.kind === "unknown" && s.reason.length > 0).toBe(true);
});

test("a binary behind the newest release is behind-release, with the bunx refresh", () => {
  expect(updateStatusFor(facts({ release: "0.14.0" }))).toEqual({
    kind: "behind-release",
    available: "0.14.0",
    command: BUNX,
  });
});

test("the release message wins over the commit message", () => {
  // A binary that is both a release behind AND commits behind hears the bigger news.
  expect(updateStatusFor(facts({ release: "0.14.0", aheadBy: 40 })).kind).toBe("behind-release");
});

test("a binary on the newest release but behind trunk is behind-commit, with the rebuild", () => {
  expect(updateStatusFor(facts({ release: "0.13.0", aheadBy: 7 }))).toEqual({
    kind: "behind-commit",
    aheadBy: 7,
    command: REBUILD,
  });
});

test("a binary on the newest release and on trunk's tip is current", () => {
  expect(updateStatusFor(facts({ release: "0.13.0", aheadBy: 0 })).kind).toBe("current");
});

test("a binary that could not read the release or the compare is unknown", () => {
  expect(updateStatusFor(facts({ release: null, aheadBy: 3 })).kind).toBe("unknown");
  expect(updateStatusFor(facts({ release: "0.13.0", aheadBy: null })).kind).toBe("unknown");
});

test("a binary with no baked commit is judged on the release alone", () => {
  // resolveCommit's fallback: there is nothing to compare, so the compare's absence
  // must not degrade a perfectly readable release verdict to unknown.
  expect(updateStatusFor(facts({ commit: "unknown", release: "0.13.0", aheadBy: null })).kind).toBe(
    "current",
  );
  expect(updateStatusFor(facts({ commit: "unknown", release: "0.14.0", aheadBy: null })).kind).toBe(
    "behind-release",
  );
});

// --- the persisted verdict -------------------------------------------------------

const CURRENT: UpdateStatus = { kind: "current" };

/** Write a cache record verbatim, so a test can plant a stale or malformed one that
 * the real reader then has to cope with. */
async function plant(body: unknown): Promise<UpdateCache> {
  const file = join(tmp, "update-check.json");
  await Bun.write(file, typeof body === "string" ? body : JSON.stringify(body));
  return fileUpdateCache(file);
}

test("a record written against the running build reads back as its status", () => {
  const cache = memoryCache({
    checkedAt: 1,
    version: "0.13.0",
    commit: "abc1234",
    status: CURRENT,
  });
  expect(readCachedStatus(cache, "0.13.0", "abc1234")).toEqual(CURRENT);
});

test("a missing or unparseable record reads as unknown", async () => {
  expect(readCachedStatus(memoryCache(), "0.13.0", "abc1234").kind).toBe("unknown");
  expect(readCachedStatus(await plant("{ not json"), "0.13.0", "abc1234").kind).toBe("unknown");
  expect(readCachedStatus(await plant({ checkedAt: 1 }), "0.13.0", "abc1234").kind).toBe("unknown");
});

test("a record from a different version or commit reads as unknown, never as its status", () => {
  // Its `available` number is a claim about a caret that is no longer running.
  const stale = memoryCache({
    checkedAt: 1,
    version: "0.12.0",
    commit: "abc1234",
    status: { kind: "behind-release", available: "0.13.0", command: BUNX },
  });
  expect(readCachedStatus(stale, "0.13.0", "abc1234").kind).toBe("unknown");
  const moved = memoryCache({
    checkedAt: 1,
    version: "0.13.0",
    commit: "def5678",
    status: CURRENT,
  });
  expect(readCachedStatus(moved, "0.13.0", "abc1234").kind).toBe("unknown");
});

test("the file-backed cache round-trips a record, privately", () => {
  // The production write path — every other case injects memoryCache, so without this
  // the real mkdir, mode, and JSON shape would never run.
  const file = join(tmp, "nested", "update-check.json");
  const cache = fileUpdateCache(file);
  const behind: UpdateStatus = { kind: "behind-commit", aheadBy: 4, command: REBUILD };
  cache.write({ checkedAt: 99, version: "0.13.0", commit: "abc1234", status: behind });
  expect(readCachedStatus(cache, "0.13.0", "abc1234")).toEqual(behind);
  // 0600 / 0700: the record shares the state dir with plan bodies (EXC-539).
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
});

test("an unwritable path is swallowed, so a cache write can't disturb a boot", async () => {
  // A path whose parent is a FILE — the mkdir fails, and the daemon must not notice.
  await Bun.write(join(tmp, "blocker"), "not a directory");
  const cache = fileUpdateCache(join(tmp, "blocker", "update-check.json"));
  expect(() =>
    cache.write({ checkedAt: 1, version: "0.13.0", commit: "abc1234", status: CURRENT }),
  ).not.toThrow();
  expect(readCachedStatus(cache, "0.13.0", "abc1234").kind).toBe("unknown");
});

// --- the throttled runner --------------------------------------------------------

/** An in-memory UpdateCache plus the record it holds, so a test drives the throttle
 * without a filesystem. */
interface MemoryCache extends UpdateCache {
  held: UpdateRecord | null;
}
function memoryCache(seed: UpdateRecord | null = null): MemoryCache {
  const cache: MemoryCache = {
    held: seed,
    read: () => cache.held,
    write: (entry) => {
      cache.held = entry;
    },
  };
  return cache;
}

/** Runner deps with a frozen clock and counting readers. `answers` is what each reader
 * returns — mutable, so a case can steer the verdict without replacing the reader and
 * losing the call record `calls` is asserted on. */
function deps(over: Partial<UpdateCheckDeps> = {}): UpdateCheckDeps & {
  calls: string[];
  answers: { npm: string | null; release: string | null; ahead: number | null };
} {
  const calls: string[] = [];
  const answers = {
    npm: "0.13.0" as string | null,
    release: "0.13.0" as string | null,
    ahead: 0 as number | null,
  };
  return {
    calls,
    answers,
    kind: "binary",
    version: "0.13.0",
    commit: "abc1234",
    enabled: async () => true,
    now: () => 1_000_000,
    cache: memoryCache(),
    npmLatest: async () => {
      calls.push("npm");
      return answers.npm;
    },
    release: async () => {
      calls.push("release");
      return answers.release;
    },
    aheadBy: async () => {
      calls.push("compare");
      return answers.ahead;
    },
    log: noopLogger,
    ...over,
  };
}

test("a dev daemon reports unavailable without reaching the network", async () => {
  const d = deps({ kind: "dev" });
  expect(await runUpdateCheck(d)).toEqual({ kind: "unavailable", reason: "dev" });
  expect(d.calls).toEqual([]);
});

test("an opted-out daemon gathers nothing, and holds no verdict of its own", async () => {
  // null, exactly like the throttle: both mean "nothing new to gather, keep the verdict
  // you have". Latching `disabled` here is what froze it — a later flip back on re-runs
  // into the throttle, comes back null, and the frozen verdict would stand forever.
  const d = deps({ enabled: async () => false });
  expect(await runUpdateCheck(d)).toBeNull();
  expect(d.calls).toEqual([]);
});

test("a check inside the 24h window is throttled to null, so the caller keeps its verdict", async () => {
  const cache = memoryCache({
    checkedAt: 1_000_000 - DAY_MS + 1,
    version: "0.13.0",
    commit: "abc1234",
    status: CURRENT,
  });
  const d = deps({ cache });
  expect(await runUpdateCheck(d)).toBeNull();
  expect(d.calls).toEqual([]);
});

test("a check past the 24h window runs again", async () => {
  const cache = memoryCache({
    checkedAt: 1_000_000 - DAY_MS,
    version: "0.13.0",
    commit: "abc1234",
    status: CURRENT,
  });
  const d = deps({ cache });
  expect((await runUpdateCheck(d))?.kind).toBe("current");
  expect(d.calls).toEqual(["release", "compare"]);
});

test("a build change runs the check even inside the 24h window", async () => {
  // The freshly-upgraded moment is exactly when the answer matters most.
  const cache = memoryCache({
    checkedAt: 1_000_000 - 1,
    version: "0.12.0",
    commit: "abc1234",
    status: CURRENT,
  });
  const d = deps({ cache });
  expect((await runUpdateCheck(d))?.kind).toBe("current");
  expect(d.calls).toEqual(["release", "compare"]);
});

test("the stamp is written before the gather, so an offline attempt still backs off", async () => {
  const cache = memoryCache();
  const d = deps({
    cache,
    release: async () => {
      // The stamp must already be recorded by the time the first read is attempted.
      expect(cache.held?.checkedAt).toBe(1_000_000);
      throw new Error("getaddrinfo ENOTFOUND");
    },
  });
  expect((await runUpdateCheck(d))?.kind).toBe("unknown");
  expect(cache.held?.checkedAt).toBe(1_000_000);
});

test("a settled verdict is persisted against the running build", async () => {
  const cache = memoryCache();
  const d = deps({ cache });
  d.answers.release = "0.14.0";
  const behind: UpdateStatus = { kind: "behind-release", available: "0.14.0", command: BUNX };
  expect(await runUpdateCheck(d)).toEqual(behind);
  expect(cache.held).toEqual({
    checkedAt: 1_000_000,
    version: "0.13.0",
    commit: "abc1234",
    status: behind,
  });
  // And the record a real file-backed cache would hold reads back as that same verdict.
  expect(readCachedStatus(await plant(cache.held), "0.13.0", "abc1234")).toEqual(behind);
});

test("a record orphaned mid-check reads back as no record at all", async () => {
  // The up-front stamp lands, then the daemon dies before the gather settles (idle
  // shutdown, SIGTERM, an EXC-406 retire). What it left behind must not read as a
  // verdict — it would satisfy the throttle and be served for a day.
  const cache = memoryCache();
  const d = deps({
    cache,
    release: async () => {
      expect(readCachedStatus(cache, "0.13.0", "abc1234")).toEqual(
        readCachedStatus(memoryCache(), "0.13.0", "abc1234"),
      );
      return "0.13.0";
    },
  });
  await runUpdateCheck(d);
});

test("a stamp from the future is treated as stale, not as a permanent throttle", async () => {
  // An NTP correction, a restored backup, or a resumed VM can leave one behind; a
  // plain `now - checkedAt < DAY` comparison would suppress every later check.
  const cache = memoryCache({
    checkedAt: 1_000_000 + 5 * DAY_MS,
    version: "0.13.0",
    commit: "abc1234",
    status: CURRENT,
  });
  const d = deps({ cache });
  expect((await runUpdateCheck(d))?.kind).toBe("current");
  expect(d.calls).toEqual(["release", "compare"]);
});

test("a failure anywhere in the runner settles as unknown rather than rejecting", async () => {
  // The daemon fires this without awaiting it, and its unhandledRejection handler
  // exits the process — so "never rejects" is load-bearing, not a nicety.
  const throwing = deps({
    enabled: async () => {
      throw new Error("prefs exploded");
    },
  });
  expect((await runUpdateCheck(throwing))?.kind).toBe("unknown");
  const badCache = deps({
    cache: {
      read: () => {
        throw new Error("cache exploded");
      },
      write: () => {},
    },
  });
  expect((await runUpdateCheck(badCache))?.kind).toBe("unknown");
});

test("a raw error string never reaches the wire as the unknown reason", async () => {
  // `reason` is rendered by the UI, and an errno carries an absolute home path.
  const d = deps({
    enabled: async () => {
      throw new Error("EACCES: permission denied, open '/Users/someone/.local/state/x'");
    },
  });
  const status = await runUpdateCheck(d);
  expect(status?.kind === "unknown" && status.reason).not.toContain("/Users/");
});

test("a binary already behind a release skips the compare call", async () => {
  const d = deps();
  d.answers.release = "0.14.0";
  expect((await runUpdateCheck(d))?.kind).toBe("behind-release");
  expect(d.calls).toEqual(["release"]);
});

test("a binary whose release read failed skips the compare call", async () => {
  const d = deps();
  d.answers.release = null;
  expect((await runUpdateCheck(d))?.kind).toBe("unknown");
  expect(d.calls).toEqual(["release"]);
});

test("a binary with no baked commit skips the compare call", async () => {
  const d = deps({ commit: "unknown" });
  expect((await runUpdateCheck(d))?.kind).toBe("current");
  expect(d.calls).toEqual(["release"]);
});

test("a bundle asks npm and nothing else", async () => {
  const d = deps({ kind: "bundle" });
  d.answers.npm = "0.14.0";
  expect((await runUpdateCheck(d))?.kind).toBe("behind-release");
  expect(d.calls).toEqual(["npm"]);
});

// EXC-1207. The Updates pane gives the "cannot compare against trunk" reason its own copy
// — that verdict is a developer's normal daily reading, not a fault — and matches on the
// reason string. The browser cannot import this module (node-only), so `UNCOMPARABLE` in
// ui/src/lib/updates.ts MIRRORS the constant here, and a mirror without a pin is a comment
// rather than an invariant. Asserted by producing the verdict through the real code path
// rather than by reading NEEDS_COMPARE, which is not exported.
test("the uncomparable-build reason matches the string the Updates pane keys off", async () => {
  const status = updateStatusFor({
    kind: "binary",
    version: "0.13.0",
    commit: "abc1234",
    npmLatest: null,
    release: "0.13.0",
    aheadBy: null,
  });
  expect(status).toEqual({
    kind: "unknown",
    reason: "could not compare this build against trunk",
  });
});

// --- the served report (EXC-1210) ----------------------------------------------------
//
// The daemon holds only BUILD verdicts; the opt-out is folded in per request, so
// GET /api/update reflects the switch as it stands now rather than as it stood at boot.

const IDENTITY = { install: "binary" as const, version: "0.13.0", commit: "abc1234" };

test("with the check on, the held verdict rides through untouched", () => {
  const behind: UpdateStatus = { kind: "behind-release", available: "0.14.0", command: BUNX };
  expect(updateReportFor(IDENTITY, behind, true)).toEqual({
    ...IDENTITY,
    checkEnabled: true,
    status: behind,
  });
});

test("with the check off, every held verdict is served as disabled", () => {
  // Including a pending one — that is the whole point: an opted-out reviewer is not
  // nagged, and the daemon says so rather than the browser second-guessing a verdict it
  // was handed. A `dev` build too: the switch outranks the reason the check was off.
  const held: UpdateStatus[] = [
    { kind: "behind-release", available: "0.14.0", command: BUNX },
    { kind: "unavailable", reason: "dev" },
    CURRENT,
  ];
  for (const status of held) {
    expect(updateReportFor(IDENTITY, status, false)).toEqual({
      ...IDENTITY,
      checkEnabled: false,
      status: { kind: "unavailable", reason: "disabled" },
    });
  }
});
