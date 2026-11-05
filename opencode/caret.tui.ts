// caret's OpenCode v2 TUI plugin: the review-link, decision, and update toasts, the
// `/caret` command that opens the session's waiting plan, and the pending line above a
// waiting session's prompt. v2's server `Context` has no toast surface, so v2 loads this
// module from package.json `exports["./tui"]` as `{ id, setup }`. v1 keeps its own toasts
// in `server()`; the no-op `tui` exists because v1's installer may register this module as
// a v1 TUI plugin, and v1's TUI loader throws on a default without one. Because v1 can load
// this module, `@opentui/solid` is imported only dynamically, from `setup`, which v1 never
// calls. `keymap`, `ui.router`, `ui.slot`, and `storage` stay optional: a feature that
// needs one runs only when the host has it, so a context without them still gets caret's
// toasts.

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
  ui: {
    toast: { show: (options: TuiToast) => void };
    slot?: (claim: ComposerClaim) => () => void;
    router?: { current: () => Route };
  };
  keymap?: { layer: (factory: () => { mode: "global"; commands: CaretCommand[] }) => void };
  storage?: {
    memory: (
      key: string,
      options: { readonly initial: PendingBySession },
    ) => readonly [PendingBySession, (mutation: (draft: PendingBySession) => void) => void];
  };
};

type PendingReview = { callId: string; url: string };
type PendingBySession = Record<string, PendingReview>;

type ComposerClaim = {
  readonly prepend: "session.composer.top";
  // unknown fits the host's JSX.Element only while @opentui/solid is uninstalled (it is any
  // then); once installed, type this from the host's SlotClaim.
  readonly render: (input: { readonly sessionID: string }) => unknown;
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

/** The two `@opentui/solid` reconciler calls the pending line takes. */
type OpenTuiText = {
  createElement: (tag: "text") => unknown;
  insert: (parent: unknown, accessor: () => string) => unknown;
};

const PENDING_LINE = "plan waiting in caret";

const plainMemory = (): readonly [
  PendingBySession,
  (mutation: (draft: PendingBySession) => void) => void,
] => {
  const pending: PendingBySession = {};
  return [pending, (mutate) => mutate(pending)];
};

/** caret's v2 TUI setup over injected effects; its cleanup releases the slot claim (which
 * lands asynchronously) and every subscription. */
export function createCaretTui(opts: {
  checkUpdate: (show: ToastSink) => void;
  bin: string;
  spawn: DetachedSpawn;
  loadOpenTui: () => Promise<OpenTuiText>;
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

    // Tool events carry the call id, not the tool name: a session's entry names the one call
    // whose link it showed, and a later link in that session replaces it.
    const storage = ctx.storage;
    const hasReactiveStore = typeof storage?.memory === "function";
    const [pending, setPending] =
      typeof storage?.memory === "function"
        ? storage.memory("caret.pending", { initial: {} })
        : plainMemory();
    const settle = (id: string, sessionID: string, outcome: ReviewOutcome) => {
      if (pending[sessionID]?.callId !== id) return;
      setPending((draft) => {
        delete draft[sessionID];
      });
      toastBestEffort(showIn(sessionID), decisionToast(outcome));
    };
    const unsubscribers = [
      ctx.data.on("session.tool.progress", ({ data }) => {
        const url = data.metadata?.[CARET_URL_KEY];
        if (typeof url !== "string") return;
        setPending((draft) => {
          draft[data.sessionID] = { callId: data.id, url };
        });
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

    let releaseSlot: (() => void) | undefined;
    let disposed = false;
    // Without the host's reactive store the line could never update.
    if (typeof ctx.ui.slot === "function" && hasReactiveStore) {
      opts
        .loadOpenTui()
        .then((openTui) => {
          if (disposed) return;
          releaseSlot = ctx.ui.slot?.({
            prepend: "session.composer.top",
            render: (input) => {
              const line = openTui.createElement("text");
              // input is reactive: read sessionID inside the accessor, never destructure it.
              openTui.insert(line, () => (pending[input.sessionID] ? PENDING_LINE : ""));
              return line;
            },
          });
        })
        // best-effort: a host whose runtime can't resolve @opentui/solid shows no line
        .catch(() => {});
    }
    return () => {
      disposed = true;
      releaseSlot?.();
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  };
}

// The v2 host's runtime hands TUI plugins its own @opentui/solid; nothing installs it, and
// `as string` keeps tsc from resolving it.
const loadOpenTui = (): Promise<OpenTuiText> => import("@opentui/solid" as string);
const setup = createCaretTui({
  checkUpdate: productionUpdateCheck,
  bin: resolveCaretBin({ env: process.env, importMetaUrl: import.meta.url }),
  spawn: nodeDetachedSpawn,
  loadOpenTui,
});

export default {
  id: "caret",
  setup,
  tui: async () => {},
};
