// `caret review`: review a plan piped on stdin (the ExitPlanMode hook). Parses
// the stdin with the active adapter, wires the production review dependencies —
// the daemon HTTP client, takeover, and the local browser opener — then runs one
// review to a single decision line on stdout. This is the emission boundary: the
// core returns a tool-agnostic Decision, and the selected adapter renders it to
// the agent's wire string here. The signal handlers below deny to fail safe if
// the process is killed before a decision is written.

import { selectAdapter } from "@/adapters/index.ts";
import { bootHookLogging } from "@/commands/boot.ts";
import { prodService } from "@/commands/service-target.ts";
import { logFile } from "@/config/paths.ts";
import { loadSettings, reviewTimeoutMs, type Settings } from "@/config/settings.ts";
import { expireReview, longPoll, postReview } from "@/daemon/client.ts";
import { ensureDaemon, prodEnsureDeps, SUPERVISOR_WINDOW_MS } from "@/daemon/lifecycle.ts";
import { readCmuxPane } from "@/lib/cmux.ts";
import { logError, logInfo, logWarn } from "@/lib/log.ts";
import type { Decision, PlanInput } from "@/lib/types.ts";
import { appendReviewerNotesToPlanFile, readPlanFile } from "@/plan/canonical-file.ts";
import {
  expireAbandoned,
  type ParsedHookInput,
  type PostedReview,
  parseHook,
  type ReviewDeps,
  runReview,
} from "@/review/orchestrate.ts";

/** Select the platform's URL-opening argv: darwin `open`, win32 `cmd /c start`,
 * anything else `xdg-open` (support per platform: doc/CONFIGURING.md § Platform support).
 * Pure so the branch selection is unit-testable without spawning. */
export function browserOpenCmd(platform: NodeJS.Platform | string, url: string): string[] {
  return platform === "darwin"
    ? ["open", url]
    : platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url];
}

/** The stderr line that surfaces the review URL. Pure so the wording is pinned by
 * a test rather than by convention: the review bridge (opencode/review-bridge.ts,
 * parseReviewUrl) regex-parses this exact shape to surface the review URL. */
export function reviewUrlLine(url: string): string {
  return `caret: review this plan at ${url}\n`;
}

/** Where an approval's reviewer notes go: the plan file, nowhere, or nowhere because the
 * daemon saw the agent rewrite the file after ingest (an older daemon's absent verdict
 * counts as current). */
export function notesAppendTarget(
  decision: Pick<Decision, "behavior" | "feedback">,
  planFilePath: string | undefined,
  posted: Pick<PostedReview, "planFileCurrent"> | undefined,
): { path: string; notes: string } | "skip-moved-on" | undefined {
  if (decision.behavior !== "allow" || !decision.feedback || !planFilePath) return undefined;
  if (posted?.planFileCurrent === false) return "skip-moved-on";
  return { path: planFilePath, notes: decision.feedback };
}

function openBrowser(url: string): void {
  try {
    Bun.spawn(browserOpenCmd(process.platform, url), {
      stdio: ["ignore", "ignore", "ignore"],
    }).unref();
  } catch {
    // Best-effort: the stderr URL is the fallback.
  }
}

/** A denied review costs the user more than a few seconds' wait, so the fallback spawn
 * gets a whole supervisor window of its own. */
const REVIEW_RESERVE_MS = SUPERVISOR_WINDOW_MS;

export function prodReviewDeps(settings: Settings): ReviewDeps {
  return {
    ensureDaemon: async (mode) =>
      ensureDaemon(
        await prodEnsureDeps(settings, () => prodService().manager, REVIEW_RESERVE_MS),
        mode,
      ),
    postReview,
    longPoll,
    openBrowser,
    announceUrl: (url) => {
      process.stderr.write(reviewUrlLine(url));
    },
    readPane: readCmuxPane,
    timeoutMs: reviewTimeoutMs(settings),
    expire: expireReview,
  };
}

/** Review the plan file's current text in preference to the payload's `plan`, which
 * Claude Code can fill before the agent's write to that file lands. Returns the
 * reviewed input so the approval echo carries the same text. A failed parse goes to
 * runReview unchanged, which fail-safe denies; `input` is then absent, since a deny
 * needs no echo. `readPlan` must never throw. */
