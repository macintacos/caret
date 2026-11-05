// Unit coverage for caret's OpenCode v2 TUI module: the review-link, decision, and update
// toasts, driven through a fake `{ data.on, ui.toast.show }` context.

import { expect, test } from "bun:test";

import {
  decisionToast,
  type ReviewOutcome,
  reviewLinkToast,
  type ToastBody,
  type ToastSink,
} from "@oc/caret.core.ts";
import { createCaretTui, type TuiContext } from "@oc/caret.tui.ts";

type Handler = Parameters<TuiContext["data"]["on"]>[1];
type Toast = Parameters<TuiContext["ui"]["toast"]["show"]>[0];

function fakeTui(show: ToastSink = () => {}) {
  const handlers = new Map<string, Handler>();
  const shown: Toast[] = [];
  let unsubscribed = 0;
  const ctx: TuiContext = {
    data: {
      on: (type, handler) => {
        handlers.set(type, handler);
        return () => {
          unsubscribed++;
        };
      },
    },
    ui: {
      toast: {
        show: (body) => {
          shown.push(body);
          return show(body);
        },
      },
    },
  };
  const emit = (type: string, id: string, metadata?: Record<string, unknown>) =>
    handlers.get(type)?.({
      data: { id, sessionID: `ses_${id}`, ...(metadata ? { metadata } : {}) },
    });
  return { ctx, shown, emit, unsubscribed: () => unsubscribed };
}

function start(checkUpdate: (show: ToastSink) => void = () => {}) {
  const fake = fakeTui();
  const cleanup = createCaretTui({ checkUpdate })(fake.ctx);
  return { ...fake, cleanup };
}

const URL = "http://127.0.0.1:4242/r/1";

test("a progress event carrying the review URL shows the review-link toast", () => {
  const { shown, emit } = start();
  emit("session.tool.progress", "C", { caretUrl: URL });
  expect(shown).toEqual([
    {
      title: "caret: review this plan",
      message: URL,
      variant: "info",
      duration: 600_000,
      sessionID: "ses_C",
    },
  ]);
});

test("events for calls that never showed a link show nothing", () => {
  const { shown, emit } = start();
  emit("session.tool.progress", "C", { other: 1 });
  emit("session.tool.progress", "D");
  emit("session.tool.success", "E", { caretDecision: "allow" });
  emit("session.tool.failed", "F");
  expect(shown).toEqual([]);
});

test("a success after the link shows the decision toast", () => {
  const cases: Array<[unknown, Pick<ToastBody, "message" | "variant">]> = [
    ["allow", { message: "caret: plan approved", variant: "success" }],
    ["deny", { message: "caret: changes requested", variant: "info" }],
    [undefined, { message: "caret: review cancelled", variant: "info" }],
    ["bogus", { message: "caret: review cancelled", variant: "info" }],
  ];
  for (const [decision, expected] of cases) {
    const { shown, emit } = start();
    emit("session.tool.progress", "C", { caretUrl: URL });
    emit("session.tool.success", "C", decision ? { caretDecision: decision } : {});
    expect(shown[1]).toEqual({ ...expected, duration: 4_000, sessionID: "ses_C" });
  }
});

test("a failed call after the link shows cancelled, and a call's decision toasts once", () => {
  const { shown, emit } = start();
  emit("session.tool.progress", "C", { caretUrl: URL });
  emit("session.tool.failed", "C");
  emit("session.tool.success", "C", { caretDecision: "allow" });
  expect(shown.map((b) => b.message)).toEqual([URL, "caret: review cancelled"]);
  expect(shown.map((b) => b.sessionID)).toEqual(["ses_C", "ses_C"]);
});

test("each call's toasts go to that call's own session", () => {
  const { shown, emit } = start();
  emit("session.tool.progress", "C", { caretUrl: URL });
  emit("session.tool.progress", "D", { caretUrl: URL });
  emit("session.tool.success", "C", { caretDecision: "allow" });
  emit("session.tool.failed", "D");
  expect(shown.map((b) => b.sessionID)).toEqual(["ses_C", "ses_D", "ses_C", "ses_D"]);
});

test("the core toast bodies carry no sessionID (v1 forwards them as-is)", () => {
  const outcomes: ReviewOutcome[] = ["allow", "deny", "cancelled"];
  for (const body of [reviewLinkToast(URL), ...outcomes.map(decisionToast)]) {
    expect(body).not.toHaveProperty("sessionID");
  }
});

test("a throwing toast surface does not escape a handler", () => {
  const fake = fakeTui(() => {
    throw new Error("no tui");
  });
  createCaretTui({ checkUpdate: () => {} })(fake.ctx);
  expect(() => fake.emit("session.tool.progress", "C", { caretUrl: URL })).not.toThrow();
});

test("a rejecting toast surface leaves no unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    const fake = fakeTui(() => Promise.reject(new Error("x")));
    createCaretTui({ checkUpdate: () => {} })(fake.ctx);
    fake.emit("session.tool.progress", "C", { caretUrl: URL });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", record);
  }
});

test("a throwing update check does not escape setup", () => {
  const fake = fakeTui();
  expect(() =>
    createCaretTui({
      checkUpdate: () => {
        throw new Error("boom");
      },
    })(fake.ctx),
  ).not.toThrow();
});

test("the update check runs once on a sink that toasts through the TUI", () => {
  const sinks: ToastSink[] = [];
  const { shown } = start((show) => sinks.push(show));
  expect(sinks).toHaveLength(1);
  const body: ToastBody = { message: "caret 9.9.9 is available", variant: "info" };
  sinks[0]?.(body);
  expect(shown).toEqual([body]);
});

test("the cleanup unsubscribes every handler", () => {
  const { cleanup, unsubscribed } = start();
  cleanup();
  expect(unsubscribed()).toBe(3);
});
