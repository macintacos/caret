import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";
import { runReview } from "../../src/review.ts";
import { setLogLevel } from "../../src/log.ts";
import { hasUntaggedCodeBlock } from "../../src/plan-format.ts";
import {
  assertDevEnv,
  bootstrapReview,
  devReviewDeps,
  runExtraReview,
  runExtraSeeder,
} from "../../scripts/dev/driver.ts";
import {
  appendRevision,
  bootstrapPlans,
  DEV_SESSION,
  extraPlan,
  hookStdin,
  nextPlan,
} from "../../scripts/dev/protocol.ts";
import { bootDaemon, type TestDaemon } from "../support/daemon.ts";
import { setupTempStateDir } from "../support/env.ts";
import { waitFor } from "../support/poll.ts";
import { expectNeverLogsBody } from "../support/redaction.ts";

// The v1 fixture the driver seeds — read independently here so the assertions
// don't lean on the driver's own loader.
const PLAN_V1 = await Bun.file(`${import.meta.dir}/../../scripts/dev/fake-plan.md`).text();

// Point the state dir at the per-test temp dir so the hook logging that
// runReview performs lands in a disposable caret.log, not the real one — the
// daemon's store roots there too, so its caret.log is the one the tests read.
const stateDir = setupTempStateDir("caret-driver-");
let dir: string;
let d: TestDaemon;
let base: string;

// Boot a real in-process daemon (no browser, no spawned process).
async function boot() {
  d = await bootDaemon(dir);
  base = d.url;
}

// Simulate the browser's decision (the UI's POST /resolve).
async function resolve(id: string, behavior: "allow" | "deny", feedback?: string) {
  await d.resolve(id, { behavior, feedback });
}

async function clientReview(id: string) {
  return (await d.getReview(id)) as unknown as {
    currentPlan: string;
    version: number;
    status: string;
    sessionId: string;
  };
}

beforeEach(() => {
  dir = stateDir();
});
afterEach(() => {
  setLogLevel("info"); // undo any per-test level change
  d?.stop();
});

// ---- DEV_SESSION (EXC-461) ----

test("DEV_SESSION is per-instance: suffixed, never the bare caret-dev", () => {
  // Two dev sessions deliberately sharing one daemon must not collide on
  // session identity — the pid suffix makes each driver process its own session.
  expect(DEV_SESSION.startsWith("caret-dev-")).toBe(true);
  expect(DEV_SESSION).not.toBe("caret-dev");
});

// ---- hookStdin ----

test("hookStdin shapes the PermissionRequest stdin the hook parses", () => {
  const parsed = JSON.parse(hookStdin("# P")) as {
    session_id: string;
    cwd: string;
    tool_input: { plan: string };
  };
  expect(parsed.session_id).toBe(DEV_SESSION);
  expect(parsed.cwd).toBe(process.cwd());
  expect(parsed.tool_input.plan).toBe("# P");
});

test("hookStdin takes an explicit session id for extra reviews", () => {
  const parsed = JSON.parse(hookStdin("# P", "caret-dev-extra-1")) as { session_id: string };
  expect(parsed.session_id).toBe("caret-dev-extra-1");
});

// ---- seed fixture invariant (EXC-556) ----

test("the seeded fixture has no untagged code blocks", () => {
  // The stress-test seed (scripts/dev/fake-plan.md) deliberately exercises many
  // code languages; every fence must carry a language tag or the hook's
  // plan-format gate would deny it. This is also why appendRevision over the
  // fixture stays untagged-free below.
  expect(hasUntaggedCodeBlock(PLAN_V1)).toBe(false);
});

// ---- extraPlan ----

test("extraPlan retitles the h1 so the extra review is distinguishable", () => {
  // Review titles derive from the plan's first heading (src/reviews.ts), so
  // the retitle is what the switcher and the notification body display.
  const out = extraPlan("# Widget Cache Refactor\n\nbody", 2);
  expect(out).toStartWith("# Widget Cache Refactor — extra 2\n");
  expect(out).toContain("body");
});

// ---- appendRevision ----

test("appendRevision keeps the prior plan and quotes the feedback under a Revision N heading", () => {
  const out = appendRevision("# Plan body", "use a monotonic clock", 1);
  expect(out).toStartWith("# Plan body");
  expect(out).toContain("## Revision 1");
  expect(out).toContain("use a monotonic clock");
});

test("appendRevision never introduces untagged code blocks, even for hostile feedback", () => {
  const hostile = [
    "try this instead:",
    "```",
    "an untagged fence",
    "```",
    "    a four-space-indented line",
    "````",
    "an even longer fence",
    "````",
  ].join("\n");
  const out = appendRevision(PLAN_V1, hostile, 2);
  expect(hasUntaggedCodeBlock(out)).toBe(false);
  expect(out).toContain("an untagged fence");
  expect(out).toContain("an even longer fence");
});

// ---- bootstrapPlans ----

test("bootstrapPlans returns the v1 plan plus one entry per requested revision", () => {
  const plans = bootstrapPlans(PLAN_V1, 2);
  expect(plans).toHaveLength(3);
  expect(plans[0]).toBe(PLAN_V1);
});

