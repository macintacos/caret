import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeBuildId, ensureDaemon, runReview } from "../src/cli.ts";
import { setLogLevel } from "../src/log.ts";
import { logFile } from "../src/paths.ts";
import { PLAN_FORMAT_DENY_MESSAGE } from "../src/plan-format.ts";
import type { Decision } from "../src/types.ts";

const allow: Decision = { behavior: "allow", decidedAt: 1 };

function reviewDeps(over: Partial<Parameters<typeof runReview>[1]> = {}) {
  return {
    ensureDaemon: async () => "http://x",
    postReview: async () => ({ id: "rid" }),
    longPoll: async () => allow,
    openBrowser: () => {},
    timeoutMs: 1000,
    ...over,
  };
}

const stdin = JSON.stringify({ session_id: "S", cwd: "/p", tool_input: { plan: "# P" } });

// Point the state dir at a throwaway temp dir so deny-path tests append to a
// disposable caret.log instead of the real ~/.local/state/caret.
let stateHome: string;
let savedXdg: string | undefined;
beforeEach(async () => {
  stateHome = await mkdtemp(join(tmpdir(), "caret-cli-"));
  savedXdg = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateHome;
});
afterEach(async () => {
  if (savedXdg === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedXdg;
  setLogLevel("info"); // undo any per-test level change
  await rm(stateHome, { recursive: true, force: true });
});

/** Parse caret.log into NDJSON records ([] when the file doesn't exist). */
function logRecords(): Array<Record<string, unknown>> {
  let body: string;
  try {
    body = readFileSync(logFile(), "utf-8");
  } catch {
    return [];
  }
  return body
    .split("\n")
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

// ---- runReview ----

test("happy path returns an allow hook output", async () => {
  const out = await runReview(stdin, reviewDeps());
  expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
});

test("deny decision passes the feedback through to message", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => ({ behavior: "deny", feedback: "tweak X", decidedAt: 1 }),
    }),
  );
  expect(out.hookSpecificOutput.decision).toMatchObject({
    behavior: "deny",
    message: "tweak X",
  });
});

test("acceptMode passes through to updatedPermissions", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => ({ behavior: "allow", acceptMode: "acceptEdits", decidedAt: 1 }),
    }),
  );
  expect(out.hookSpecificOutput.decision.updatedPermissions?.[0]?.mode).toBe(
    "acceptEdits",
  );
});

test("invalid stdin JSON fails safe to deny (never allow)", async () => {
  const out = await runReview("not json", reviewDeps());
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
});

test("ensureDaemon failure fails safe to deny", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      ensureDaemon: async () => {
        throw new Error("boom");
      },
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
});

test("a never-resolving long-poll times out to deny", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: () => new Promise<Decision>(() => {}),
      timeoutMs: 20,
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
  expect(out.hookSpecificOutput.decision.message).toContain("timed out");
});

test("a dropped long-poll reconnects once then succeeds", async () => {
  let calls = 0;
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => {
        calls++;
        if (calls === 1) throw new Error("connection reset");
        return allow;
      },
    }),
  );
  expect(calls).toBe(2);
  expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
});

test("a 204 heartbeat re-polls until a decision arrives", async () => {
  let calls = 0;
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => {
        calls++;
        return calls < 3 ? null : allow; // two heartbeats, then the decision
      },
    }),
  );
  expect(calls).toBe(3);
  expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
});

test("a transient drop reconnects and keeps polling (no premature deny)", async () => {
  let reconnects = 0;
  let calls = 0;
  const out = await runReview(
    stdin,
    reviewDeps({
      ensureDaemon: async () => {
        reconnects++;
        return "http://x";
      },
      longPoll: async () => {
        calls++;
        if (calls === 1) throw new Error("socket closed");
        return allow;
      },
    }),
  );
  expect(reconnects).toBe(2); // 1 at startup + 1 reconnect after the drop
  expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
});

test("the poll loop is bounded by timeoutMs (endless heartbeats → deny)", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => {
        await Bun.sleep(2); // pace the loop so it isn't a hot spin
        return null; // never decides
      },
      timeoutMs: 30,
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
  expect(out.hookSpecificOutput.decision.message).toContain("timed out");
});

