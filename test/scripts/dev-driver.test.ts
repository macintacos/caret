import { afterEach, beforeEach, expect, test } from "bun:test";
import { join } from "node:path";

import { PLAN_REJECTED_MESSAGE } from "@/config/constants.ts";
import { setLogLevel } from "@/lib/log.ts";
import { hasUntaggedCodeBlock } from "@/plan/format.ts";
import { runReview } from "@/review/orchestrate.ts";
import {
  assertDevEnv,
  bootstrapReview,
  devReviewDeps,
  runExtraReview,
  runExtraSeeder,
} from "@/tasks/dev/driver.ts";
import {
  appendRevision,
  DEFAULT_NUM_VERSIONS,
  DEMO_EDIT_GROUPS,
  DEV_SESSION,
  demoVersions,
  extraPlan,
  hookStdin,
  nextPlan,
  parseNumVersions,
  parsePositiveInt,
} from "@/tasks/dev/protocol.ts";

import { bootDaemon, type TestDaemon } from "../support/daemon.ts";
import { setupTempStateDir } from "../support/env.ts";
import { waitFor } from "../support/poll.ts";
import { expectNeverLogsBody } from "../support/redaction.ts";

// The final ("current") demo plan the driver seeds — read independently here so
// the assertions don't lean on the driver's own loader.
const PLAN_V1 = await Bun.file(`${import.meta.dir}/../../scripts/tasks/dev/fake-plan.md`).text();

// Lines that differ positionally between two same-shaped texts — lets a test
// assert a change is narrowly targeted (no lines added or removed, one rewritten).
function differingLines(a: string, b: string): string[] {
  const la = a.split("\n");
  const lb = b.split("\n");
  const out: string[] = [];
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) out.push(lb[i] ?? la[i] ?? "");
  }
  return out;
}

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
  // The stress-test seed (scripts/tasks/dev/fake-plan.md) deliberately exercises many
  // code languages; every fence must carry a language tag or the hook's
  // plan-format gate would deny it. This is also why appendRevision over the
  // fixture stays untagged-free below.
  expect(hasUntaggedCodeBlock(PLAN_V1)).toBe(false);
});

// ---- extraPlan ----

