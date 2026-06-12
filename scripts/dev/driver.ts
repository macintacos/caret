#!/usr/bin/env bun
// Deterministic dev driver: plays the agent's side of the caret protocol so
// `mise run dev` shows a fake plan that survives request-changes / approve
// round-trips — no real Claude session, no LLM. Every submission goes through
// the real hook logic (runReview from src/review.ts) in-process, so format
// validation, posting, long-polling, decision handling, and hook logging
// (caret.log in the dev state dir) all run exactly as in production. On
// request-changes it appends a "Revision N" section quoting the reviewer's
// feedback and resubmits; on approve it re-seeds a fresh v1. The
// revision-threading contract lives in src/reviews.ts.
//
// This module owns the dev wiring (devReviewDeps) and the long-running
// supervision loops; the pure protocol state machine it drives lives in
// scripts/dev/protocol.ts.

import { expireReview, longPoll, postReview, waitForHealth } from "../../src/daemon-client.ts";
import { type ReviewDeps, runReview } from "../../src/review.ts";
import { claudeAdapter } from "../../src/adapters/claude/index.ts";
import { NEVER_IDLE_MS } from "../../src/constants.ts";
import { DEFAULT_PORT, devSeeder, loadSettings } from "../../src/settings.ts";
import { DEV_SESSION, type DriverState, extraPlan, hookStdin, nextPlan } from "./protocol.ts";

const log = (msg: string) => process.stderr.write(`[caret dev driver] ${msg}\n`);

/** ReviewDeps for dev — the analog of prodReviewDeps (src/commands/review.ts) with the
 * daemon owned by the mise task: ensureDaemon just waits for health on the
 * fixed dev URL (no spawn/takeover; a throw after the health budget bubbles to
 * runReview's fail-safe deny), the browser never opens (Vite on 5173 is the
 * dev surface), and timeoutMs is NEVER_IDLE_MS (the max setTimeout delay — a
 * larger value overflows and clamps to ~1ms) so an idle session never churns
 * fail-safe denies. */
export function devReviewDeps(base: string): ReviewDeps {
  return {
    parseHookInput: (stdin) => claudeAdapter.parseHookInput(stdin),
    ensureDaemon: async () => {
      await waitForHealth(base);
      return base;
    },
    postReview,
    longPoll,
    openBrowser: () => {},
    timeoutMs: NEVER_IDLE_MS,
    expire: expireReview,
  };
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
    const next = nextPlan(state, out, plan);
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
  // Extra-review seeder (EXC-427), OFF by default: when armed it seeds a
  // genuinely-new review — fresh session, fresh review id — every interval
  // tick, so backgrounding the tab demos a real "new plan" desktop
  // notification with no setup. EXC-558: armed by `--notify`, by
  // [dev.notify].enabled in config.toml (persists across runs), or by a
  // positive CARET_DEV_NEW_REVIEW_MS; the cadence and pending cap come from
  // [dev.notify] (CARET_DEV_NEW_REVIEW_MS overrides the cadence). Loud at boot
  // either way — a silent no-op is indistinguishable from a broken notification.
  const seeder = devSeeder(Bun.argv.includes("--notify"), loadSettings());
  if (seeder.intervalInvalid) {
    log(
      `CARET_DEV_NEW_REVIEW_MS invalid (want a positive integer ms): ${process.env.CARET_DEV_NEW_REVIEW_MS}`,
    );
  }
  if (seeder.enabled) {
    log(`extra-review seeder armed: a new review every ${seeder.intervalMs}ms`);
    void runExtraSeeder(seeder.intervalMs, {
      seed: (n) => runExtraReview(`${DEV_SESSION}-extra-${n}`, extraPlan(v1, n), deps),
      maxPending: seeder.maxPending,
    }).catch((err) => log(`extra-review seeder stopped: ${err}`));
  } else {
    log(
      "extra-review seeder off (pass --notify, set [dev.notify].enabled = true, or set CARET_DEV_NEW_REVIEW_MS)",
    );
  }
  let state: DriverState = { plan: v1, revision: 0 };
  for (;;) {
    // Never throws: every abnormal path inside runReview becomes a deny.
    const out = await runReview(hookStdin(state.plan), deps);
    const next = nextPlan(state, out, v1);
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