test("bootstrapPlans threads each revision onto the previous, so versions grow", () => {
  const plans = bootstrapPlans(PLAN_V1, 2);
  // Each step keeps the prior text and adds the next Revision heading.
  expect(plans[1]).toStartWith(PLAN_V1.trimEnd());
  expect(plans[1]).toContain("## Revision 1");
  expect(plans[2]).toStartWith(plans[1]!.trimEnd());
  expect(plans[2]).toContain("## Revision 1");
  expect(plans[2]).toContain("## Revision 2");
});

test("bootstrapPlans with zero revisions is just the v1 plan", () => {
  expect(bootstrapPlans(PLAN_V1, 0)).toEqual([PLAN_V1]);
});

test("bootstrapPlans never introduces untagged code blocks", () => {
  for (const plan of bootstrapPlans(PLAN_V1, 2)) {
    expect(hasUntaggedCodeBlock(plan)).toBe(false);
  }
});

// ---- nextPlan ----

test("nextPlan on a reviewer deny appends a revision and bumps the counter", () => {
  const next = nextPlan(
    { plan: PLAN_V1, revision: 0 },
    { behavior: "deny", feedback: "tighten scope", decidedAt: 1 },
    PLAN_V1,
  );
  expect(next.action).toBe("revise");
  expect(next.revision).toBe(1);
  expect(next.plan).toContain("## Revision 1");
  expect(next.plan).toContain("tighten scope");
});

test("nextPlan treats a non-fail-safe reviewer deny as a real revision", () => {
  // Any deny whose feedback isn't a "caret: " fail-safe is reviewer feedback,
  // not a fail-safe — even the empty-feedback case the daemon may surface.
  const next = nextPlan(
    { plan: PLAN_V1, revision: 2 },
    { behavior: "deny", feedback: "Plan changes requested.", decidedAt: 1 },
    PLAN_V1,
  );
  expect(next.action).toBe("revise");
  expect(next.revision).toBe(3);
  expect(next.plan).toContain("## Revision 3");
});

test("nextPlan resubmits unchanged on the hook's own fail-safe deny shapes", () => {
  const next = nextPlan(
    { plan: PLAN_V1, revision: 1 },
    {
      behavior: "deny",
      feedback: "caret: review timed out — denying so no unreviewed plan ships. See /x.",
      decidedAt: 1,
    },
    PLAN_V1,
  );
  expect(next.action).toBe("resubmit");
  expect(next.plan).toBe(PLAN_V1);
  expect(next.revision).toBe(1);
});

test("nextPlan on approve re-seeds a fresh v1 and resets the counter", () => {
  const revised = appendRevision(PLAN_V1, "feedback", 1);
  const next = nextPlan(
    { plan: revised, revision: 1 },
    { behavior: "allow", decidedAt: 1 },
    PLAN_V1,
  );
  expect(next.action).toBe("reseed");
  expect(next.plan).toBe(PLAN_V1);
  expect(next.revision).toBe(0);
});

// ---- the real hook path, end to end ----

test("a revision round-trips through the real runReview hook path and logs to caret.log", async () => {
  await boot();
  const deps = devReviewDeps(base);
  // First submission: the driver's initial seed, through the real hook.
  const first = runReview(hookStdin(PLAN_V1), deps);
  const id = await waitFor(async () => {
    const list = (await (await fetch(`${base}/api/reviews`)).json()) as Array<{ id: string }>;
    return list[0]?.id;
  });
  await resolve(id, "deny", "needs a rollout plan");
  const out = await first;
  expect(out.behavior).toBe("deny");
  expect(out.feedback).toBe("needs a rollout plan");
  // The driver's step: append Revision 1 and resubmit through the same path.
  const next = nextPlan({ plan: PLAN_V1, revision: 0 }, out, PLAN_V1);
  const second = runReview(hookStdin(next.plan), deps);
  const threaded = await waitFor(async () => {
    const r = await clientReview(id);
    return r.version === 2 ? r : undefined;
  });
  expect(threaded.sessionId).toBe(DEV_SESSION);
  expect(threaded.status).toBe("pending");
  expect(threaded.currentPlan).toContain("## Revision 1");
  expect(threaded.currentPlan).toContain("needs a rollout plan");
  await resolve(id, "allow");
  const out2 = await second;
  expect(out2.behavior).toBe("allow");
  // Real hook records landed in the dev state dir's caret.log.
  const log = await Bun.file(join(dir, "caret", "caret.log")).text();
  expect(log).toContain('"step":"decision"');
  // EXC-444: reviewer feedback bodies are never logged — the rejected-plan
  // record carries only the feedback's length.
  expectNeverLogsBody(log, "needs a rollout plan");
  expect(log).toContain('"feedbackChars":20');
  expect(log).toContain(DEV_SESSION);
});

