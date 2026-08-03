// cmux terminal-pane integration. caret routes a plan to the browser, but the
// unread mark lives on the cmux pane the agent runs in; this module is the two
// ends of joining them — read the pane from the hook process's environment, and
// clear that one pane's unread mark. Opportunistic throughout: no config key, no
// CARET_* var, and silently inert when caret is not running under cmux.

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