test("an unreachable daemon mid-poll fails safe to deny", async () => {
  let first = true;
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => {
        throw new Error("socket closed");
      },
      ensureDaemon: async () => {
        if (first) {
          first = false;
          return "http://x"; // startup connects
        }
        throw new Error("daemon gone"); // reconnect fails → deny
      },
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
});

test("a failure logs the step + context to caret.log and surfaces the path", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      ensureDaemon: async () => {
        throw new Error("daemon down");
      },
    }),
  );
  // The deny reason points the user at the log.
  expect(out.hookSpecificOutput.decision.message).toContain(logFile());
  // The log captures which step failed, the message, and stdin context.
  const rec = logRecords().find((r) => r.step === "ensureDaemon");
  expect(rec).toMatchObject({ level: 50, msg: "daemon down", sessionId: "S", cwd: "/p" });
});

test("a failed reconnect logs step=reconnect, not the poll step", async () => {
  let firstEnsure = true;
  await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => {
        throw new Error("socket closed");
      },
      ensureDaemon: async () => {
        if (firstEnsure) {
          firstEnsure = false;
          return "http://x"; // startup connects
        }
        throw new Error("daemon gone"); // reconnect fails → logged
      },
    }),
  );
  const recs = logRecords();
  expect(recs.some((r) => r.step === "reconnect")).toBe(true);
  expect(recs.some((r) => r.step === "longPoll")).toBe(false);
});

// ---- plan-format guard ----

function planStdin(plan: string | undefined): string {
  return JSON.stringify({ session_id: "S", cwd: "/p", tool_input: { plan } });
}

test("a bare-fence plan is denied for format before any daemon work", async () => {
  let ensureCalls = 0;
  let postCalls = 0;
  const out = await runReview(
    planStdin("# Plan\n\n```\ncode\n```\n"),
    reviewDeps({
      ensureDaemon: async () => {
        ensureCalls++;
        return "http://x";
      },
      postReview: async () => {
        postCalls++;
        return { id: "rid" };
      },
    }),
  );
  expect(out.hookSpecificOutput.decision).toMatchObject({
    behavior: "deny",
    message: PLAN_FORMAT_DENY_MESSAGE,
  });
  // The format-deny short-circuits: no daemon spin-up, no review created.
  expect(ensureCalls).toBe(0);
  expect(postCalls).toBe(0);
});

