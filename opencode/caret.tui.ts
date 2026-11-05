// caret's OpenCode v2 TUI plugin: the review-link, decision, and update toasts. v2's server
// `Context` has no toast surface, so v2 loads this module from package.json
// `exports["./tui"]` as `{ id, setup }`. v1 keeps its own toasts in `server()`; the no-op
// `tui` exists because v1's installer may register this module as a v1 TUI plugin, and
// v1's TUI loader throws on a default without one.

import {
  CARET_DECISION_KEY,
  CARET_URL_KEY,
  decisionToast,
  productionUpdateCheck,
  type ReviewOutcome,
  reviewLinkToast,
  type ToastBody,
  type ToastSink,
  toastBestEffort,
} from "./caret.core.ts";

type ToolEvent = {
  data: { id: string; sessionID: string; metadata?: Record<string, unknown> };
};

/** v2's `ToastOptions` as caret uses it: the shared body plus the session it is about,
 * which OpenCode offers to open when that session's family is not open. */
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
  ui: { toast: { show: (options: TuiToast) => void } };
};

/** Build caret's v2 TUI `setup` over an injected update check. */
export function createCaretTui(opts: {
  checkUpdate: (show: ToastSink) => void;
}): (ctx: TuiContext) => () => void {
  return (ctx) => {
    const show: ToastSink = (body) => ctx.ui.toast.show(body);
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

const setup = createCaretTui({ checkUpdate: productionUpdateCheck });

export default {
  id: "caret",
  setup,
  tui: async () => {},
};
