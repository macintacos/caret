// `caret review`: review a plan piped on stdin (the ExitPlanMode hook). Wires
// the production review dependencies — the Claude adapter's stdin parser, the
// daemon HTTP client, takeover, and the local browser opener — then runs one
// review to a single decision line on stdout. The signal handlers below deny to
// fail safe if the process is killed before a decision is written.

import { denyOutput } from "../adapters/claude/feedback.ts";
import { claudeAdapter } from "../adapters/claude/index.ts";
import { expireReview, longPoll, postReview } from "../daemon-client.ts";
import { ensureDaemon, prodEnsureDeps } from "../daemon-lifecycle.ts";
import { logError, logWarn, setLogLevel, setRedact } from "../log.ts";
import { logFile } from "../paths.ts";
import { type ReviewDeps, runReview } from "../review.ts";
import { loadSettings, reviewTimeoutMs, type Settings } from "../settings.ts";
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

export function prodReviewDeps(s: Settings): ReviewDeps {
  return {
    parseHookInput: (stdin) => claudeAdapter.parseHookInput(stdin),
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
  // Emit exactly one decision line. A signal arriving after the normal decision
  // was written must not append a second (deny) line.
  let responded = false;
  const respond = (output: unknown) => {
    if (responded) return;
    responded = true;
    process.stdout.write(`${JSON.stringify(output)}\n`);
  };
  const denyAndExit = (reason: string) => {
    // Only log when this signal is what actually denies the review (a signal
    // arriving after a normal decision is already a no-op below).
    if (!responded) logError("signal", new Error(reason));
    respond(denyOutput(`${reason} See ${logFile()}.`));
    process.exit(0);
  };
  process.once("SIGINT", () => denyAndExit("caret: interrupted (SIGINT) — denying to fail safe."));
  process.once("SIGTERM", () => denyAndExit("caret: terminated (SIGTERM) — denying to fail safe."));

  const stdin = await Bun.stdin.text();
  const out = await runReview(stdin, prodReviewDeps(loaded));
  respond(out);
  process.exit(0);
}