test("a fully-tagged plan is posted for review as before", async () => {
  let postCalls = 0;
  const out = await runReview(
    planStdin("# Plan\n\n```ts\nconst x = 1;\n```\n"),
    reviewDeps({
      postReview: async () => {
        postCalls++;
        return { id: "rid" };
      },
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
  expect(postCalls).toBe(1);
});

test("a plan with no code blocks is posted for review", async () => {
  let postCalls = 0;
  const out = await runReview(
    planStdin("# Just prose, no code.\n"),
    reviewDeps({
      postReview: async () => {
        postCalls++;
        return { id: "rid" };
      },
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
  expect(postCalls).toBe(1);
});

test("an absent plan is posted for review (no spurious format-deny)", async () => {
  let postCalls = 0;
  const out = await runReview(
    planStdin(undefined),
    reviewDeps({
      postReview: async () => {
        postCalls++;
        return { id: "rid" };
      },
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
  expect(postCalls).toBe(1);
});

test("a format-deny is logged at info — an expected reject, not an error", async () => {
  await runReview(
    JSON.stringify({ session_id: "FMT", cwd: "/p", tool_input: { plan: "```\nx\n```\n" } }),
    reviewDeps(),
  );
  const rec = logRecords().find((r) => r.step === "validatePlan");
  expect(rec).toMatchObject({ level: 30, sessionId: "FMT" });
  expect(rec?.msg).toContain("code block missing language marker");
});

// ---- decision outcome records (EXC-398) ----

test("a rejected plan is logged at info without the feedback body (EXC-444)", async () => {
  await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => ({ behavior: "deny", feedback: "tighten phase 2", decidedAt: 1 }),
    }),
  );
  const rec = logRecords().find((r) => r.step === "decision");
  expect(rec).toMatchObject({
    level: 30,
    msg: "plan rejected",
    feedbackChars: "tighten phase 2".length,
    sessionId: "S",
  });
  // The reviewer's prose must never reach the log — only its length does.
  expect(JSON.stringify(rec)).not.toContain("tighten phase 2");
});

test("an approved plan is logged at info", async () => {
  await runReview(stdin, reviewDeps());
  const rec = logRecords().find((r) => r.step === "decision");
  expect(rec).toMatchObject({ level: 30, msg: "plan approved", sessionId: "S" });
});

// ---- hook-path instrumentation (EXC-444) ----

test("a review start is logged at info with session context", async () => {
  await runReview(stdin, reviewDeps());
  const rec = logRecords().find((r) => r.step === "review" && r.msg === "review requested");
  expect(rec).toMatchObject({ level: 30, sessionId: "S", cwd: "/p" });
});

test("the posted review id is logged at debug and stitches later records", async () => {
  setLogLevel("debug");
  await runReview(stdin, reviewDeps());
  const posted = logRecords().find((r) => r.msg === "review created: rid");
  expect(posted).toMatchObject({ level: 20, step: "review", reviewId: "rid" });
  // Once the id is known, every later record carries it — caret.log records
  // stitch against the daemon's review/resolve records by reviewId.
  const decision = logRecords().find((r) => r.step === "decision");
  expect(decision).toMatchObject({ msg: "plan approved", reviewId: "rid" });
});

test("an approved plan's record carries the acceptMode", async () => {
  await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => ({ behavior: "allow", acceptMode: "acceptEdits", decidedAt: 1 }),
    }),
  );
  const rec = logRecords().find((r) => r.step === "decision");
  expect(rec).toMatchObject({ msg: "plan approved", acceptMode: "acceptEdits" });
});

test("a failure after the review was posted carries the reviewId", async () => {
  await runReview(
    stdin,
    reviewDeps({ longPoll: () => new Promise<Decision>(() => {}), timeoutMs: 30 }),
  );
  const rec = logRecords().find((r) => r.level === 50);
  expect(rec).toMatchObject({ step: "longPoll", reviewId: "rid", sessionId: "S" });
});

test("decision info records are suppressed when the level is error", async () => {
  setLogLevel("error");
  await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => ({ behavior: "deny", feedback: "nope", decidedAt: 1 }),
    }),
  );
  expect(logRecords()).toHaveLength(0);
});

// ---- ensureDaemon ----

function ensureDeps(over: Partial<Parameters<typeof ensureDaemon>[0]> = {}) {
  return {
    baseUrl: "http://localhost:42718",
    currentBuild: "b1",
    currentVersion: "v1",
    health: async () =>
      ({ service: "caret", build: "b1", version: "v1" }) as
        | { service?: string; build?: string; version?: string }
        | null,
    readLock: () => null,
    isAlive: () => false,
    retire: async () => true,
    removeLock: () => {},
    spawn: () => {},
    backoff: async () => {},
    maxAttempts: 5,
    ...over,
  };
}

test("ensureDaemon returns immediately when the daemon is already healthy", async () => {
  let spawns = 0;
  const url = await ensureDaemon(
    ensureDeps({ spawn: () => spawns++ }),
  );
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(0);
});

test("ensureDaemon spawns when the port is refused, then connects", async () => {
  let spawns = 0;
  let checks = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
      spawn: () => spawns++,
    }),
  );
  expect(spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

test("ensureDaemon throws a clear error when a non-caret process holds the port", async () => {
  await expect(
    ensureDaemon(ensureDeps({ health: async () => ({ service: "other" }) })),
  ).rejects.toThrow(/CARET_PORT/);
});

test("ensureDaemon swallows an EADDRINUSE spawn race and connects to the winner", async () => {
  let checks = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
      spawn: () => {
        const e = new Error("listen EADDRINUSE") as Error & { code?: string };
        e.code = "EADDRINUSE";
        throw e;
      },
    }),
  );
  expect(url).toBe("http://localhost:42718");
});

test("ensureDaemon gives up after maxAttempts", async () => {
  await expect(
    ensureDaemon(ensureDeps({ health: async () => null, maxAttempts: 3 })),
  ).rejects.toThrow();
});

test("ensureDaemon logs the spawn attempt at debug", async () => {
  setLogLevel("debug");
  let checks = 0;
  await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
    }),
  );
  const recs = logRecords().filter((r) => r.step === "spawn");
  expect(recs.some((r) => r.msg === "daemon spawned")).toBe(true);
});

