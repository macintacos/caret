// `caret review`: review a plan piped on stdin (the ExitPlanMode hook). Wires
// the production review dependencies — the active adapter's stdin parser, the
// daemon HTTP client, takeover, and the local browser opener — then runs one
// review to a single decision line on stdout. This is the emission boundary: the
// core returns a tool-agnostic Decision, and the selected adapter renders it to
// the agent's wire string here. The signal handlers below deny to fail safe if
// the process is killed before a decision is written.

import type { AgentAdapter } from "@/adapters/adapter.ts";
import { selectAdapter } from "@/adapters/index.ts";
import { bootHookLogging } from "@/commands/boot.ts";
import { logFile } from "@/config/paths.ts";
import { loadSettings, reviewTimeoutMs, type Settings } from "@/config/settings.ts";
import { expireReview, longPoll, postReview } from "@/daemon/client.ts";
import { ensureDaemon, prodEnsureDeps } from "@/daemon/lifecycle.ts";
import { readCmuxPane } from "@/lib/cmux.ts";
import { logError, logWarn } from "@/lib/log.ts";
import type { Decision, PlanInput } from "@/lib/types.ts";
import { appendReviewerNotesToPlanFile } from "@/plan/canonical-file.ts";
import { expireAbandoned, type ReviewDeps, runReview } from "@/review/orchestrate.ts";

/** Select the platform's URL-opening argv: darwin `open`, win32 `cmd /c start`,
 * anything else `xdg-open`. caret is macOS-first — the non-darwin branches ship
 * but are exercised primarily on macOS (see README support posture). Pure so the
 * branch selection is unit-testable without spawning. */
export function browserOpenCmd(platform: NodeJS.Platform | string, url: string): string[] {
  return platform === "darwin"
    ? ["open", url]
    : platform === "win32"
      ? ["cmd", "/c", "start", "", url]
      : ["xdg-open", url];
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

export function prodReviewDeps(s: Settings, adapter: AgentAdapter): ReviewDeps {
  return {
    parseHookInput: (stdin) => adapter.parseHookInput(stdin),
    ensureDaemon: async (opts) => ensureDaemon(await prodEnsureDeps(s), opts),
    postReview,
    longPoll,
    openBrowser,
    readPane: readCmuxPane,
    timeoutMs: reviewTimeoutMs(s),
    expire: expireReview,
  };
}

export async function runReviewSubcommand(): Promise<void> {
  // Wire [logging].level and .redact before anything can emit (the signal
  // handlers below and the review itself both log through the shared logger).
  // One synchronous read — the same snapshot feeds the review deps below, so
  // the hook's logging config and tunables can never come from two different
  // reads of the file.
  const loaded = loadSettings();
  bootHookLogging(loaded);
  // Resolve the active adapter once (selected by CARET_AGENT, default claude); a
  // bogus selector throws here and propagates to the CLI's fatal handler, which
  // denies to fail safe. The same adapter parses the hook stdin and renders the
  // decision, so a review can't parse one tool's input and emit another's.
  const adapter = selectAdapter();
  // The parsed hook input, captured once stdin is read, so `respond` can hand it to
  // emitDecision — the Claude adapter echoes its tool_input back as updatedInput on
  // an allow, without which Claude Code >=2.1.199 drops the approve (EXC-683). The
  // signal path only ever denies, and a deny needs no echo, so its value here
  // (undefined if the signal beats the parse, set if it doesn't) never matters.
  let hookInput: PlanInput | undefined;
  // The review's daemon handle, captured via onPosted once the review is created,
  // so a signal-path abandon can expire it (EXC-482). Undefined until then.
  let posted: { baseUrl: string; id: string } | undefined;
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
    if (!responded) logError("signal", new Error(reason));
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
  // Parse once for the updatedInput echo. runReview re-parses through its injected
  // dep, so a malformed payload is handled there (it fail-safe denies, which needs
  // no echo); the guard here just keeps a parse throw off the emit path.
  try {
    hookInput = adapter.parseHookInput(stdin);
  } catch {
    hookInput = undefined;
  }
  const deps = prodReviewDeps(loaded, adapter);
  // Capture the daemon handle so the signal handlers above can expire the review
  // on an abandon (EXC-482).
  deps.onPosted = (baseUrl, id) => {
    posted = { baseUrl, id };
  };
  const out = await runReview(stdin, deps);
  // Fold an approval's reviewer notes onto the agent's plan of record (EXC-791)
  // before emitting the decision, so the agent reads them when it proceeds. The
  // guard on planFilePath scopes this to agents with a plan file (Claude); the
  // Claude wire echo carries the notes too, and OpenCode surfaces them via its
  // tool result. Best-effort and never fatal.
  if (out.behavior === "allow" && out.feedback && hookInput?.planFilePath) {
    appendReviewerNotesToPlanFile(hookInput.planFilePath, out.feedback, { warn: logWarn });
  }
  respond(out);
  process.exit(0);
}
