// Review orchestration core: run one plan review end-to-end and return the
// tool-agnostic `Decision`. Tool-agnostic throughout — the command layer parses
// the agent's stdin with the adapter's `parseHookInput` via `parseHook`, and renders
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
import type { EnsureMode } from "@/daemon/lifecycle.ts";
import { type ErrorContext, logDebug, logError, logInfo, shortId } from "@/lib/log.ts";
import {
  type CmuxPane,
  type CreatedReview,
  type Decision,
  errorMessage,
  type PlanInput,
  type PollResult,
} from "@/lib/types.ts";
import {
  hasUntaggedCodeBlock,
  PLAN_EMPTY_DENY_MESSAGE,
  PLAN_FORMAT_DENY_MESSAGE,
} from "@/plan/format.ts";

/** A fail-safe deny the core constructs when an unreviewed plan must never ship.
 * The reason rides in `feedback`; the adapter renders it to the tool's deny wire
 * shape at the emission boundary. */
function denyDecision(reason: string): Decision {
  return { behavior: "deny", feedback: reason, decidedAt: Date.now() };
}

/** The hook stdin as the caller parsed it: its PlanInput, or what the parse threw. */
export type ParsedHookInput = { input: PlanInput } | { error: unknown };

/** Run `parse` over `stdin`, keeping a throw for runReview to fail-safe deny. Never
 * throws. */
export function parseHook(parse: (stdin: string) => PlanInput, stdin: string): ParsedHookInput {
  try {
    return { input: parse(stdin) };
  } catch (error) {
    return { error };
  }
}

/** The created review's daemon handle, plus the daemon's at-ingest verdict on the
 * agent's plan file (see RouteResult.planFileCurrent). */
export type PostedReview = Omit<CreatedReview, "hasLiveClient"> & { baseUrl: string };

export interface ReviewDeps {
  /** Ensure a daemon is up and return its base URL, resolving the port as `mode` says
   * (see EnsureMode). */
  ensureDaemon: (mode: EnsureMode) => Promise<string>;
  /** Create the review, or null when the daemon refused it while stepping down.
   * On `hasLiveClient` the hook skips opening the browser so an open backgrounded
   * tab's away-gated notification isn't pre-empted. */
  postReview: (baseUrl: string, input: PlanInput) => Promise<CreatedReview | null>;
  /** One bounded poll for `version`: a Decision, null on a heartbeat (re-poll), or
   * "superseded" once a newer version owns the review. Throws on a transient drop
   * so the caller can reconnect. */
  longPoll: (baseUrl: string, id: string, version: number | undefined) => Promise<PollResult>;
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
  expire: (baseUrl: string, id: string, version: number | undefined) => Promise<void>;
  /** Called once the review is created, with its handle. Lets the command layer
   * capture it so a SIGINT/SIGTERM abandon can expire the review (EXC-482) — the
   * signal fires outside runReview's control flow, so it needs the id runReview
   * computed — and so an approval skips appending notes to a plan file that moved
   * on. Optional: absent for the dev driver and tests that don't wire either. */
  onPosted?: (posted: PostedReview) => void;
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
 * expire), and it swallows any failure — the next plan in the session appends to
 * or supersedes the review if the expire never lands (EXC-454). Never throws. */
export async function expireAbandoned(
  expire: ReviewDeps["expire"],
  handle: Pick<PostedReview, "baseUrl" | "id" | "version"> | undefined,
): Promise<void> {
  if (!handle) return;
  try {
    await expire(handle.baseUrl, handle.id, handle.version);
  } catch {
    // best-effort — the next plan reclaims the review.
  }
}

/** Run a review end-to-end, returning the core `Decision`. Never throws — any
 * failure becomes a deny so an unreviewed plan can never ship. The command layer
 * renders the returned Decision to the agent's wire string via the adapter. */