test("ensureDaemon logs the stale-daemon retire at debug", async () => {
  setLogLevel("debug");
  let retires = 0;
  let spawns = 0;
  await ensureDaemon(
    ensureDeps({
      health: async () => {
        if (retires === 0) return { service: "caret", build: "b0", version: "v1" };
        if (spawns === 0) return null;
        return { service: "caret", build: "b1", version: "v1" };
      },
      retire: async () => {
        retires++;
        return true;
      },
      spawn: () => spawns++,
    }),
  );
  const recs = logRecords().filter((r) => r.step === "retire");
  expect(recs.some((r) => r.msg === "stale daemon retiring")).toBe(true);
});

test("ensureDaemon logs orphan-lock removal at debug", async () => {
  setLogLevel("debug");
  let checks = 0;
  await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
      readLock: () => ({ pid: 4_000_000, port: 42718 }),
      isAlive: () => false,
    }),
  );
  const recs = logRecords().filter((r) => r.step === "spawn");
  expect(recs.some((r) => r.msg === "orphan daemon lock removed")).toBe(true);
});

// ---- ensureDaemon: single-instance discovery + graceful takeover (EXC-406) ----

test("ensureDaemon reuses a same-build daemon (no spawn, no retire)", async () => {
  let spawns = 0;
  let retires = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => ({ service: "caret", build: "b1", version: "v1" }),
      spawn: () => spawns++,
      retire: async () => {
        retires++;
        return true;
      },
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(0);
  expect(retires).toBe(0);
});

test("ensureDaemon retires a stale-build daemon, then reuses the fresh respawn", async () => {
  let retires = 0;
  let spawns = 0;
  const url = await ensureDaemon(
    ensureDeps({
      // Old daemon (b0) answers until retired; the port frees; a fresh daemon (b1) binds.
      health: async () => {
        if (retires === 0) return { service: "caret", build: "b0", version: "v1" };
        if (spawns === 0) return null;
        return { service: "caret", build: "b1", version: "v1" };
      },
      retire: async () => {
        retires++;
        return true;
      },
      spawn: () => spawns++,
    }),
  );
  expect(retires).toBe(1);
  expect(spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

test("ensureDaemon treats a version mismatch as stale even when the build matches", async () => {
  let retires = 0;
  await ensureDaemon(
    ensureDeps({
      health: async () => ({ service: "caret", build: "b1", version: "v0" }),
      retire: async () => {
        retires++;
        return true;
      },
      maxAttempts: 1,
    }),
  );
  expect(retires).toBe(1);
});

test("ensureDaemon removes an orphan lock (dead PID) before spawning", async () => {
  let removed = 0;
  let spawns = 0;
  let checks = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
      readLock: () => ({ pid: 999999, port: 42718 }),
      isAlive: () => false,
      removeLock: () => removed++,
      spawn: () => spawns++,
    }),
  );
  expect(removed).toBe(1);
  expect(spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

test("a stale daemon that cannot be retired is reused, never denied", async () => {
  let retires = 0;
  // A pre-fix daemon: no /api/retire and no lock, so retire can do nothing (false).
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => ({ service: "caret", build: "b0", version: "v0" }),
      retire: async () => {
        retires++;
        return false;
      },
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect(retires).toBe(1);
});

// ---- computeBuildId: any local rebuild supersedes a running daemon ----

test("computeBuildId hashes the binary when running compiled (any rebuild wins)", async () => {
  const id = await computeBuildId({
    isCompiled: true,
    hashBinary: async () => "binhash123",
    uiHash: async () => "uihash",
  });
  expect(id).toBe("binhash123");
});

test("computeBuildId falls back to the UI hash when the binary is unreadable", async () => {
  const id = await computeBuildId({
    isCompiled: true,
    hashBinary: async () => null,
    uiHash: async () => "uihash",
  });
  expect(id).toBe("uihash");
});

test("computeBuildId uses the UI hash in dev (not compiled, never reads the binary)", async () => {
  let binaryReads = 0;
  const id = await computeBuildId({
    isCompiled: false,
    hashBinary: async () => {
      binaryReads++;
      return "binhash";
    },
    uiHash: async () => "uihash",
  });
  expect(id).toBe("uihash");
  expect(binaryReads).toBe(0);
});
