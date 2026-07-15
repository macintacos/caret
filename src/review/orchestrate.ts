// Review orchestration core: run one plan review end-to-end and return the
// tool-agnostic `Decision`. Tool-agnostic throughout — the agent's stdin shape
// is parsed behind the injected `parseHookInput`, and the command layer renders
// the returned Decision to the agent's wire string via the adapter's
// `emitDecision`. This module names no agent's wire protocol.
//
// FAIL-SAFE = DENY: shipping an unreviewed plan is the one outcome we never
// allow. Every abnormal path (bad stdin, unreachable daemon, timeout, daemon
// death) becomes a deny Decision — runReview never throws.

import { VANITY_HOST } from "../daemon/guards.ts";
import { type ErrorContext, logDebug, logError, logInfo, shortId } from "../lib/log.ts";
import { logFile } from "../config/paths.ts";
import { hasUntaggedCodeBlock, PLAN_FORMAT_DENY_MESSAGE } from "../plan/format.ts";
import { type Decision, errorMessage, type PlanInput } from "../lib/types.ts";

/** A fail-safe deny the core constructs when an unreviewed plan must never ship.
 * The reason rides in `feedback`; the adapter renders it to the tool's deny wire
 * shape at the emission boundary. */
function denyDecision(reason: string): Decision {
  return { behavior: "deny", feedback: reason, decidedAt: Date.now() };
}