export async function reviewHookInput(
  parsed: ParsedHookInput,
  deps: ReviewDeps,
  readPlan: (path: string) => string | undefined,
): Promise<{ decision: Decision; input?: PlanInput }> {
  if ("error" in parsed) return { decision: await runReview(parsed, deps) };
  const payload = parsed.input;
  const fromFile = payload.planFilePath ? readPlan(payload.planFilePath) : undefined;
  const input = fromFile?.trim() ? { ...payload, plan: fromFile } : payload;
  return { decision: await runReview({ input }, deps), input };
}

export async function runReviewSubcommand(): Promise<void> {
  // Wire [logging].level and .redact before anything can emit. One synchronous read —
  // the same snapshot feeds the review deps below, so the hook's logging config and
  // tunables can never come from two different reads of the file.
  const loaded = loadSettings();
  bootHookLogging(loaded);
  // Resolve the active adapter once (selected by CARET_AGENT, default claude); a
  // bogus selector throws here and propagates to the CLI's fatal handler, which
  // denies to fail safe. The same adapter parses the hook stdin and renders the
  // decision, so a review can't parse one tool's input and emit another's.
  const adapter = selectAdapter();
  // The reviewed hook input, captured once the review returns, so `respond` can hand
  // it to emitDecision — the Claude adapter echoes its tool_input back as updatedInput
  // on an allow, without which Claude Code >=2.1.199 drops the approve (EXC-683). The
  // signal path only ever denies, and a deny needs no echo, so whether the signal
  // beats the review never matters.
  let hookInput: PlanInput | undefined;
  // The review's daemon handle, captured via onPosted once the review is created,
  // so a signal-path abandon can expire it (EXC-482) and an approval can skip
  // notes for a plan file that moved on. Undefined until then.
  let posted: PostedReview | undefined;
  // Emit exactly one decision line. A signal arriving after the normal decision
  // was written must not append a second (deny) line. The adapter renders the
  // core Decision to the agent's wire string — the single emission boundary.
  let responded = false;
  const respond = (decision: Decision) => {
    if (responded) return;
    responded = true;
    process.stdout.write(`${adapter.emitDecision(decision, hookInput)}\n`);
  };
  const denyAndExit = async (reason: string) => {
    // Only log when this signal is what actually denies the review (a signal
    // arriving after a normal decision is already a no-op below).
    if (!responded) logError("signal", "hook-interrupted", new Error(reason));
    // Emit the deny first (stdout flushes before Claude reads it), then a
    // best-effort expire so caret's UI drops the abandoned pending review rather
    // than keeping a zombie (EXC-482).
    respond({ behavior: "deny", feedback: `${reason} See ${logFile()}.`, decidedAt: Date.now() });
    await expireAbandoned(expireReview, posted);
    process.exit(0);
  };
  process.once(
    "SIGINT",
    () => void denyAndExit("caret: interrupted (SIGINT) — denying to fail safe."),
  );
  process.once(
    "SIGTERM",
    () => void denyAndExit("caret: terminated (SIGTERM) — denying to fail safe."),
  );

  const stdin = await Bun.stdin.text();
  const deps = prodReviewDeps(loaded);
  deps.onPosted = (handle) => {
    posted = handle;
  };
  const { decision: out, input } = await reviewHookInput(
    parseHook(adapter.parseHookInput, stdin),
    deps,
    readPlanFile,
  );
  hookInput = input;
  // Fold an approval's reviewer notes onto the agent's plan of record (EXC-791)
  // before emitting the decision, so the agent reads them when it proceeds. Scoped to
  // reviews with a plan file (Claude, and an OpenCode `path` review); the Claude wire
  // echo carries the notes too, and OpenCode surfaces them via its tool result.
  // Best-effort and never fatal. A file the agent rewrote after ingest is left alone;
  // the daemon's verdict, not the hook, says so.
  const target = notesAppendTarget(out, hookInput?.planFilePath, posted);
  if (target === "skip-moved-on") {
    logInfo("review", "plan file changed; notes append skipped", {
      reviewId: posted?.id,
      sessionId: hookInput?.sessionId,
    });
  } else if (target) {
    appendReviewerNotesToPlanFile(target.path, target.notes, { warn: logWarn });
  }
  respond(out);
  process.exit(0);
}
