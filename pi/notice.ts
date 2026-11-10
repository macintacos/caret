// The pending-plan notice above pi's editor, the `caret` footer status, and the `/caret`
// command and ctrl+alt+c shortcut that open the waiting review. Colours come only from
// pi's theme.

import { type Component, MouseRegion, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

import type { DetachedSpawn } from "../bridge/review-bridge.ts";
import { footerText, type ReviewStore, type SessionReview } from "./state.ts";

export const OPEN_KEY = "ctrl+alt+c";
const NEWS = "plan waiting for your review";
const VERB = "open in browser";
const RPC_LINE = `^ caret  ${NEWS}   /caret ${VERB}`;

/** The slice of pi's theme the notice reads; pinned by test/pi/sdk-conformance.ts. */
export type NoticeTheme = {
  fg(color: "warning" | "text" | "muted" | "dim", text: string): string;
  bold(text: string): string;
};

type WidgetFactory = (tui: unknown, theme: NoticeTheme) => Component;

/** The slice of pi's session context the notice calls; pinned by test/pi/sdk-conformance.ts. */
export type NoticeContext = {
  mode: "tui" | "rpc" | "json" | "print";
  hasUI: boolean;
  ui: {
    notify(message: string, type?: "info" | "warning" | "error"): void;
    setStatus(key: string, text: string | undefined): void;
    setWidget(key: string, content: string[] | WidgetFactory | undefined): void;
  };
  sessionManager: { getSessionId(): string };
};

/** The slice of pi's extension API the notice calls; pinned by test/pi/sdk-conformance.ts. */
export type NoticeApi = {
  on(event: "session_start", handler: (event: unknown, ctx: NoticeContext) => void): void;
  on(event: "session_shutdown", handler: () => void): void;
  registerCommand(
    name: string,
    options: { description: string; handler: (args: string, ctx: NoticeContext) => Promise<void> },
  ): void;
  registerShortcut(
    shortcut: string,
    options: { description: string; handler: (ctx: NoticeContext) => void },
  ): void;
};

/** The row at `width`, with a one-column inset each side as pi's own string widgets have. */
export function noticeLine(theme: NoticeTheme, width: number): string {
  const innerWidth = width - 2;
  const left = `${theme.fg("warning", "^")} ${theme.fg("muted", "caret")}  ${theme.bold(theme.fg("text", NEWS))}`;
  const right = `${theme.fg("dim", OPEN_KEY)} ${theme.fg("muted", VERB)}`;
  const gap = innerWidth - visibleWidth(`^ caret  ${NEWS}`) - visibleWidth(`${OPEN_KEY} ${VERB}`);
  if (gap >= 2) return ` ${left}${" ".repeat(gap)}${right} `;
  return ` ${truncateToWidth(left, Math.max(innerWidth, 0))}`;
}

/** The clickable row. pi runs a widget factory once, so `render()` must call the theme each
 * time: a cached string would keep the old theme's colours. */
export function noticeWidget(theme: NoticeTheme, open: () => void): Component {
  // No OSC 8 link on the row: a link under the cell takes the click before the row does.
  const row: Component = { render: (width) => [noticeLine(theme, width)], invalidate: () => {} };
  // Only `click` opens: pi synthesises it on a still release, and handling `press` would
  // steal the gesture from text selection.
  return new MouseRegion(row, (event) => {
    if (event.type !== "click" || event.button !== "left") return undefined;
    open();
    return { handled: true };
  });
}

/** Paints the footer status and the row for `state` in the session's UI mode. */
export function paint(ctx: NoticeContext, state: SessionReview, open: () => void): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus("caret", footerText(state));
  if (!state.pending) ctx.ui.setWidget("caret", undefined);
  else if (ctx.mode === "tui")
    ctx.ui.setWidget("caret", (_tui, theme) => noticeWidget(theme, open));
  else ctx.ui.setWidget("caret", [RPC_LINE]);
}

/** Paints the notice from the store for each session and registers `/caret` and the
 * shortcut. Call once per pi instance. */
export function installNotice(
  pi: NoticeApi,
  deps: { store: ReviewStore; bin: string; spawn: DetachedSpawn },
): void {
  const open = (ctx: NoticeContext) =>
    deps.spawn(
      deps.bin,
      ["band-link", "--session", ctx.sessionManager.getSessionId(), "--open"],
      (err) => {
        try {
          ctx.ui.notify(
            `caret: open failed: ${err.message}. Run caret doctor to see why.`,
            "error",
          );
        } catch {
          // The session was replaced before the child reported; there is no UI left to tell.
        }
      },
    );

  let unsubscribe: (() => void) | undefined;
  pi.on("session_start", (_event, ctx) => {
    const sessionId = ctx.sessionManager.getSessionId();
    const openHere = () => open(ctx);
    unsubscribe = deps.store.subscribe((id, state) => {
      if (id === sessionId) paint(ctx, state, openHere);
    });
    paint(ctx, deps.store.get(sessionId), openHere);
  });
  pi.on("session_shutdown", () => {
    unsubscribe?.();
    unsubscribe = undefined;
  });

  pi.registerCommand("caret", {
    description: "Open the waiting caret review in the browser",
    handler: async (_args, ctx) => open(ctx),
  });
  pi.registerShortcut(OPEN_KEY, {
    description: "Open the waiting caret review in the browser",
    handler: (ctx) => open(ctx),
  });
}
