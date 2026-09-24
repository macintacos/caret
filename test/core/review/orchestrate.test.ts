import { afterEach, expect, test } from "bun:test";

import { setupTempStateDir } from "@test/support/env.ts";
import { caretLogRecords } from "@test/support/ndjson.ts";
import { logFile } from "@/config/paths.ts";
import type { EnsureMode } from "@/daemon/lifecycle.ts";
import { logInfo, setLogLevel } from "@/lib/log.ts";
import type { Decision, PlanInput } from "@/lib/types.ts";
import { PLAN_EMPTY_DENY_MESSAGE, PLAN_FORMAT_DENY_MESSAGE } from "@/plan/format.ts";
import {
  expireAbandoned,
  type PostedReview,
  parseHook,
  type ReviewDeps,
  runReview,
} from "@/review/orchestrate.ts";

const allow: Decision = { behavior: "allow", decidedAt: 1 };

// A tool-agnostic fake stdin parser: the core takes the parse result rather than
// an adapter, so this suite stays in test/core/ without reaching into any
// adapter (the real parsers live in test/adapters/<tool>/). It normalizes the
// generic hook shape these tests pipe in below.
function fakeParseHookInput(stdin: string): PlanInput {
  const h = JSON.parse(stdin) as {
    session_id?: string;
    cwd?: string;
    tool_input?: { plan?: string };
  };
  return { sessionId: h.session_id, cwd: h.cwd, plan: h.tool_input?.plan };
}

function reviewDeps(over: Partial<ReviewDeps> = {}): ReviewDeps {
  return {
    ensureDaemon: async () => "http://x",
    postReview: async () => ({ id: "rid" }),
    longPoll: async () => allow,
    openBrowser: () => {},
    announceUrl: () => {},
    timeoutMs: 1000,
    expire: async () => {},
    ...over,
  };
}

function review(stdin: string, deps: ReviewDeps): Promise<Decision> {
  return runReview(parseHook(fakeParseHookInput, stdin), deps);
}

const stdin = JSON.stringify({ session_id: "S", cwd: "/p", tool_input: { plan: "# P" } });

// Point the state dir at a throwaway temp dir so deny-path tests append to a
// disposable caret.log instead of the real ~/.local/state/caret.
setupTempStateDir("caret-cli-");
afterEach(() => setLogLevel("info")); // undo any per-test level change

// ---- runReview ----
//
// runReview returns a tool-agnostic core Decision; the command layer renders it
// to the agent's wire string via the adapter. These core assertions stay on the
// Decision shape — the Claude PermissionRequest wire mapping is pinned in
// test/adapters/claude/.

test("happy path returns an allow decision", async () => {
  const out = await review(stdin, reviewDeps());
  expect(out.behavior).toBe("allow");
});

