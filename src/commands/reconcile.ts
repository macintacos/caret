// `caret reconcile`: the ExitPlanMode PostToolUse hook. When a plan is approved,
// this fires and reconciles a terminal approval (one made in the agent interface,
// not caret's UI) into the daemon — see src/review/reconcile.ts. Wires the production
// deps: the active adapter's stdin parser and the daemon HTTP client, pointed at
// the already-running daemon's loopback port (it never spawns one).
//
// Unlike `caret review`, this hook GATES NOTHING — the plan is already approved.
// So its failure mode is a SILENT NO-OP, never a fail-safe deny: it writes no
// stdout, and any error (bad adapter selector, unreadable stdin) is swallowed so
// a stray decision line can't reach Claude's PostToolUse channel.

import type { AgentAdapter } from "@/adapters/adapter.ts";
import { selectAdapter } from "@/adapters/index.ts";
import { warnInvalidEnvVars } from "@/commands/boot.ts";
import { getPort, loadSettings, logKeep, logMaxSize } from "@/config/settings.ts";
import { listReviews, resolveReview } from "@/daemon/client.ts";
import { logDebug, logWarn, setLogLevel, setLogRotation, setRedact } from "@/lib/log.ts";
import { type ReconcileDeps, runReconcile } from "@/review/reconcile.ts";

export function prodReconcileDeps(baseUrl: string, adapter: AgentAdapter): ReconcileDeps {
  return {
    parseHookInput: (stdin) => adapter.parseHookInput(stdin),
    listReviews: () => listReviews(baseUrl),
    // A terminal approve chose no caret approve variant, so resolve as a bare
    // allow — the daemon records it and drops the review from the pending set.
    resolveReview: (id) => resolveReview(baseUrl, id, { behavior: "allow" }),
  };
}

export async function runReconcileSubcommand(): Promise<void> {
  try {
    const loaded = loadSettings();
    setLogLevel(loaded.logging.level);
    setRedact(loaded.logging.redact);
    setLogRotation(logMaxSize(loaded), logKeep(loaded));
    warnInvalidEnvVars((msg) => logWarn("env", msg));
    const adapter = selectAdapter();
    const baseUrl = `http://localhost:${getPort(loaded)}`;
    const stdin = await Bun.stdin.text();
    await runReconcile(stdin, prodReconcileDeps(baseUrl, adapter));
  } catch (err) {
    // Never let this hook throw to the CLI's fail-safe (which would emit a deny
    // line): it gates nothing, so a failure is a silent no-op.
    logDebug("reconcile", "reconcile subcommand skipped", { err: String(err) });
  }
  process.exit(0);
}
