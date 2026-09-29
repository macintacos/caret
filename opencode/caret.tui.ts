// caret's OpenCode v2 TUI plugin: the review-link, decision, and update toasts. v2's server
// `Context` has no toast surface, so v2 loads this module from package.json
// `exports["./tui"]` as `{ id, setup }`. v1 keeps its own toasts in `server()`; the no-op
// `tui` exists because v1's installer may register this module as a v1 TUI plugin, and
// v1's TUI loader throws on a default without one.
//
// Not named `tui.ts` or `plugin*`: the `@opencode/*` tsconfig alias would shadow the real
// `@opencode/plugin/tui` and `@opencode/plugin` packages.

import {
  CARET_DECISION_KEY,
  CARET_URL_KEY,
  decisionToast,
  productionUpdateCheck,
  reviewLinkToast,
  showToast,
  type ToastBody,
  type ToastClient,
} from "./caret.plugin.ts";

type ToolEvent = { data: { id: string; metadata?: Record<string, unknown> } };

/** The slice of v2's TUI context caret uses — structural, so it depends on neither
 * `@opencode/plugin/tui`'s unresolved peer types nor the `@opencode/*` alias. */
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
    const linkShown = new Set<string>();
    const settle = (id: string, outcome: unknown) => {
      if (linkShown.delete(id)) showToast(client, decisionToast(outcome));
    };
    const unsubscribe = [
      ctx.data.on("session.tool.progress", ({ data }) => {
        const url = data.metadata?.[CARET_URL_KEY];
        if (typeof url !== "string") return;
        linkShown.add(data.id);
        showToast(client, reviewLinkToast(url));
      }),
      ctx.data.on("session.tool.success", ({ data }) =>
        settle(data.id, data.metadata?.[CARET_DECISION_KEY]),
      ),
      ctx.data.on("session.tool.failed", ({ data }) => settle(data.id, undefined)),
    ];
    return () => {
      for (const off of unsubscribe) off();
    };
  };
}

export default {
  id: "caret",
  setup: createCaretTui({ checkUpdate: productionUpdateCheck }),
  tui: async () => {},
};