export async function runReview(parsed: ParsedHookInput, deps: ReviewDeps): Promise<Decision> {
  // Track the current step + context so the catch can log what actually failed.
  let step = "parse";
  const ctx: ErrorContext = {};
  // Hoisted so the catch can reach the daemon for the best-effort expire;
  // reconnects re-assign baseUrl, so it always holds the last-known daemon URL.
  // version is set once, on create.
  let baseUrl: string | undefined;
  let version: number | undefined;
  try {
    if ("error" in parsed) throw parsed.error;
    const input = parsed.input;
    ctx.sessionId = input.sessionId;
    // cwd is logged raw (diagnostic: which project this review came from); the
    // redact path home-scrubs it on share, so it is not a DENY_KEY (EXC-545).
    ctx.cwd = input.cwd;
    // The review's start-of-timeline anchor: even a format-deny or a crashed
    // run leaves a record of the request and its session.
    logInfo("review", "review requested", { ...ctx });

    // Reject a blank plan or unhighlightable (untagged) code blocks before any
    // daemon work, so neither reject spins up a daemon or creates a review. An
    // EXPECTED outcome, so it logs at info (default-on) and carries its own message
    // rather than the fail-safe deny's.
    step = "validatePlan";
    if (!input.plan?.trim()) {
      logInfo(step, "plan rejected: plan is empty", ctx);
      return denyDecision(PLAN_EMPTY_DENY_MESSAGE);
    }
    if (hasUntaggedCodeBlock(input.plan)) {
      logInfo(step, "plan rejected: code block missing language marker", ctx);
      return denyDecision(PLAN_FORMAT_DENY_MESSAGE);
    }

    step = "ensureDaemon";
    baseUrl = await deps.ensureDaemon("takeover");
    step = "postReview";
    // Stamp the originating cmux pane, if any: the daemon is long-lived and shared,
    // so it never inherits this hook's cmux environment (EXC-961).
    const payload = { ...input, cmux: deps.readPane?.() };
    let created = await deps.postReview(baseUrl, payload);
    if (!created) {
      // Refused by a daemon stepping down: post once more to its successor.
      logInfo("review", "review refused: daemon draining", { ...ctx });
      step = "reconnect";
      baseUrl = await deps.ensureDaemon("successor");
      step = "postReview";
      created = await deps.postReview(baseUrl, payload);
      if (!created) throw new Error("daemon draining; review not created");
    }
    const { id, hasLiveClient, planFileCurrent } = created;
    version = created.version;
    // From here every record — decision and error alike — carries the reviewId,
    // stitching this stream against the daemon's review/resolve records.
    ctx.reviewId = id;
    // Surface the handle so a SIGINT/SIGTERM abandon can expire this review, from
    // outside this flow (EXC-482), and so an approval can skip notes for a plan
    // file that moved on.
    deps.onPosted?.({ baseUrl, id, version, planFileCurrent });
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
        const polled = await withTimeout(
          deps.longPoll(baseUrl, id, version),
          remaining,
          "review timed out",
        );
        if (polled === "superseded") {
          // A newer version (a terminal-side deny, then a resubmit) owns this review
          // and its hook; nothing here is ours to expire. The agent has moved on and
          // ignores this deny.
          logInfo("review", `review yielded to newer version: ${shortId(id)}`, {
            ...ctx,
            version,
          });
          return denyDecision("caret: superseded by a newer revision of this plan.");
        }
        decision = polled ?? undefined;
      } catch (err) {
        if (err instanceof TimeoutError) throw err;
        // Reconnect — label this step so a failed reconnect logs the real
        // failing op, not the poll it was recovering from. It ATTACHES rather
        // than takes over: this client may be an old build whose review outlived
        // an upgrade, and a reconnect that installed its own daemon would undo
        // that upgrade on every dropped poll.
        step = "reconnect";
        baseUrl = await deps.ensureDaemon("attach");
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
    // best-effort expire so the daemon doesn't hold a pending orphan. The next
    // plan in the session appends to or supersedes it if this never lands (EXC-454).
    if (ctx.reviewId && baseUrl) {
      try {
        await deps.expire(baseUrl, ctx.reviewId, version);
        logDebug("review", `review expire requested: ${shortId(ctx.reviewId)}`, { ...ctx });
      } catch {
        logDebug("review", "review expire failed; next plan reclaims it", { ...ctx });
      }
    }
    const msg = errorMessage(err);
    return denyDecision(`caret: ${msg} — denying so no unreviewed plan ships. See ${logFile()}.`);
  }
}
