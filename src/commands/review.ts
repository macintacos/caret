// `caret review`: review a plan piped on stdin (the ExitPlanMode hook). Wires
// the production review dependencies — the active adapter's stdin parser, the
// daemon HTTP client, takeover, and the local browser opener — then runs one
// review to a single decision line on stdout. This is the emission boundary: the
// core returns a tool-agnostic Decision, and the selected adapter renders it to
// the agent's wire string here. The signal handlers below deny to fail safe if
// the process is killed before a decision is written.

import type { AgentAdapter } from "../adapters/adapter.ts";
import { selectAdapter } from "../adapters/index.ts";
import { expireReview, longPoll, postReview } from "../daemon-client.ts";
import { ensureDaemon, prodEnsureDeps } from "../daemon-lifecycle.ts";
import { logError, logWarn, setLogLevel, setRedact } from "../log.ts";
import { logFile } from "../paths.ts";
import { type ReviewDeps, runReview } from "../review.ts";
import { loadSettings, reviewTimeoutMs, type Settings } from "../settings.ts";
import type { Decision } from "../types.ts";
import { warnInvalidEnvVars } from "./boot.ts";

function openBrowser(url: string): void {
  try {
    const cmd =
      process.platform === "darwin"
        ? ["open", url]
        : process.platform === "win32"
          ? ["cmd", "/c", "start", "", url]
          : ["xdg-open", url];
    Bun.spawn(cmd, { stdio: ["ignore", "ignore", "ignore"] }).unref();
  } catch {
    // Best-effort: the stderr URL is the fallback.
  }
}

export function prodReviewDeps(s: Settings, adapter: AgentAdapter): ReviewDeps {
  return {
    parseHookInput: (stdin) => adapter.parseHookInput(stdin),
    ensureDaemon: async () => ensureDaemon(await prodEnsureDeps(s)),
    postReview,
    longPoll,
    openBrowser,
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
  setLogLevel(loaded.logging.level);
  setRedact(loaded.logging.redact);
  // Same boot-time surfacing as the daemon's — a typo'd CARET_* var otherwise
  // silently falls through to the config file, then the default.
  warnInvalidEnvVars((msg) => logWarn("env", msg));
  // Resolve the active adapter once (selected by CARET_AGENT, default claude); a
  // bogus selector throws here and propagates to the CLI's fatal handler, which
  // denies to fail safe. The same adapter parses the hook stdin and renders the
  // decision, so a review can't parse one tool's input and emit another's.
  const adapter = selectAdapter();
  // Emit exactly one decision line. A signal arriving after the normal decision
  // was written must not append a second (deny) line. The adapter renders the
  // core Decision to the agent's wire string — the single emission boundary.
  let responded = false;
  const respond = (decision: Decision) => {
    if (responded) return;
    responded = true;
    process.stdout.write(`${adapter.emitDecision(decision)}\n`);
  };
  const denyAndExit = (reason: string) => {
    // Only log when this signal is what actually denies the review (a signal
    // arriving after a normal decision is already a no-op below).
    if (!responded) logError("signal", new Error(reason));
    respond({ behavior: "deny", feedback: `${reason} See ${logFile()}.`, decidedAt: Date.now() });
    process.exit(0);
  };
  process.once("SIGINT", () => denyAndExit("caret: interrupted (SIGINT) — denying to fail safe."));
  process.once("SIGTERM", () => denyAndExit("caret: terminated (SIGTERM) — denying to fail safe."));

  const stdin = await Bun.stdin.text();
  const out = await runReview(stdin, prodReviewDeps(loaded, adapter));
  respond(out);
  process.exit(0);
}
