import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReview } from "../src/cli.ts";
import { type CaretServer, createServer } from "../src/daemon.ts";
import { setLogLevel } from "../src/log.ts";
import { hasUntaggedCodeBlock } from "../src/plan-format.ts";
import { createStore } from "../src/store.ts";
import {
  appendRevision,
  assertDevEnv,
  DEV_SESSION,
  devReviewDeps,
  hookStdin,
  nextPlan,
} from "../scripts/dev/driver.ts";

// The v1 fixture the driver seeds — read independently here so the assertions
// don't lean on the driver's own loader.
const PLAN_V1 = await Bun.file(`${import.meta.dir}/../scripts/dev/fake-plan.md`).text();

let dir: string;
let srv: CaretServer;
let base: string;

// Point the state dir at the per-test temp dir so the hook logging that
// runReview performs lands in a disposable caret.log, not the real one —
// the same hygiene test/cli.test.ts uses.
let savedXdg: string | undefined;

// Boot a real in-process daemon (no browser, no spawned process), exactly the
// pattern test/daemon.test.ts uses.
async function boot() {
  const store = createStore(dir);
  await store.rehydrate();
  srv = createServer({ store, port: 0, idleMs: 1_000_000, onShutdown: () => {} });
  base = `http://localhost:${srv.port}`;
}

// Simulate the browser's decision (the UI's POST /resolve).
async function resolve(id: string, behavior: "allow" | "deny", feedback?: string) {
  await fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior, feedback }),
  });
}

async function clientReview(id: string) {
  return (await (await fetch(`${base}/api/reviews/${id}`)).json()) as {
    currentPlan: string;
    version: number;
    status: string;
    sessionId: string;
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-driver-"));
  savedXdg = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = dir;
});
afterEach(async () => {
  if (savedXdg === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedXdg;
  setLogLevel("info"); // undo any per-test level change
  srv?.stop();
  await rm(dir, { recursive: true, force: true });
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

// ---- nextPlan ----

test("nextPlan on a reviewer deny appends a revision and bumps the counter", () => {
  const next = nextPlan({ plan: PLAN_V1, revision: 0 }, { behavior: "deny", message: "tighten scope" }, PLAN_V1);
  expect(next.action).toBe("revise");
  expect(next.revision).toBe(1);
  expect(next.plan).toContain("## Revision 1");
  expect(next.plan).toContain("tighten scope");
});

test("nextPlan treats the empty-feedback default message as a real revision", () => {
  // toHookOutput maps empty feedback to this fixed message; it is still a
  // reviewer decision, not a fail-safe.
  const next = nextPlan(
    { plan: PLAN_V1, revision: 2 },
    { behavior: "deny", message: "Plan changes requested." },
    PLAN_V1,
  );
  expect(next.action).toBe("revise");
  expect(next.revision).toBe(3);
  expect(next.plan).toContain("## Revision 3");
});

test("nextPlan resubmits unchanged on the hook's own fail-safe deny shapes", () => {
  const next = nextPlan(
    { plan: PLAN_V1, revision: 1 },
    { behavior: "deny", message: "caret: review timed out — denying so no unreviewed plan ships. See /x." },
    PLAN_V1,
  );
  expect(next.action).toBe("resubmit");
  expect(next.plan).toBe(PLAN_V1);
  expect(next.revision).toBe(1);
});

test("nextPlan on approve re-seeds a fresh v1 and resets the counter", () => {
  const revised = appendRevision(PLAN_V1, "feedback", 1);
  const next = nextPlan({ plan: revised, revision: 1 }, { behavior: "allow" }, PLAN_V1);
  expect(next.action).toBe("reseed");
  expect(next.plan).toBe(PLAN_V1);
  expect(next.revision).toBe(0);
});

// ---- the real hook path, end to end ----

/** Poll an async probe until it returns a value or the budget elapses. */
async function waitFor<T>(probe: () => Promise<T | undefined>, ms = 5000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const v = await probe();
    if (v !== undefined) return v;
    if (Date.now() - start > ms) throw new Error("waitFor: timed out");
    await Bun.sleep(20);
  }
}

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
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
  expect(out.hookSpecificOutput.decision.message).toBe("needs a rollout plan");
  // The driver's step: append Revision 1 and resubmit through the same path.
  const next = nextPlan({ plan: PLAN_V1, revision: 0 }, out.hookSpecificOutput.decision, PLAN_V1);
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
  expect(out2.hookSpecificOutput.decision.behavior).toBe("allow");
  // Real hook records landed in the dev state dir's caret.log.
  const log = await Bun.file(join(dir, "caret", "caret.log")).text();
  expect(log).toContain('"step":"decision"');
  // EXC-444: reviewer feedback bodies are never logged — the rejected-plan
  // record carries only the feedback's length.
  expect(log).not.toContain("needs a rollout plan");
  expect(log).toContain('"feedbackChars":20');
  expect(log).toContain(DEV_SESSION);
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