test("browser opens under the caret.localhost vanity origin (EXC-426)", async () => {
  let opened: string | undefined;
  await review(
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

test("does not open the browser when a live UI client is already polling (EXC-559)", async () => {
  let opened = false;
  await review(
    stdin,
    reviewDeps({
      postReview: async () => ({ id: "rid", hasLiveClient: true }),
      openBrowser: () => {
        opened = true;
      },
    }),
  );
  expect(opened).toBe(false);
});

test("announces the review URL through the injected sink, never on stderr itself", async () => {
  let announced: string | undefined;
  await review(
    stdin,
    reviewDeps({
      ensureDaemon: async () => "http://localhost:4242",
      announceUrl: (u) => {
        announced = u;
      },
    }),
  );
  expect(announced).toBe("http://caret.localhost:4242/?review=rid");
});

test("opens the browser when no live UI client is polling (EXC-559)", async () => {
  let opened = false;
  await review(
    stdin,
    reviewDeps({
      postReview: async () => ({ id: "rid", hasLiveClient: false }),
      openBrowser: () => {
        opened = true;
      },
    }),
  );
  expect(opened).toBe(true);
});

test("deny decision passes the feedback through", async () => {
  const out = await review(
    stdin,
    reviewDeps({
      longPoll: async () => ({ behavior: "deny", feedback: "tweak X", decidedAt: 1 }),
    }),
  );
  expect(out).toMatchObject({ behavior: "deny", feedback: "tweak X" });
});

test("acceptMode passes through on the decision", async () => {
  const out = await review(
    stdin,
    reviewDeps({
      longPoll: async () => ({ behavior: "allow", acceptMode: "yolo", decidedAt: 1 }),
    }),
  );
  expect(out).toMatchObject({ behavior: "allow", acceptMode: "yolo" });
});

test("invalid stdin JSON fails safe to deny (never allow)", async () => {
  const out = await review("not json", reviewDeps());
  expect(out.behavior).toBe("deny");
});

test("ensureDaemon failure fails safe to deny", async () => {
  const out = await review(
    stdin,
    reviewDeps({
      ensureDaemon: async () => {
        throw new Error("boom");
      },
    }),
  );
  expect(out.behavior).toBe("deny");
});

test("a never-resolving long-poll times out to deny", async () => {
  const out = await review(
    stdin,
    reviewDeps({
      longPoll: () => new Promise<Decision>(() => {}),
      timeoutMs: 20,
    }),
  );
  expect(out.behavior).toBe("deny");
  expect(out.feedback).toContain("timed out");
});

test("a timeout notifies the daemon to expire the review before denying", async () => {
  const expired: Array<[string, string, number | undefined]> = [];
  const out = await review(
    stdin,
    reviewDeps({
      postReview: async () => ({ id: "rid", version: 3 }),
      longPoll: () => new Promise<Decision>(() => {}),
      timeoutMs: 20,
      expire: async (baseUrl, id, version) => {
        expired.push([baseUrl, id, version]);
      },
    }),
  );
  expect(out.behavior).toBe("deny");
  expect(expired).toEqual([["http://x", "rid", 3]]);
});

test("a superseded review is denied without expiring the newer revision", async () => {
  const polled: Array<number | undefined> = [];
  let expires = 0;
  const out = await review(
    stdin,
    reviewDeps({
      postReview: async () => ({ id: "rid", version: 1 }),
      longPoll: async (_baseUrl, _id, version) => {
        polled.push(version);
        return "superseded";
      },
      expire: async () => {
        expires++;
      },
    }),
  );
  expect(out.behavior).toBe("deny");
  expect(polled).toEqual([1]);
  expect(expires).toBe(0);
});

test("an expire failure never changes the fail-safe deny", async () => {
  const out = await review(
    stdin,
    reviewDeps({
      longPoll: () => new Promise<Decision>(() => {}),
      timeoutMs: 20,
      expire: async () => {
        throw new Error("daemon gone");
      },
    }),
  );
  expect(out.behavior).toBe("deny");
  expect(out.feedback).toContain("timed out");
});

test("no expire call when the review was never created", async () => {
  const expired: string[] = [];
  await review(
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
  const out = await review(
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
  expect(out.behavior).toBe("allow");
});

test("a 204 heartbeat re-polls until a decision arrives", async () => {
  let calls = 0;
  const out = await review(
    stdin,
    reviewDeps({
      longPoll: async () => {
        calls++;
        return calls < 3 ? null : allow; // two heartbeats, then the decision
      },
    }),
  );
  expect(calls).toBe(3);
  expect(out.behavior).toBe("allow");
});

test("a transient drop reconnects and keeps polling (no premature deny)", async () => {
  let reconnects = 0;
  let calls = 0;
  const out = await review(
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
  expect(out.behavior).toBe("allow");
});

// Starting a review claims the port for this build; resuming one must not. A client
// whose review outlived a caret upgrade is running the OLD build, and a reconnect
// that took over would reinstall that old daemon — on every dropped poll, so it wins
// against the new build indefinitely and every later review is served stale. Pinning
// the mode per call is what makes "recovery is not installation" falsifiable.
test("the startup ensure takes over, the reconnect only attaches", async () => {
  const modes: EnsureMode[] = [];
  let calls = 0;
  await review(
    stdin,
    reviewDeps({
      ensureDaemon: async (mode) => {
        modes.push(mode);
        return "http://x";
      },
      longPoll: async () => {
        calls++;
        if (calls === 1) throw new Error("socket closed");
        return allow;
      },
    }),
  );
  expect(modes).toEqual(["takeover", "attach"]);
});

// A daemon stepping down refuses new reviews with a 503 while its supervisor brings up
// the next one. The review goes to that successor — attaching, like any reconnect, and
// waiting past the instance that refused — rather than being denied.
test("a review refused by a draining daemon is re-posted to its successor", async () => {
  const ensures: EnsureMode[] = [];
  const posts: string[] = [];
  const out = await review(
    stdin,
    reviewDeps({
      ensureDaemon: async (mode) => {
        ensures.push(mode);
        return ensures.length === 1 ? "http://draining" : "http://successor";
      },
      postReview: async (baseUrl: string) => {
        posts.push(baseUrl);
        return baseUrl === "http://draining" ? null : { id: "rid" };
      },
    }),
  );
  expect(ensures).toEqual(["takeover", "successor"]);
  expect(posts).toEqual(["http://draining", "http://successor"]);
  expect(out.behavior).toBe("allow");
});

test("a review refused by two draining daemons is denied, naming the drain", async () => {
  const out = await review(stdin, reviewDeps({ postReview: async () => null }));
  expect(out.behavior).toBe("deny");
  expect(out.feedback).toContain("draining");
});

test("the poll loop is bounded by timeoutMs (endless heartbeats → deny)", async () => {
  const out = await review(
    stdin,
    reviewDeps({
      longPoll: async () => {
        await Bun.sleep(2); // pace the loop so it isn't a hot spin
        return null; // never decides
      },
      timeoutMs: 30,
    }),
  );
  expect(out.behavior).toBe("deny");
  expect(out.feedback).toContain("timed out");
});

test("an unreachable daemon mid-poll fails safe to deny", async () => {
  let first = true;
  const out = await review(
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
  expect(out.behavior).toBe("deny");
});

test("a failure logs the step + context to caret.log and surfaces the path", async () => {
  const out = await review(
    stdin,
    reviewDeps({
      ensureDaemon: async () => {
        throw new Error("daemon down");
      },
    }),
  );
  expect(out.feedback).toContain(logFile());
  const rec = caretLogRecords().find((r) => r.step === "ensureDaemon");
  expect(rec).toMatchObject({ level: 50, msg: "daemon down", sessionId: "S", cwd: "/p" });
});

test("a failed reconnect logs step=reconnect, not the poll step", async () => {
  let firstEnsure = true;
  await review(
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
  const recs = caretLogRecords();
  expect(recs.some((r) => r.step === "reconnect")).toBe(true);
  expect(recs.some((r) => r.step === "longPoll")).toBe(false);
});

const boom = () => Promise.reject(new Error("boom"));

test.each<[string, string, Partial<ReviewDeps>, string]>([
  ["an unparseable hook input", "not json", {}, "hook-input-invalid"],
  ["an unreachable daemon", stdin, { ensureDaemon: boom }, "daemon-unreachable"],
  ["a review the daemon did not create", stdin, { postReview: boom }, "review-create-failed"],
  [
    "a review that outlives its timeout",
    stdin,
    { longPoll: () => new Promise<Decision>(() => {}), timeoutMs: 30 },
    "review-timeout",
  ],
])("%s logs its failure code", async (_case, input, over, code) => {
  await review(input, reviewDeps(over));
  expect(caretLogRecords().find((r) => r.level === 50)?.code).toBe(code);
});

// The command layer's post-review records (signal deny, notes skipped) rely on this.
test("a record logged after runReview returns still carries the review's ids", async () => {
  await review(stdin, reviewDeps());
  logInfo("after", "post-review record");
  const rec = caretLogRecords().find((r) => r.step === "after");
  expect(rec).toMatchObject({ reviewId: "rid", sessionId: "S" });
});

// ---- cmux pane capture (EXC-961) ----

/** Capture the PlanInput runReview posts, so the pane stamp is observable. */
async function postedInput(over: Partial<ReviewDeps> = {}) {
  let posted: PlanInput | undefined;
  await review(
    stdin,
    reviewDeps({
      postReview: async (_baseUrl: string, input: PlanInput) => {
        posted = input;
        return { id: "rid" };
      },
      ...over,
    }),
  );
  return posted;
}

test("the cmux pane readPane reports rides onto the posted plan input", async () => {
  const posted = await postedInput({
    readPane: () => ({ workspaceId: "w1", surfaceId: "s1" }),
  });
  expect(posted?.cmux).toEqual({ workspaceId: "w1", surfaceId: "s1" });
});

test("no cmux pane is posted when readPane is unwired", async () => {
  expect((await postedInput())?.cmux).toBeUndefined();
});

test("no cmux pane is posted when readPane reports none (not under cmux)", async () => {
  expect((await postedInput({ readPane: () => undefined }))?.cmux).toBeUndefined();
});

// ---- plan-format guard ----

function planStdin(plan: string | undefined): string {
  return JSON.stringify({ session_id: "S", cwd: "/p", tool_input: { plan } });
}

test("a bare-fence plan is denied for format before any daemon work", async () => {
  let ensureCalls = 0;
  let postCalls = 0;
  const out = await review(
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
  expect(out).toMatchObject({
    behavior: "deny",
    feedback: PLAN_FORMAT_DENY_MESSAGE,
  });
  // The format-deny short-circuits: no daemon spin-up, no review created.
  expect(ensureCalls).toBe(0);
  expect(postCalls).toBe(0);
});

test.each<[string, string | undefined]>([
  ["absent", undefined],
  ["empty", ""],
  ["whitespace-only", " \n\t"],
])("a blank plan (%s) is denied before any daemon work", async (_kind, plan) => {
  let ensureCalls = 0;
  let postCalls = 0;
  const out = await review(
    planStdin(plan),
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
  expect(out).toMatchObject({ behavior: "deny", feedback: PLAN_EMPTY_DENY_MESSAGE });
  expect(ensureCalls).toBe(0);
  expect(postCalls).toBe(0);
});

test.each<[string, string | undefined]>([
  ["a fully-tagged plan is posted for review as before", "# Plan\n\n```ts\nconst x = 1;\n```\n"],
  ["a plan with no code blocks is posted for review", "# Just prose, no code.\n"],
])("%s", async (_title, plan) => {
  let postCalls = 0;
  const out = await review(
    planStdin(plan),
    reviewDeps({
      postReview: async () => {
        postCalls++;
        return { id: "rid" };
      },
    }),
  );
  expect(out.behavior).toBe("allow");
  expect(postCalls).toBe(1);
});

test("a format-deny is logged at info — an expected reject, not an error", async () => {
  await review(
    JSON.stringify({ session_id: "FMT", cwd: "/p", tool_input: { plan: "```\nx\n```\n" } }),
    reviewDeps(),
  );
  // Stable contract: the format reject is an info-level "validatePlan" record
  // carrying the session — assert the step/level/field and the "plan rejected"
  // token, not the exact descriptive tail (F1 brittleness reduction).
  const rec = caretLogRecords().find((r) => r.step === "validatePlan");
  expect(rec).toMatchObject({ level: 30, sessionId: "FMT" });
  expect(typeof rec?.msg === "string" && rec.msg.startsWith("plan rejected")).toBe(true);
});

// ---- decision outcome records (EXC-398) ----

test("a rejected plan is logged at info without the feedback body (EXC-444)", async () => {
  await review(
    stdin,
    reviewDeps({
      longPoll: async () => ({ behavior: "deny", feedback: "tighten phase 2", decidedAt: 1 }),
    }),
  );
  const rec = caretLogRecords().find((r) => r.step === "decision");
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
  await review(stdin, reviewDeps());
  const rec = caretLogRecords().find((r) => r.step === "decision");
  expect(rec).toMatchObject({ level: 30, msg: "plan approved", sessionId: "S" });
});

// ---- hook-path instrumentation (EXC-444) ----

test("a review start is logged at info with session context", async () => {
  await review(stdin, reviewDeps());
  const rec = caretLogRecords().find((r) => r.step === "review" && r.msg === "review requested");
  expect(rec).toMatchObject({ level: 30, sessionId: "S", cwd: "/p" });
});

test("the posted review id is logged at debug and stitches later records", async () => {
  setLogLevel("debug");
  await review(stdin, reviewDeps());
  // Locate the create record by its stable contract (debug "review" step
  // carrying the reviewId), not the id-embedding message prose (F1 style).
  const posted = caretLogRecords().find((r) => r.step === "review" && r.reviewId === "rid");
  expect(posted).toMatchObject({ level: 20, step: "review", reviewId: "rid" });
  // Once the id is known, every later record carries it — caret.log records
  // stitch against the daemon's review/resolve records by reviewId.
  const decision = caretLogRecords().find((r) => r.step === "decision");
  expect(decision).toMatchObject({ msg: "plan approved", reviewId: "rid" });
});

test("an approved plan's record carries the acceptMode", async () => {
  await review(
    stdin,
    reviewDeps({
      longPoll: async () => ({ behavior: "allow", acceptMode: "yolo", decidedAt: 1 }),
    }),
  );
  const rec = caretLogRecords().find((r) => r.step === "decision");
  expect(rec).toMatchObject({ msg: "plan approved", acceptMode: "yolo" });
});

test("a failure after the review was posted carries the reviewId", async () => {
  await review(
    stdin,
    reviewDeps({ longPoll: () => new Promise<Decision>(() => {}), timeoutMs: 30 }),
  );
  const rec = caretLogRecords().find((r) => r.level === 50);
  expect(rec).toMatchObject({ step: "longPoll", reviewId: "rid", sessionId: "S" });
});

test("a review that fails to parse carries no ids from the review before it", async () => {
  await review(stdin, reviewDeps());
  await review("not json", reviewDeps());
  const rec = caretLogRecords().find((r) => r.step === "parse");
  expect([rec?.level, rec?.sessionId, rec?.reviewId]).toEqual([50, undefined, undefined]);
});

test("decision info records are suppressed when the level is error", async () => {
  setLogLevel("error");
  await review(
    stdin,
    reviewDeps({
      longPoll: async () => ({ behavior: "deny", feedback: "nope", decidedAt: 1 }),
    }),
  );
  expect(caretLogRecords()).toHaveLength(0);
});

// ---- onPosted seam + abandon expiry (EXC-482) ----
//
// The signal handlers in commands/review.ts fire outside runReview's control
// flow, so they need the daemon base URL + review id runReview computed. onPosted
// surfaces that handle the moment the review is created; expireAbandoned is the
// best-effort expire the abandon path runs so caret's UI drops the pending review
// instead of keeping a zombie.

test("onPosted fires with the daemon base URL, review id and version once the review is created", async () => {
  const posted: PostedReview[] = [];
  await review(
    stdin,
    reviewDeps({
      ensureDaemon: async () => "http://d",
      postReview: async () => ({ id: "rid", version: 2 }),
      onPosted: (p) => posted.push(p),
    }),
  );
  expect(posted).toEqual([{ baseUrl: "http://d", id: "rid", version: 2 }]);
});

test("onPosted carries the daemon's verdict on whether the plan file is current", async () => {
  const posted: PostedReview[] = [];
  await review(
    stdin,
    reviewDeps({
      postReview: async () => ({ id: "rid", planFileCurrent: false }),
      onPosted: (p) => posted.push(p),
    }),
  );
  expect(posted[0]?.planFileCurrent).toBe(false);
});

test("onPosted does not fire when the review was never created", async () => {
  const posted: string[] = [];
  await review(
    stdin,
    reviewDeps({
      ensureDaemon: async () => {
        throw new Error("boom");
      },
      onPosted: ({ id }) => posted.push(id),
    }),
  );
  expect(posted).toEqual([]);
});

test("expireAbandoned expires the posted review at its version", async () => {
  const expired: Array<[string, string, number | undefined]> = [];
  await expireAbandoned(
    async (baseUrl, id, version) => {
      expired.push([baseUrl, id, version]);
    },
    { baseUrl: "http://d", id: "rid", version: 2 },
  );
  expect(expired).toEqual([["http://d", "rid", 2]]);
});

test("expireAbandoned is a no-op when nothing was posted yet", async () => {
  let calls = 0;
  await expireAbandoned(async () => {
    calls++;
  }, undefined);
  expect(calls).toBe(0);
});

test("expireAbandoned swallows an expire failure (best-effort, never throws)", async () => {
  await expect(
    expireAbandoned(
      async () => {
        throw new Error("daemon gone");
      },
      { baseUrl: "http://d", id: "rid" },
    ),
  ).resolves.toBeUndefined();
});
