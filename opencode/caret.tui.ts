// caret's OpenCode v2 TUI plugin: the review-link, decision, and update toasts. v2's server
// `Context` has no toast surface, so v2 loads this module from package.json
// `exports["./tui"]` as `{ id, setup }`. v1 keeps its own toasts in `server()`; the no-op
// `tui` exists because v1's installer may register this module as a v1 TUI plugin, and
// v1's TUI loader throws on a default without one.
//
// Not named `tui.ts` or `plugin*`: through the `@opencode/*` tsconfig alias, `@opencode/tui`
// or `@opencode/plugin[/…]` would resolve here instead of to the real packages.

import type { Plugin } from "@opencode/plugin/tui";

import {
  CARET_DECISION_KEY,
  CARET_URL_KEY,
  decisionToast,
  productionUpdateCheck,
  type ReviewOutcome,
  reviewLinkToast,
  showToast,
  type ToastBody,
  type ToastClient,
} from "./caret.plugin.ts";

type ToolEvent = { data: { id: string; metadata?: Record<string, unknown> } };

/** The slice of v2's TUI context caret uses, narrow so tests build it without casts; the
 * `Plugin.Definition["setup"]` annotation below pins it to v2's real `Context`. */
export type TuiContext = {
  data: {
    on: (
      type: "session.tool.progress" | "session.tool.success" | "session.tool.failed",
      handler: (event: ToolEvent) => void,
    ) => () => void;
  };
  ui: { toast: { show: (options: ToastBody) => void } };
};

/** Build caret's v2 TUI `setup` over an injected update check. */
export function createCaretTui(opts: {
  checkUpdate: (client: ToastClient) => void;
}): (ctx: TuiContext) => () => void {
  return (ctx) => {
    const client: ToastClient = { tui: { showToast: ({ body }) => ctx.ui.toast.show(body) } };
    try {
      opts.checkUpdate(client);
    } catch {
      // best-effort
    }

    // Tool events carry the call id, not the tool name: only calls that showed a link count.
    const callsWithLink = new Set<string>();
    const settle = (id: string, outcome: ReviewOutcome) => {
      if (callsWithLink.delete(id)) showToast(client, decisionToast(outcome));
    };
    const unsubscribers = [
      ctx.data.on("session.tool.progress", ({ data }) => {
        const url = data.metadata?.[CARET_URL_KEY];
        if (typeof url !== "string") return;
        callsWithLink.add(data.id);
        showToast(client, reviewLinkToast(url));
      }),
      ctx.data.on("session.tool.success", ({ data }) => {
        const decision = data.metadata?.[CARET_DECISION_KEY];
        settle(data.id, decision === "allow" || decision === "deny" ? decision : "cancelled");
      }),
      ctx.data.on("session.tool.failed", ({ data }) => settle(data.id, "cancelled")),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  };
}

const setup: Plugin.Definition["setup"] = createCaretTui({ checkUpdate: productionUpdateCheck });

export default {
  id: "caret",
  setup,
  tui: async () => {},
};
