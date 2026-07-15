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
// scripts/tasks/dev/protocol.ts.

import { expireReview, longPoll, postReview, waitForHealth } from "../../../src/daemon/client.ts";
import { type ReviewDeps, runReview } from "../../../src/review.ts";
import { claudeAdapter } from "../../../src/adapters/claude/index.ts";
import { NEVER_IDLE_MS } from "../../../src/config/constants.ts";
import {
  DEFAULT_PORT,
  devSeeder,
  loadSettings,
  type Settings,
} from "../../../src/config/settings.ts";
import type { ClientReview } from "../../../src/lib/types.ts";
import {
  appendRevision,
  bootstrapPlans,
  DEFAULT_NUM_VERSIONS,
  DEV_SESSION,
  type DriverState,
  extraPlan,
  hookStdin,
  nextPlan,
  parseNumVersions,
} from "./protocol.ts";

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
    if (next.action === "wait") return; // rejected (EXC-685): the agent waits — thread done
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

/** Record a reviewer-style deny on the primary session's pending review, so the
 * next bootstrap submission threads onto it as a new version. Returns once the
 * deny is recorded; the concurrently-running runReview then observes the
 * decision and returns. */
async function denyPendingReview(base: string, feedback: string): Promise<void> {
  // The bootstrap is the only writer this early, so the session has exactly one
  // pending review; poll briefly for runReview's POST to land before resolving.
  for (let i = 0; i < 100; i++) {
    const res = await fetch(`${base}/api/reviews`);
    if (res.ok) {
      const pending = ((await res.json()) as ClientReview[]).find(
        (r) => r.sessionId === DEV_SESSION && r.status === "pending",
      );
      if (pending) {
        const out = await fetch(`${base}/api/reviews/${pending.id}/resolve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ behavior: "deny", feedback }),
        });
        if (!out.ok) throw new Error(`bootstrap deny failed: ${out.status}`);
        return;
      }
    }
    await Bun.sleep(20);
  }
  throw new Error("bootstrap deny: no pending review appeared");
}

/** Grow the primary dev review to several versions before the interactive loop,
 * so `mise run dev` always shows a multi-version review (the version-compare
 * picker is hidden below two versions). Each bootstrap plan is submitted through
 * the real hook (runReview) and denied, so the next threads on as a new version;
 * the review ends rejected at the final bootstrap version. The returned state
 * already carries the *next* revision, so the interactive loop's first post
 * appends a fresh version (re-pending the review) rather than re-submitting the
 * last bootstrap plan as a duplicate. */
export async function bootstrapReview(
  base: string,
  v1: string,
  deps: ReviewDeps,
  numVersions: number = DEFAULT_NUM_VERSIONS,
): Promise<DriverState> {
  // numVersions counts v1 itself, so the bootstrap threads one fewer revision.
  const plans = bootstrapPlans(v1, numVersions - 1);
  for (let i = 0; i < plans.length; i++) {
    // runReview blocks on the decision long-poll; the deny is what unblocks it.
    const reviewing = runReview(hookStdin(plans[i] as string), deps);
    await denyPendingReview(base, `Bootstrap revision ${i + 1} for the dev review.`);
    await reviewing;
  }
  log(`bootstrapped the dev review to ${plans.length} versions`);
  // The loop resumes by appending its first interactive revision onto the last
  // bootstrap plan; revision counts continue from the bootstrap total.
  const nextRevision = plans.length;
  const last = plans[plans.length - 1] as string;
  return {
    plan: appendRevision(last, "Continuing from the bootstrapped dev review.", nextRevision),
    revision: nextRevision,
  };
}

/** Everything the driver's supervision loop needs, resolved by its caller so
 * commander parses the flags exactly once. `runDev` (scripts/tasks/dev/run.ts)
 * calls `run` in-process with these; the standalone entry below builds them
 * from argv + env for direct `bun scripts/tasks/dev/driver.ts` debugging. */
export interface DriverOptions {
  /** The daemon base URL, e.g. `http://127.0.0.1:<port>`. */
  base: string;
  /** How many versions the primary review opens with. */
  numVersions: number;
  /** Arm the recurring extra-review seeder (the EXC-427 notification path). */
  notify: boolean;
  /** Settings snapshot the seeder's cadence and pending cap come from. */
  settings: Settings;
}

/** Submit plans through the real hook forever: seed v1, then per decision
 * append a feedback-quoting revision (request-changes), re-seed a fresh v1
 * (approve), or resubmit unchanged (the hook's own fail-safe denies). Runs
 * in-process under `mise run dev` (no subprocess), so its options arrive
 * already parsed rather than being re-read from argv. */
export async function run(opts: DriverOptions): Promise<void> {
  const { base, numVersions, notify, settings } = opts;
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
  const seeder = devSeeder(notify, settings);
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
  // Grow the primary review to several versions up front so the version-compare
  // picker has something to compare the moment the UI opens; the loop resumes
  // from the bootstrapped (rejected) review, appending its next revision.
  let state: DriverState = await bootstrapReview(base, v1, deps, numVersions);
  for (;;) {
    // Never throws: every abnormal path inside runReview becomes a deny.
    const out = await runReview(hookStdin(state.plan), deps);
    const next = nextPlan(state, out, v1);
    if (next.action === "wait") {
      // Reject (EXC-685): the agent waits for the user's next message instead of
      // re-presenting. Stop the primary loop — the daemon and UI stay up (run.ts
      // blocks on Vite, not on this driver), so no new plan is sent until the dev
      // session is restarted. This is the faithful "rejected → agent waits" demo.
      log("plan rejected → agent waits for the user (not resubmitting a plan)");
      return;
    }
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
  // Standalone debugging entry (`bun scripts/tasks/dev/driver.ts`): the isolated
  // dev env must already be exported, so guard it and resolve the options from
  // argv + env here. Under `mise run dev` the driver runs in-process instead and
  // is handed its options directly (scripts/tasks/dev/run.ts).
  assertDevEnv();
  run({
    base: `http://127.0.0.1:${process.env.CARET_PORT}`,
    numVersions: parseNumVersions(Bun.argv),
    notify: Bun.argv.includes("--notify"),
    settings: loadSettings(),
  }).catch((err) => {
    process.stderr.write(`caret dev driver: ${err}\n`);
    process.exit(1);
  });
}