test("bootstrapReview grows the primary review to several versions before the loop", async () => {
  await boot();
  const deps = devReviewDeps(base);
  const state = await bootstrapReview(base, PLAN_V1, deps);
  const review = d.store.bySession(DEV_SESSION)[0];
  expect(review).toBeDefined();
  // Two bootstrap revisions threaded onto v1 → three versions, enough for the
  // version-compare picker to offer a non-default pair.
  expect(review!.versions).toHaveLength(3);
  // The review is left rejected; the interactive loop re-pends it by appending
  // its own next revision, resuming from this state.
  expect(review!.status).toBe("rejected");
  expect(state.revision).toBe(2);
});

test("runExtraReview runs one fresh-session review to resolution and stops", async () => {
  await boot();
  const deps = devReviewDeps(base);
  const session = "caret-dev-extra-test";
  const done = runExtraReview(session, extraPlan(PLAN_V1, 1), deps);
  // The extra review lands under its OWN session — a genuinely-new review id,
  // which is exactly what the notification path needs (EXC-427).
  const seeded = await waitFor(async () => {
    const list = (await (await fetch(`${base}/api/reviews`)).json()) as Array<{
      id: string;
      sessionId: string;
      title: string;
    }>;
    return list.find((r) => r.sessionId === session);
  });
  expect(seeded.title).toContain("— extra 1");
  // A reviewer deny threads a revision into the same extra review...
  await resolve(seeded.id, "deny", "extra feedback");
  const threaded = await waitFor(async () => {
    const r = await clientReview(seeded.id);
    return r.version === 2 ? r : undefined;
  });
  expect(threaded.currentPlan).toContain("## Revision 1");
  // ...and approve ends the thread: the loop completes instead of re-seeding.
  await resolve(seeded.id, "allow");
  await done;
  const remaining = (await (await fetch(`${base}/api/reviews`)).json()) as Array<unknown>;
  expect(remaining).toHaveLength(0);
});

// ---- runExtraSeeder ----

// Drive the seeder loop deterministically: each tick() releases one injected
// sleep and flushes microtasks; injected seeds resolve only when a test says
// so (an unresolved seed is a pending extra review).
function makeSeederHarness(maxPending?: number) {
  let release: (() => void) | undefined;
  const sleep = () =>
    new Promise<void>((r) => {
      release = r;
    });
  const seeds: { n: number; resolve: () => void }[] = [];
  const seed = (n: number) =>
    new Promise<void>((r) => {
      seeds.push({ n, resolve: r });
    });
  void runExtraSeeder(1, { seed, sleep, maxPending });
  const tick = async () => {
    release?.();
    await Bun.sleep(0); // let the loop run to its next sleep
  };
  return { seeds, tick };
}

test("runExtraSeeder seeds one numbered extra review per tick", async () => {
  const h = makeSeederHarness();
  await h.tick();
  await h.tick();
  expect(h.seeds.map((s) => s.n)).toEqual([1, 2]);
});

test("runExtraSeeder skips ticks at the pending cap and resumes on resolve", async () => {
  // Cap 2: two unresolved extras block further seeds — a wall of unapproved
  // extras must not pile up — but a resolve frees the next tick to seed again
  // (the hidden-tab demo keeps working even if an earlier extra sits pending).
  const h = makeSeederHarness(2);
  await h.tick();
  await h.tick();
  await h.tick(); // at the cap: skipped
  expect(h.seeds.map((s) => s.n)).toEqual([1, 2]);
  h.seeds[0]?.resolve();
  await Bun.sleep(0); // let the seeder's pending-- settle, as real seconds-apart ticks would
  await h.tick();
  expect(h.seeds.map((s) => s.n)).toEqual([1, 2, 3]);
});

// ---- isolation guard ----

test("assertDevEnv requires an explicit dev port + state dir (isolation guard)", () => {
  const savedPort = process.env.CARET_PORT;
  const savedState = process.env.XDG_STATE_HOME;
  try {
    // Missing port → reject.
    delete process.env.CARET_PORT;
    process.env.XDG_STATE_HOME = "/tmp/caret-dev-test";
    expect(() => assertDevEnv()).toThrow();
    // Production default port → reject (never touch the installed caret).
    process.env.CARET_PORT = "42718";
    expect(() => assertDevEnv()).toThrow();
    // Non-numeric / non-positive port → reject (the daemon would silently fall
    // back to the production default).
    process.env.CARET_PORT = "abc";
    expect(() => assertDevEnv()).toThrow();
    process.env.CARET_PORT = "0";
    expect(() => assertDevEnv()).toThrow();
    // Dev port but no isolated state dir → reject.
    process.env.CARET_PORT = "42719";
    delete process.env.XDG_STATE_HOME;
    expect(() => assertDevEnv()).toThrow();
    // Both explicit and non-default → ok.
    process.env.CARET_PORT = "42719";
    process.env.XDG_STATE_HOME = "/tmp/caret-dev-test";
    expect(() => assertDevEnv()).not.toThrow();
  } finally {
    if (savedPort === undefined) delete process.env.CARET_PORT;
    else process.env.CARET_PORT = savedPort;
    if (savedState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedState;
  }
});
