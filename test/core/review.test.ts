import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { claudeAdapter } from "../../src/adapters/claude/index.ts";
import { runReview } from "../../src/review.ts";
import { setLogLevel } from "../../src/log.ts";
import { logFile } from "../../src/paths.ts";
import { PLAN_FORMAT_DENY_MESSAGE } from "../../src/plan-format.ts";
import type { Decision } from "../../src/types.ts";
import { ndjsonRecords } from "../support/ndjson.ts";
import { setupTempStateDir } from "../support/env.ts";

const allow: Decision = { behavior: "allow", decidedAt: 1 };

function reviewDeps(over: Partial<Parameters<typeof runReview>[1]> = {}) {
  return {
    parseHookInput: (stdin: string) => claudeAdapter.parseHookInput(stdin),
    ensureDaemon: async () => "http://x",
    postReview: async () => ({ id: "rid" }),
    longPoll: async () => allow,
    openBrowser: () => {},
    timeoutMs: 1000,
    expire: async () => {},
    ...over,
  };
}

const stdin = JSON.stringify({ session_id: "S", cwd: "/p", tool_input: { plan: "# P" } });

// Point the state dir at a throwaway temp dir so deny-path tests append to a
// disposable caret.log instead of the real ~/.local/state/caret.
setupTempStateDir("caret-cli-");
afterEach(() => setLogLevel("info")); // undo any per-test level change

/** Parse caret.log into NDJSON records ([] when the file doesn't exist). */
function logRecords(): Array<Record<string, unknown>> {
  try {
    return ndjsonRecords(readFileSync(logFile(), "utf-8"));
  } catch {
    return [];
  }
}

// ---- runReview ----

test("happy path returns an allow hook output", async () => {
  const out = await runReview(stdin, reviewDeps());
  expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
});

test("browser opens under the caret.localhost vanity origin (EXC-426)", async () => {
  let opened: string | undefined;
  await runReview(
    stdin,
    reviewDeps({
      ensureDaemon: async () => "http://localhost:4242",
      openBrowser: (u) => {
        opened = u;
      },
    }),
  );
  expect(opened).toBe("http://caret.localhost:4242/?review=rid");
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
  expect(out.hookSpecificOutput.decision.updatedPermissions?.[0]?.mode).toBe("acceptEdits");
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

test("a timeout notifies the daemon to expire the review before denying", async () => {
  const expired: Array<[string, string]> = [];
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: () => new Promise<Decision>(() => {}),
      timeoutMs: 20,
      expire: async (baseUrl: string, id: string) => {
        expired.push([baseUrl, id]);
      },
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
  expect(expired).toEqual([["http://x", "rid"]]);
});

test("an expire failure never changes the fail-safe deny", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: () => new Promise<Decision>(() => {}),
      timeoutMs: 20,
      expire: async () => {
        throw new Error("daemon gone");
      },
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
  expect(out.hookSpecificOutput.decision.message).toContain("timed out");
});

test("no expire call when the review was never created", async () => {
  const expired: string[] = [];
  await runReview(
    stdin,
    reviewDeps({
      ensureDaemon: async () => {
        throw new Error("boom");
      },
      expire: async (_baseUrl: string, id: string) => {
        expired.push(id);
      },
    }),
  );
  expect(expired).toEqual([]); // no review id exists to expire
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
  // Stable contract: the format reject is an info-level "validatePlan" record
  // carrying the session — assert the step/level/field and the "plan rejected"
  // token, not the exact descriptive tail (F1 brittleness reduction).
  const rec = logRecords().find((r) => r.step === "validatePlan");
  expect(rec).toMatchObject({ level: 30, sessionId: "FMT" });
  expect(typeof rec?.msg === "string" && rec.msg.startsWith("plan rejected")).toBe(true);
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
  // Locate the create record by its stable contract (debug "review" step
  // carrying the reviewId), not the id-embedding message prose (F1 style).
  const posted = logRecords().find((r) => r.step === "review" && r.reviewId === "rid");
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
