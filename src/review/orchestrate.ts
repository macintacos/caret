// Review orchestration core: run one plan review end-to-end and return the
// tool-agnostic `Decision`. Tool-agnostic throughout — the agent's stdin shape
// is parsed behind the injected `parseHookInput`, and the command layer renders
// the returned Decision to the agent's wire string via the adapter's
// `emitDecision`.
//
// FAIL-SAFE = DENY: shipping an unreviewed plan is the one outcome we never
// allow. Every abnormal path (bad stdin, unreachable daemon, timeout, daemon
// death) becomes a deny Decision — runReview never throws.

import { VANITY_HOST } from "@/config/constants.ts";
import { logFile } from "@/config/paths.ts";
// Type-only: the review core takes its daemon operations as deps and never imports
// the daemon at runtime.
import type { EnsureOptions } from "@/daemon/lifecycle.ts";
import { type ErrorContext, logDebug, logError, logInfo, shortId } from "@/lib/log.ts";
import { type CmuxPane, type Decision, errorMessage, type PlanInput } from "@/lib/types.ts";
import { hasUntaggedCodeBlock, PLAN_FORMAT_DENY_MESSAGE } from "@/plan/format.ts";

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
  /** Ensure a daemon is up and return its base URL. `takeover: false` attaches to
   * whichever daemon is already serving this world instead of replacing it with
   * this binary's own (see EnsureOptions) — what a mid-review reconnect wants. */
  ensureDaemon: (opts?: EnsureOptions) => Promise<string>;
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
  /** Show the human the review URL — clickable in the transcript when the browser
   * doesn't open, and the OpenCode plugin's only source for its toast. Injected
   * beside openBrowser because the core does no I/O of its own; the wording the
   * plugin parses is the command layer's (src/commands/review.ts, reviewUrlLine). */
  announceUrl: (url: string) => void;
  /** The cmux pane this hook process runs in, so the daemon can clear its unread
   * mark once the plan is reviewed (EXC-961). Injected because the pane comes
   * from the environment, which the core never reads itself. Optional: absent
   * for tests and the dev driver, and reports undefined outside cmux. */
  readPane?: () => CmuxPane | undefined;
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

    // Reject unhighlightable (untagged) code blocks before any daemon work, so a
    // format-only reject never spins up a daemon or creates a review. An EXPECTED
    // outcome, so it logs at info (default-on) and carries its own message rather
    // than the fail-safe deny's.
    step = "validatePlan";
    if (hasUntaggedCodeBlock(input.plan)) {
      logInfo(step, "plan rejected: code block missing language marker", ctx);
      return denyDecision(PLAN_FORMAT_DENY_MESSAGE);
    }

    step = "ensureDaemon";
    baseUrl = await deps.ensureDaemon();
    step = "postReview";
    // Stamp the originating cmux pane, if any: the daemon is long-lived and shared,
    // so it never inherits this hook's cmux environment (EXC-961).
    const { id, hasLiveClient } = await deps.postReview(baseUrl, {
      ...input,
      cmux: deps.readPane?.(),
    });
    // From here every record — decision and error alike — carries the reviewId,
    // stitching this stream against the daemon's review/resolve records.
    ctx.reviewId = id;
    // Surface the handle so a SIGINT/SIGTERM abandon can expire this review, from
    // outside this flow (EXC-482).
    deps.onPosted?.(baseUrl, id);
    logDebug("review", `review created: ${shortId(id)}`, { ...ctx });
    // EXC-426: humans get the vanity origin; internal fetches keep using baseUrl.
    const open = new URL(baseUrl);
    open.hostname = VANITY_HOST;
    const url = `${open.origin}/?review=${id}`;
    // EXC-559: a live UI tab already surfaces the review and runs the notifier;
    // foregrounding the browser would make the tab focused at the poll instant,
    // pre-empting the away-gated desktop notification. An older daemon reports no
    // such field, which fails safe to opening.
    if (!hasLiveClient) deps.openBrowser(url);
    // Unconditional: the announcement is the fallback for a browser that never
    // opened, and the handle a live tab's reader still wants.
    deps.announceUrl(url);

    step = "longPoll";
    // Re-poll on each heartbeat (null); on a transient drop reconnect and keep going
    // — the decision is served on reconnect, so nothing is lost. One absolute
    // deadline bounds the whole loop, each poll capped at the time remaining until
    // it, so neither a hung request nor an endless-heartbeat loop outlives it.
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
        // failing op, not the poll it was recovering from. It ATTACHES rather
        // than takes over: this client may be an old build whose review outlived
        // an upgrade, and a reconnect that installed its own daemon would undo
        // that upgrade on every dropped poll.
        step = "reconnect";
        baseUrl = await deps.ensureDaemon({ takeover: false });
        step = "longPoll";
      }
    }
    // The reviewer's verdict is normal operation: record it at info. Never the
    // feedback body (EXC-444; reviewer prose is user-generated content) — only its
    // length, so reject loops stay distinguishable from empty-feedback denies.
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