export interface ReviewDeps {
  /** Normalize the agent's raw hook stdin into a core PlanInput. Throws on input
   * that can't be parsed — the throw becomes the fail-safe deny. */
  parseHookInput: (stdin: string) => PlanInput;
  /** Ensure a daemon is up and return its base URL. */
  ensureDaemon: () => Promise<string>;
  /** Create the review. `hasLiveClient` (EXC-559) reports whether a UI tab is
   * already polling the daemon; when true the hook skips opening the browser so
   * an open backgrounded tab's away-gated notification isn't pre-empted. */
  postReview: (
    baseUrl: string,
    input: PlanInput,
  ) => Promise<{ id: string; hasLiveClient?: boolean }>;
  /** One bounded poll: a Decision, or null on a heartbeat (re-poll). Throws on
   * a transient drop so the caller can reconnect. */
  longPoll: (baseUrl: string, id: string) => Promise<Decision | null>;
  openBrowser: (url: string) => void;
  timeoutMs: number;
  /** Best-effort: tell the daemon the hook is abandoning this review, so it
   * doesn't hold a pending orphan (EXC-454). Failures are swallowed. */
  expire: (baseUrl: string, id: string) => Promise<void>;
  /** Called once the review is created, with the daemon base URL and review id.
   * Lets the command layer capture the handle so a SIGINT/SIGTERM abandon can
   * expire the review (EXC-482) — the signal fires outside runReview's control
   * flow, so it needs the id runReview computed. Optional: absent for the dev
   * driver and tests that don't wire signal handling. */
  onPosted?: (baseUrl: string, id: string) => void;
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new TimeoutError(message)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** The abandon path's best-effort expire: tell the daemon an interrupted review
 * is abandoned so its UI drops the pending review instead of keeping a zombie
 * (EXC-482). The command's SIGINT/SIGTERM handlers call it with the handle
 * `onPosted` surfaced. A no-op when the signal beat review creation (nothing to
 * expire), and it swallows any failure — the resubmit/supersede path self-heals
 * if the expire never lands (EXC-454). Never throws. */
export async function expireAbandoned(
  expire: (baseUrl: string, id: string) => Promise<void>,
  handle: { baseUrl: string; id: string } | undefined,
): Promise<void> {
  if (!handle) return;
  try {
    await expire(handle.baseUrl, handle.id);
  } catch {
    // best-effort — the resubmit/supersede path self-heals.
  }
}

/** Run a review end-to-end, returning the core `Decision`. Never throws — any
 * failure becomes a deny so an unreviewed plan can never ship. The command layer
 * renders the returned Decision to the agent's wire string via the adapter. */
export async function runReview(stdin: string, deps: ReviewDeps): Promise<Decision> {
  // Track the current step + context so the catch can log what actually failed.
  let step = "parse";
  const ctx: ErrorContext = {};
  // Hoisted so the catch can reach the daemon for the best-effort expire;
  // reconnects re-assign it, so it always holds the last-known daemon URL.
  let baseUrl: string | undefined;
  try {
    const input = deps.parseHookInput(stdin);
    ctx.sessionId = input.sessionId;
    // cwd is logged raw (diagnostic: which project this review came from); the
    // redact path home-scrubs it on share, so it is not a DENY_KEY (EXC-545).
    ctx.cwd = input.cwd;
    // The review's start-of-timeline anchor: even a format-deny or a crashed
    // run leaves a record of the request and its session.
    logInfo("review", "review requested", { ...ctx });

    // Reject plans with unhighlightable (untagged) code blocks before any daemon
    // work, so a format-only reject never spins up a daemon or creates a review.
    // The format-deny message is distinct from the fail-safe deny below; the
    // reject is an EXPECTED outcome, logged at info (default-on) so reject
    // loops stay diagnosable without reading as errors.
    step = "validatePlan";
    if (hasUntaggedCodeBlock(input.plan)) {
      logInfo(step, "plan rejected: code block missing language marker", ctx);
      return denyDecision(PLAN_FORMAT_DENY_MESSAGE);
    }

    step = "ensureDaemon";
    baseUrl = await deps.ensureDaemon();
    step = "postReview";
    const { id, hasLiveClient } = await deps.postReview(baseUrl, input);
    // From here every record — decision and error alike — carries the reviewId,
    // stitching this stream against the daemon's review/resolve records.
    ctx.reviewId = id;
    // Surface the handle so a SIGINT/SIGTERM abandon can expire this review
    // (EXC-482): the signal fires outside this flow, so the command layer needs
    // the base URL + id we just computed.
    deps.onPosted?.(baseUrl, id);
    logDebug("review", `review created: ${shortId(id)}`, { ...ctx });
    // EXC-426: humans get the vanity origin; internal fetches keep using baseUrl.
    const open = new URL(baseUrl);
    open.hostname = VANITY_HOST;
    const url = `${open.origin}/?review=${id}`;
    // EXC-559: a live UI tab already surfaces the review and runs the notifier;
    // foregrounding the browser would make the tab focused at the poll instant,
    // pre-empting the away-gated desktop notification. Only open when no tab is
    // listening (or an older daemon didn't report one — fail-safe to opening).
    if (!hasLiveClient) deps.openBrowser(url);
    // Also print the URL to stderr — clickable in the transcript if the browser
    // fails to open. NOTE: the OpenCode plugin (opencode/caret.plugin.ts,
    // parseReviewUrl) regex-parses this exact line to surface the link as a toast,
    // so keep the `caret: review this plan at <url>` wording stable.
    process.stderr.write(`caret: review this plan at ${url}\n`);

    step = "longPoll";
    // Poll until the browser decides: re-poll on each heartbeat (null), and on a
    // transient drop reconnect and keep going (the decision is served on
    // reconnect, so nothing is lost). One absolute deadline bounds the whole
    // loop: each poll is capped at the time remaining until it, so a single hung
    // request can't outlive the budget and an endless-heartbeat loop denies at
    // the same instant. A real timeout, or an unreachable daemon (ensureDaemon
    // throwing), bubbles out to the fail-safe deny below.
    const deadline = Date.now() + deps.timeoutMs;
    let decision: Decision | undefined;
    while (!decision) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new TimeoutError("review timed out");
      try {
        decision =
          (await withTimeout(deps.longPoll(baseUrl, id), remaining, "review timed out")) ??
          undefined;
      } catch (err) {
        if (err instanceof TimeoutError) throw err;
        // Reconnect — label this step so a failed reconnect logs the real
        // failing op, not the poll it was recovering from.
        step = "reconnect";
        baseUrl = await deps.ensureDaemon();
        step = "longPoll";
      }
    }
    // The reviewer's verdict is normal operation: record it at info. Never the
    // feedback body (EXC-444; reviewer prose is user-generated content like
    // plan bodies) — only its length, so reject loops stay distinguishable
    // from empty-feedback denies.
    if (decision.behavior === "deny") {
      logInfo("decision", "plan rejected", { ...ctx, feedbackChars: decision.feedback?.length });
    } else {
      logInfo("decision", "plan approved", { ...ctx, acceptMode: decision.acceptMode });
    }
    return decision;
  } catch (err) {
    logError(step, err, ctx);
    // The hook is abandoning the review (timeout or post-create failure):
    // best-effort expire so the daemon doesn't hold a pending orphan. The
    // supersede-on-resubmit path self-heals if this never lands (EXC-454).
    if (ctx.reviewId && baseUrl) {
      try {
        await deps.expire(baseUrl, ctx.reviewId);
        logDebug("review", `review expire requested: ${shortId(ctx.reviewId)}`, { ...ctx });
      } catch {
        logDebug("review", "review expire failed; resubmit supersedes", { ...ctx });
      }
    }
    const msg = errorMessage(err);
    return denyDecision(`caret: ${msg} — denying so no unreviewed plan ships. See ${logFile()}.`);
  }
}
