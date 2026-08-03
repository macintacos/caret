// cmux terminal-pane integration. caret routes a plan to the browser, but the
// unread mark lives on the cmux pane the agent runs in; this module is the two
// ends of joining them — read the pane from the hook process's environment, and
// clear that one pane's unread mark. Opportunistic throughout: no config key, no
// CARET_* var, and silently inert when caret is not running under cmux.

import { type CaretLogger, noopLogger } from "@/lib/log.ts";
import type { CmuxPane } from "@/lib/types.ts";

/** The cmux pane the current process belongs to, or undefined outside cmux.
 * Both ids are required: `--workspace` without `--surface` would clear sibling
 * panes that have nothing to do with caret, so a half-set environment is read as
 * "not under cmux" rather than as a workspace-wide fallback. */
export function readCmuxPane(
  env: Record<string, string | undefined> = process.env,
): CmuxPane | undefined {
  const workspaceId = env.CMUX_WORKSPACE_ID;
  const surfaceId = env.CMUX_SURFACE_ID;
  if (!workspaceId || !surfaceId) return undefined;
  return { workspaceId, surfaceId };
}

export interface MarkPaneReadDeps {
  spawn?: typeof Bun.spawn;
  log?: CaretLogger;
}

/** Best-effort: clear the unread mark on one cmux pane. Fire-and-forget — the
 * spawn is detached and its output discarded, so it can never delay the caller
 * or destabilize it when cmux isn't on PATH. Never `--all`: that would clear
 * panes with nothing to do with caret. */
export function markPaneRead(pane: CmuxPane, deps: MarkPaneReadDeps = {}): void {
  const spawn = deps.spawn ?? Bun.spawn;
  const log = deps.log ?? noopLogger;
  try {
    spawn(
      [
        "cmux",
        "mark-notification-read",
        "--workspace",
        pane.workspaceId,
        "--surface",
        pane.surfaceId,
      ],
      { stdio: ["ignore", "ignore", "ignore"] },
    ).unref();
  } catch {
    // A recoverable oddity, not a failure: caret works fine with the mark left
    // standing. The pane ids are opaque and identifying, so they stay out of the
    // record.
    log.warn("cmux", "unread mark clear failed");
  }
}