test("extraPlan retitles the h1 so the extra review is distinguishable", () => {
  // Review titles derive from the plan's first heading (src/review/threading.ts), so
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

// ---- demoVersions ----

test("demoVersions returns exactly count plans, oldest first, ending at the final plan", () => {
  const plans = demoVersions(PLAN_V1, 4);
  expect(plans).toHaveLength(4);
  // The newest version — the "current" plan the reviewer lands on — is the final
  // plan verbatim; only the earlier drafts differ (EXC-811).
  expect(plans[3]).toBe(PLAN_V1);
});

test("demoVersions makes every consecutive pair a non-empty, varied diff (not append-only)", () => {
  const plans = demoVersions(PLAN_V1, 4);
  // No two adjacent versions are equal — each edit group actually lands.
  for (let i = 1; i < plans.length; i++) {
    expect(plans[i]).not.toBe(plans[i - 1]);
  }
  // Unlike the old append-only bootstrap, an earlier draft is NOT a prefix of a
  // later one: the drafts change text in place rather than only appending.
  expect(plans[3]!.startsWith(plans[0]!.trimEnd())).toBe(false);
});

test("demoVersions makes the default (current vs previous) pair a single targeted change", () => {
  const plans = demoVersions(PLAN_V1, 4);
  const current = plans[3] as string;
  const previous = plans[2] as string;
  // The one authored group-0 edit: 92% (final) ← 88% (previous draft).
  expect(current).toContain("92%");
  expect(current).not.toContain("88%");
  expect(previous).toContain("88%");
  expect(previous).not.toContain("92%");
  // …and it really is a single line-level change between the two versions.
  expect(differingLines(previous, current)).toHaveLength(1);
});

test("demoVersions with count 1 is just the final plan", () => {
  expect(demoVersions(PLAN_V1, 1)).toEqual([PLAN_V1]);
});

test("demoVersions never introduces untagged code blocks", () => {
  for (const plan of demoVersions(PLAN_V1, DEFAULT_NUM_VERSIONS)) {
    expect(hasUntaggedCodeBlock(plan)).toBe(false);
  }
});

// Fixture-drift guard: every reverse edit must still match fake-plan.md, or the
// diff it produces silently flattens to empty. Fails loudly if the fixture is
// edited out from under an edit's `from` span.
test("every DEMO_EDIT_GROUPS `from` span still exists in the fixture", () => {
  for (const group of DEMO_EDIT_GROUPS) {
    for (const { from } of group) {
      expect(PLAN_V1.includes(from)).toBe(true);
    }
  }
});

// ---- parsePositiveInt (shared by the driver flag and the CLI option) ----

test("parsePositiveInt accepts positive integers and names the flag on error", () => {
  expect(parsePositiveInt("5", "--num-versions")).toBe(5);
  expect(parsePositiveInt("1", "--x")).toBe(1);
  for (const bad of ["0", "-2", "abc", "2.5", "", undefined]) {
    expect(() => parsePositiveInt(bad, "--x")).toThrow("--x expects a positive integer");
  }
});

// ---- parseNumVersions (--num-versions dev flag) ----

test("parseNumVersions defaults to four versions when the flag is absent", () => {
  expect(DEFAULT_NUM_VERSIONS).toBe(4);
  expect(parseNumVersions(["bun", "driver.ts"])).toBe(DEFAULT_NUM_VERSIONS);
});

test("parseNumVersions reads the integer after --num-versions", () => {
  expect(parseNumVersions(["bun", "driver.ts", "--num-versions", "5"])).toBe(5);
  // Order-independent and coexists with other flags.
  expect(parseNumVersions(["bun", "driver.ts", "--notify", "--num-versions", "1"])).toBe(1);
});

test("parseNumVersions rejects non-positive-integer values loudly", () => {
  for (const bad of ["0", "-2", "abc", "2.5", ""]) {
    expect(() => parseNumVersions(["bun", "driver.ts", "--num-versions", bad])).toThrow();
  }
  // Flag present but no value → throw rather than silently default.
  expect(() => parseNumVersions(["bun", "driver.ts", "--num-versions"])).toThrow();
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

test("nextPlan on a Reject deny waits — no revision, no resubmit (EXC-685)", () => {
  // The reviewer rejected the plan (deny carrying the canned reject-and-wait
  // message). The dev agent must NOT thread a revision and re-present — it
  // simulates waiting for the user's next message. Distinct from request-changes.
  const revised = appendRevision(PLAN_V1, "earlier feedback", 1);
  const next = nextPlan(
    { plan: revised, revision: 1 },
    { behavior: "deny", feedback: PLAN_REJECTED_MESSAGE, decidedAt: 1 },
    PLAN_V1,
  );
  expect(next.action).toBe("wait");
  expect(next.plan).toBe(revised);
  expect(next.plan).not.toContain("## Revision 2");
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

test("bootstrapReview grows the primary review to several varied versions before the loop", async () => {
  await boot();
  const deps = devReviewDeps(base);
  const state = await bootstrapReview(base, PLAN_V1, deps);
  const review = d.store.bySession(DEV_SESSION)[0];
  expect(review).toBeDefined();
  // Default is four versions — the final plan plus three earlier drafts, one per
  // kind of diff, enough for every flavor to show in the version-compare picker.
  expect(review!.versions).toHaveLength(4);
  // Diff variety, not append-only: the newest version carries the final's
  // targeted value (92%) while the previous draft still carries the earlier one
  // (88%), so comparing them shows a real in-place change, not appended text.
  const plans = review!.versions.map((v) => v.plan);
  expect(plans.at(-1)).toContain("92%");
  expect(plans.at(-1)).not.toContain("88%");
  expect(plans.at(-2)).toContain("88%");
  // The review is left rejected; the interactive loop re-pends it by appending
  // its own next revision from the returned state. The returned plan carries that
  // next revision so the loop's first post is a fresh version, not a duplicate.
  expect(review!.status).toBe("rejected");
  expect(state.revision).toBe(4);
  expect(state.plan).toContain("## Revision 4");
});

test("bootstrapReview honors an explicit --num-versions count", async () => {
  await boot();
  const deps = devReviewDeps(base);
  const state = await bootstrapReview(base, PLAN_V1, deps, 5);
  const review = d.store.bySession(DEV_SESSION)[0];
  expect(review!.versions).toHaveLength(5);
  expect(state.revision).toBe(5);
  expect(state.plan).toContain("## Revision 5");
});

test("bootstrapReview with a single version seeds just v1", async () => {
  await boot();
  const deps = devReviewDeps(base);
  const state = await bootstrapReview(base, PLAN_V1, deps, 1);
  const review = d.store.bySession(DEV_SESSION)[0];
  expect(review!.versions).toHaveLength(1);
  expect(state.revision).toBe(1);
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
