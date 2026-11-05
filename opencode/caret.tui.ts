// caret's OpenCode v2 TUI plugin: the review-link, decision, and update toasts, and the
// `/caret` command that opens the session's waiting plan. v2's server `Context` has no
// toast surface, so v2 loads this module from package.json `exports["./tui"]` as
// `{ id, setup }`. v1 keeps its own toasts in `server()`; the no-op `tui` exists because
// v1's installer may register this module as a v1 TUI plugin, and v1's TUI loader throws
// on a default without one. `keymap` and `ui.router` stay optional, and the command
// registers only when `keymap.layer` is a function, so a context without them still gets
// caret's toasts.

import { spawn } from "node:child_process";

import {
  CARET_DECISION_KEY,
  CARET_URL_KEY,
  decisionToast,
  productionUpdateCheck,
  type ReviewOutcome,
  resolveCaretBin,
  reviewLinkToast,
  type ToastBody,
  type ToastSink,
  toastBestEffort,
} from "./caret.core.ts";

type ToolEvent = {
  data: { id: string; sessionID: string; metadata?: Record<string, unknown> };
};

/** v2's `ToastOptions` as caret uses it: the shared body plus the session it is about,
 * which OpenCode offers to open when that session's family is not open, titling an
 * untitled toast with the session's title. */
type TuiToast = ToastBody & { sessionID?: string };

/** The slice of v2's TUI context caret uses, narrow so tests build it without casts;
 * test/opencode/sdk-conformance.ts pins it to v2's real `Context`. */
export type TuiContext = {
  data: {
    on: (
      type: "session.tool.progress" | "session.tool.success" | "session.tool.failed",
      handler: (event: ToolEvent) => void,
    ) => () => void;
  };
  ui: { toast: { show: (options: TuiToast) => void }; router?: { current: () => Route } };
  keymap?: { layer: (factory: () => { mode: "global"; commands: CaretCommand[] }) => void };
};

/** v2's `Route` as caret reads it: only a session route carries `sessionID`. */
type Route = { type: string; sessionID?: string };

/** caret's one keymap command: the slice of v2's `KeymapCommand` it sets. */
type CaretCommand = {
  id: string;
  title: string;
  description: string;
  palette: true;
  slash: { name: string };
  bind: string;
  run: () => void;
};

/** Spawns `bin args` detached and unwaited; `onError` hears a child that fails to start
 * or exits non-zero. */
export type DetachedSpawn = (bin: string, args: string[], onError: (err: Error) => void) => void;

export const nodeDetachedSpawn: DetachedSpawn = (bin, args, onError) => {
  // spawn reports ENOENT asynchronously; unhandled, that 'error' takes OpenCode down.
  const child = spawn(bin, args, { stdio: "ignore", detached: true });
  child.on("error", onError);
  // band-link exits 0 on its own failures, so non-zero means caret never ran.
  child.on("exit", (code) => {
    if (code) onError(new Error(`exited with status ${code}`));
  });
  child.unref();
};

/** Build caret's v2 TUI `setup` over an injected update check, caret binary, and spawn. */
export function createCaretTui(opts: {
  checkUpdate: (show: ToastSink) => void;
  bin: string;
  spawn: DetachedSpawn;
}): (ctx: TuiContext) => () => void {
  return (ctx) => {
    const show: ToastSink = (body) => ctx.ui.toast.show(body);
    const openPlan = () => {
      const sessionID = ctx.ui.router?.current().sessionID;
      const args =
        sessionID === undefined
          ? ["band-link", "--open"]
          : ["band-link", "--session", sessionID, "--open"];
      opts.spawn(opts.bin, args, (err) =>
        toastBestEffort(show, {
          message: `caret: couldn't start caret (${err.message})`,
          variant: "error",
        }),
      );
    };
    if (typeof ctx.keymap?.layer === "function") {
      try {
        ctx.keymap.layer(() => ({
          // The palette and slash completion list only commands reachable from their own input mode.
          mode: "global",
          commands: [
            {
              id: "caret.open",
              title: "Open caret",
              description: "Open this session's waiting plan, or caret's home page",
              palette: true,
              slash: { name: "caret" },
              bind: "<leader>p",
              run: openPlan,
            },
          ],
        }));
      } catch {
        // best-effort: a host that rejects the command keeps caret's toasts
      }
    }
    const showIn =
      (sessionID: string): ToastSink =>
      (body) =>
        ctx.ui.toast.show({ ...body, sessionID });
    try {
      opts.checkUpdate(show);
    } catch {
      // best-effort
    }

    // Tool events carry the call id, not the tool name: only calls that showed a link count.
    const callsWithLink = new Set<string>();
    const settle = (id: string, sessionID: string, outcome: ReviewOutcome) => {
      if (callsWithLink.delete(id)) toastBestEffort(showIn(sessionID), decisionToast(outcome));
    };
    const unsubscribers = [
      ctx.data.on("session.tool.progress", ({ data }) => {
        const url = data.metadata?.[CARET_URL_KEY];
        if (typeof url !== "string") return;
        callsWithLink.add(data.id);
        toastBestEffort(showIn(data.sessionID), reviewLinkToast(url));
      }),
      ctx.data.on("session.tool.success", ({ data }) => {
        const decision = data.metadata?.[CARET_DECISION_KEY];
        settle(
          data.id,
          data.sessionID,
          decision === "allow" || decision === "deny" ? decision : "cancelled",
        );
      }),
      ctx.data.on("session.tool.failed", ({ data }) =>
        settle(data.id, data.sessionID, "cancelled"),
      ),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  };
}

const setup = createCaretTui({
  checkUpdate: productionUpdateCheck,
  bin: resolveCaretBin({ env: process.env, importMetaUrl: import.meta.url }),
  spawn: nodeDetachedSpawn,
});

export default {
  id: "caret",
  setup,
  tui: async () => {},
};
