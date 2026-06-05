#!/usr/bin/env bun
// Deterministic dev driver: plays the agent's side of the caret protocol so
// `mise run dev` shows a fake plan that survives request-changes / approve
// round-trips — no real Claude session, no LLM. Every submission goes through
// the real hook logic (runReview from src/cli.ts) in-process, so format
// validation, posting, long-polling, decision handling, and hook logging
// (caret.log in the dev state dir) all run exactly as in production. On
// request-changes it appends a "Revision N" section quoting the reviewer's
// feedback and resubmits; on approve it re-seeds a fresh v1. The
// revision-threading contract lives in src/reviews.ts.

import {
  expireReview,
  httpHealth,
  longPoll,
  postReview,
  type ReviewDeps,
  runReview,
} from "../../src/cli.ts";
import type { PermissionDecision } from "../../src/feedback.ts";
import { DEFAULT_PORT } from "../../src/settings.ts";

/** Session id for the single dev review; stable for the process lifetime so a
 * revision threads into the same review instead of forking a new one, but
 * unique per driver instance (pid suffix) so two dev sessions deliberately
 * sharing one daemon don't collide on session identity (EXC-461). */
export const DEV_SESSION = `caret-dev-${process.pid}`;

const log = (msg: string) => process.stderr.write(`[caret dev driver] ${msg}\n`);

/** Poll the daemon's health endpoint until it reports the caret identity. */
async function waitForHealth(base: string, maxAttempts = 100): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if ((await httpHealth(base))?.service === "caret") return;
    await Bun.sleep(100);
  }
  throw new Error("caret dev daemon did not become healthy in time");
}

/** The hook stdin a real PermissionRequest session would pipe to `caret
 * review` — the fixed dev session by default, or an explicit session id for
 * the extra-review seeder. */
export function hookStdin(plan: string, sessionId = DEV_SESSION): string {
  return JSON.stringify({ session_id: sessionId, cwd: process.cwd(), tool_input: { plan } });
}

/** Append a "Revision N" section quoting the reviewer's feedback. The feedback
 * is fenced as `text` with a fence longer than any backtick run it contains, so
 * hostile feedback (untagged fences, indented code) can neither break out nor
 * introduce an untagged block — the plan-format gate would insta-reject the
 * revision (src/plan-format.ts). */
export function appendRevision(plan: string, feedback: string, n: number): string {
  const runs = feedback.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(3, ...runs.map((r) => r.length + 1)));
  return [
    plan.trimEnd(),
    "",
    `## Revision ${n}`,
    "",
    "Addressing the reviewer's feedback:",
    "",
    `${fence}text`,
    feedback,
    fence,
    "",
    "Adjusted the approach accordingly; resubmitting for another look.",
    "",
  ].join("\n");
}

/** Driver-side submission state: the plan to (re)submit and how many revision
 * sections it carries. */
export interface DriverState {
  plan: string;
  revision: number;
}

/** Pure step: from the hook's decision, compute the next submission. Approve
 * re-seeds a fresh v1 (the daemon ended the thread; reset the counter). A deny
 * whose message starts with "caret: " is one of the hook's own fail-safe /
 * format denies, not reviewer feedback — resubmit unchanged rather than append
 * a bogus revision. Any other deny is reviewer feedback (possibly the "Plan
 * changes requested." default for empty input): append a Revision N section. */
export function nextPlan(
  state: DriverState,
  decision: PermissionDecision,
  freshPlan: string,
): DriverState & { action: "reseed" | "revise" | "resubmit" } {
  if (decision.behavior === "allow") return { plan: freshPlan, revision: 0, action: "reseed" };
  const message = decision.message ?? "";
  if (message.startsWith("caret: ")) return { ...state, action: "resubmit" };
  const revision = state.revision + 1;
  return { plan: appendRevision(state.plan, message, revision), revision, action: "revise" };
}

/** ReviewDeps for dev — the analog of prodReviewDeps (src/cli.ts) with the
 * daemon owned by the mise task: ensureDaemon just waits for health on the
 * fixed dev URL (no spawn/takeover; a throw after the health budget bubbles to
 * runReview's fail-safe deny), the browser never opens (Vite on 5173 is the
 * dev surface), and timeoutMs is the max setTimeout delay (a larger value
 * overflows and clamps to ~1ms — the same trap .mise/tasks/dev documents for
 * CARET_IDLE_MS) so an idle session never churns fail-safe denies. */
export function devReviewDeps(base: string): ReviewDeps {
  return {
    ensureDaemon: async () => {
      await waitForHealth(base);
      return base;
    },
    postReview,
    longPoll,
    openBrowser: () => {},
    timeoutMs: 2147483647,
    expire: expireReview,
  };
}

/** Retitle the fake plan's h1 so an extra review is distinguishable from the
 * primary one in the switcher and in the notification body (review titles
 * derive from the plan's first heading, src/reviews.ts). */
export function extraPlan(plan: string, n: number): string {
  return plan.replace(/^# .*$/m, (title) => `${title} — extra ${n}`);
}

/** Run ONE review thread to resolution under its own session id: seed, append
 * a feedback-quoting revision on each reviewer deny, finish on approve (no
 * re-seed — the next extra review gets a fresh session instead). The hook's
 * own fail-safe denies resubmit unchanged after a backoff, like the primary
 * loop. */
export async function runExtraReview(
  sessionId: string,
  plan: string,
  deps: ReviewDeps,
): Promise<void> {
  let state: DriverState = { plan, revision: 0 };
  for (;;) {
    const out = await runReview(hookStdin(state.plan, sessionId), deps);
    const next = nextPlan(state, out.hookSpecificOutput.decision, plan);
    if (next.action === "reseed") return; // approved: this thread is done
    if (next.action === "revise") {
      log(`extra review: changes requested → appending Revision ${next.revision}`);
    } else {
      log("extra review: hook fail-safe deny → resubmitting unchanged");
      await Bun.sleep(500);
    }
    state = next;
  }
}

/** Default extra-review cadence; on unless explicitly disabled. */
const SEEDER_DEFAULT_MS = 15_000;

/** Resolve CARET_DEV_NEW_REVIEW_MS into a seeder interval. Unset → the
 * default (the seeder is on out of the box); a positive integer → that
 * cadence; 0 or negative → explicitly off (ms: null); anything else →
 * default with `invalid` flagged so the caller warns (settings house style:
 * set-but-invalid falls through, never silently disables). */
export function seederInterval(raw: string | undefined): { ms: number | null; invalid: boolean } {
  if (raw === undefined) return { ms: SEEDER_DEFAULT_MS, invalid: false };
  const n = Number(raw);
  if (raw === "" || !Number.isInteger(n)) return { ms: SEEDER_DEFAULT_MS, invalid: true };
  if (n <= 0) return { ms: null, invalid: false };
  return { ms: n, invalid: false };
}

export interface ExtraSeederDeps {
  /** Run one extra review thread to resolution (runExtraReview in prod). */
  seed: (n: number) => Promise<void>;
  /** Injectable for tests. Defaults to Bun.sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Unresolved-extras cap; ticks skip while at it. */
  maxPending?: number;
}

/** Seed numbered extra reviews forever, one per interval tick, WITHOUT waiting
 * for resolution — a hidden tab must keep receiving genuinely-new reviews even
 * while an earlier extra sits unapproved. The pending cap is what bounds the
 * pile-up instead: ticks skip while `maxPending` extras are unresolved and
 * resume once one resolves. */
export async function runExtraSeeder(intervalMs: number, deps: ExtraSeederDeps): Promise<never> {
  const sleep = deps.sleep ?? Bun.sleep;
  const maxPending = deps.maxPending ?? 3;
  let pending = 0;
  for (let n = 1; ; ) {
    await sleep(intervalMs);
    if (pending >= maxPending) continue;
    pending++;
    const id = n++;
    log(`seeding extra review ${id}`);
    void deps
      .seed(id)
      .then(undefined, (err) => log(`extra review ${id} failed: ${err}`))
      .finally(() => pending--);
  }
}

/** Refuse to run unless the dev port + isolated state dir are explicitly set —
 * never fall back to the production defaults and touch an installed caret. */
export function assertDevEnv(): void {
  const raw = process.env.CARET_PORT;
  const port = Number(raw);
  if (!raw || !Number.isInteger(port) || port <= 0 || port === DEFAULT_PORT) {
    throw new Error(
      `caret dev driver requires CARET_PORT set to a positive dev port distinct from the production default (${DEFAULT_PORT})`,
    );
  }
  if (!process.env.XDG_STATE_HOME) {
    throw new Error("caret dev driver requires XDG_STATE_HOME set to an isolated dev state dir");
  }
}

/** Submit plans through the real hook forever: seed v1, then per decision
 * append a feedback-quoting revision (request-changes), re-seed a fresh v1
 * (approve), or resubmit unchanged (the hook's own fail-safe denies). */
export async function run(): Promise<void> {
  assertDevEnv();
  const base = `http://127.0.0.1:${process.env.CARET_PORT}`;
  const v1 = await Bun.file(`${import.meta.dir}/fake-plan.md`).text();
  const deps = devReviewDeps(base);
  // Extra-review seeder (EXC-427), ON by default: seed a genuinely-new review
  // — fresh session, fresh review id — every interval tick, so backgrounding
  // the tab demos a real "new plan" desktop notification with no setup.
  // CARET_DEV_NEW_REVIEW_MS tunes the cadence; 0 disables. Loud at boot in
  // every case — a silent no-op here is indistinguishable from a broken
  // notification.
  const rawNewReviewMs = process.env.CARET_DEV_NEW_REVIEW_MS;
  const { ms: intervalMs, invalid } = seederInterval(rawNewReviewMs);
  if (invalid) {
    log(`CARET_DEV_NEW_REVIEW_MS invalid (want integer ms; 0 disables): ${rawNewReviewMs}`);
  }
  if (intervalMs !== null) {
    log(
      `extra-review seeder armed: a new review every ${intervalMs}ms (CARET_DEV_NEW_REVIEW_MS=0 disables)`,
    );
    void runExtraSeeder(intervalMs, {
      seed: (n) => runExtraReview(`${DEV_SESSION}-extra-${n}`, extraPlan(v1, n), deps),
    }).catch((err) => log(`extra-review seeder stopped: ${err}`));
  } else {
    log("extra-review seeder disabled (CARET_DEV_NEW_REVIEW_MS=0)");
  }
  let state: DriverState = { plan: v1, revision: 0 };
  for (;;) {
    // Never throws: every abnormal path inside runReview becomes a deny.
    const out = await runReview(hookStdin(state.plan), deps);
    const next = nextPlan(state, out.hookSpecificOutput.decision, v1);
    if (next.action === "revise") {
      log(`changes requested → appending Revision ${next.revision} and resubmitting`);
    } else if (next.action === "reseed") {
      log("approved → re-seeding a fresh plan");
    } else {
      // Fail-safe deny from the hook itself (daemon down, poll timeout): back
      // off so a dead daemon can't tight-loop. A fail-safe after a successful
      // post leaves the review pending, so the resubmit starts a NEW thread
      // (routeIncomingPlan appends only to a rejected review) and the Revision
      // label can drift from the daemon's version number — both are accepted
      // dev-only noise on an already-broken session.
      log("hook fail-safe deny → resubmitting the plan unchanged");
      await Bun.sleep(500);
    }
    state = next;
  }
}

if (import.meta.main) {
  run().catch((err) => {
    process.stderr.write(`caret dev driver: ${err}\n`);
    process.exit(1);
  });
}
