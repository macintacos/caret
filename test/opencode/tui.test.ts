// Unit coverage for caret's OpenCode v2 TUI module: the review-link, decision, and update
// toasts, the `caret.open` command, and the pending-plan line, driven through a fake v2
// TUI context (`fakeTui`).

import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  decisionToast,
  type ReviewOutcome,
  reviewLinkToast,
  type ToastBody,
  type ToastSink,
} from "@oc/caret.core.ts";
import {
  createCaretTui,
  type DetachedSpawn,
  nodeDetachedSpawn,
  type TuiContext,
} from "@oc/caret.tui.ts";
import { until } from "@test/support/poll.ts";

type Handler = Parameters<TuiContext["data"]["on"]>[1];
type Toast = Parameters<TuiContext["ui"]["toast"]["show"]>[0];

type Route = ReturnType<NonNullable<TuiContext["ui"]["router"]>["current"]>;
type Layer = ReturnType<Parameters<NonNullable<TuiContext["keymap"]>["layer"]>[0]>;
type Keymap = NonNullable<TuiContext["keymap"]>;

type Claim = Parameters<NonNullable<TuiContext["ui"]["slot"]>>[0];
type Memory = ReturnType<NonNullable<TuiContext["storage"]>["memory"]>[0];
type FakeLine = { text: () => string };

const fakeOpenTui = {
  createElement: (): FakeLine => ({ text: () => "" }),
  insert: (line: unknown, accessor: () => string) => {
    (line as FakeLine).text = accessor;
  },
};

const lineFor = (claim: Claim, sessionID: string) =>
  (claim.render({ sessionID }) as FakeLine).text();

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeTui(
  show: ToastSink = () => {},
  {
    route,
    keymap,
    slot = true,
    storage = true,
  }: { route?: Route; keymap?: Keymap | "record"; slot?: boolean; storage?: boolean } = {
    keymap: "record",
  },
) {
  const handlers = new Map<string, Handler>();
  const shown: Toast[] = [];
  const layers: Layer[] = [];
  const claims: Claim[] = [];
  const stores = new Map<string, Memory>();
  let unsubscribed = 0;
  let released = 0;
  const ctx: TuiContext = {
    ...(keymap === "record"
      ? { keymap: { layer: (factory) => void layers.push(factory()) } }
      : keymap
        ? { keymap }
        : {}),
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
      ...(route ? { router: { current: () => route } } : {}),
      ...(slot
        ? {
            slot: (claim: Claim) => {
              claims.push(claim);
              return () => {
                released++;
              };
            },
          }
        : {}),
    },
    ...(storage
      ? {
          storage: {
            memory: (key, { initial }) => {
              stores.set(key, initial);
              return [initial, (mutate) => mutate(initial)] as const;
            },
          },
        }
      : {}),
  };
  const emit = (
    type: string,
    id: string,
    metadata?: Record<string, unknown>,
    sessionID = `ses_${id}`,
  ) =>
    handlers.get(type)?.({
      data: { id, sessionID, ...(metadata ? { metadata } : {}) },
    });
  return {
    ctx,
    shown,
    layers,
    emit,
    claims,
    stores,
    unsubscribed: () => unsubscribed,
    released: () => released,
  };
}

function onlyClaim(claims: Claim[]): Claim {
  expect(claims).toHaveLength(1);
  return claims[0] as Claim;
}

const BIN = "/caret/bin/caret";

function recordingSpawn(failWith?: string) {
  const spawned: Array<{ bin: string; args: string[] }> = [];
  const spawn: DetachedSpawn = (bin, args, onError) => {
    spawned.push({ bin, args });
    if (failWith) onError(new Error(failWith));
  };
  return { spawned, spawn };
}

function start({
  checkUpdate = () => {},
  fake = fakeTui(),
  failWith,
  loadOpenTui = async () => fakeOpenTui,
}: {
  checkUpdate?: (show: ToastSink) => void;
  fake?: ReturnType<typeof fakeTui>;
  failWith?: string;
  loadOpenTui?: () => Promise<typeof fakeOpenTui>;
} = {}) {
  const { spawned, spawn } = recordingSpawn(failWith);
  const cleanup = createCaretTui({ checkUpdate, bin: BIN, spawn, loadOpenTui })(fake.ctx);
  return { ...fake, cleanup, spawned };
}

const runCommand = (layers: Layer[]) => layers[0]?.commands[0]?.run();

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
  start({ fake });
  expect(() => fake.emit("session.tool.progress", "C", { caretUrl: URL })).not.toThrow();
});

test("a rejecting toast surface leaves no unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    const fake = fakeTui(() => Promise.reject(new Error("x")));
    start({ fake });
    fake.emit("session.tool.progress", "C", { caretUrl: URL });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", record);
  }
});

test("a throwing update check does not escape setup", () => {
  expect(() =>
    start({
      checkUpdate: () => {
        throw new Error("boom");
      },
    }),
  ).not.toThrow();
});

test("the update check runs once on a sink that toasts through the TUI", () => {
  const sinks: ToastSink[] = [];
  const { shown } = start({ checkUpdate: (show) => sinks.push(show) });
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

test("setup registers the /caret command on <leader>p and in the palette", () => {
  const { layers } = start();
  expect(layers).toHaveLength(1);
  expect(layers[0]?.mode).toBe("global");
  expect(layers[0]?.commands).toHaveLength(1);
  const command = layers[0]?.commands[0];
  expect(command).toMatchObject({
    id: "caret.open",
    palette: true,
    slash: { name: "caret" },
    bind: "<leader>p",
  });
  expect(command?.title).not.toBe("");
});

test("on a session route the command opens that session's plan", () => {
  const { layers, spawned } = start({
    fake: fakeTui(undefined, { route: { type: "session", sessionID: "ses_A" }, keymap: "record" }),
  });
  runCommand(layers);
  expect(spawned).toEqual([{ bin: BIN, args: ["band-link", "--session", "ses_A", "--open"] }]);
});

test("off a session route the command opens caret's home page", () => {
  for (const route of [{ type: "home" }, undefined]) {
    const { layers, spawned } = start({
      fake: fakeTui(undefined, { ...(route ? { route } : {}), keymap: "record" }),
    });
    runCommand(layers);
    expect(spawned).toEqual([{ bin: BIN, args: ["band-link", "--open"] }]);
  }
});

test("a spawn that fails shows an error toast naming the failure", () => {
  const { layers, shown } = start({ failWith: "spawn /caret/bin/caret ENOENT" });
  runCommand(layers);
  expect(shown).toHaveLength(1);
  expect(shown[0]?.variant).toBe("error");
  expect(shown[0]?.message).toContain("ENOENT");
});

test("a host without a keymap still shows the review-link toast", () => {
  const fake = fakeTui(undefined, {});
  let started: ReturnType<typeof start> | undefined;
  expect(() => {
    started = start({ fake });
  }).not.toThrow();
  expect(started?.layers).toEqual([]);
  fake.emit("session.tool.progress", "C", { caretUrl: URL });
  expect(fake.shown.map((b) => b.message)).toEqual([URL]);
});

test("a keymap that rejects the command still leaves the review-link toast", () => {
  const fake = fakeTui(undefined, {
    keymap: {
      layer: () => {
        throw new Error("bad command shape");
      },
    },
  });
  expect(() => start({ fake })).not.toThrow();
  fake.emit("session.tool.progress", "C", { caretUrl: URL });
  expect(fake.shown.map((b) => b.message)).toEqual([URL]);
});

// The two below drive the REAL nodeDetachedSpawn: its contract lives in the child's
// listeners, which a stubbed spawn cannot pin.

test("the real detached spawn hands a bad binary's async error to onError", async () => {
  const errors: Error[] = [];
  nodeDetachedSpawn("/nonexistent/caret-2247", ["band-link", "--open"], (e) => errors.push(e));
  expect(await until(() => errors.length === 1)).toBe(true);
  // Reaching here proves the unhandled-'error' crash did not take the process down.
  expect((errors[0] as NodeJS.ErrnoException).code).toBe("ENOENT");
});

test("the real detached spawn reports a caret that exits non-zero", async () => {
  const shim = join(mkdtempSync(join(tmpdir(), "caret-tui-")), "shim");
  writeFileSync(shim, "#!/bin/sh\nexit 127\n");
  chmodSync(shim, 0o755);
  const errors: Error[] = [];
  nodeDetachedSpawn(shim, ["band-link", "--open"], (e) => errors.push(e));
  expect(await until(() => errors.length === 1)).toBe(true);
  expect(errors[0]?.message).toContain("127");
});

test("a progress event carrying the review URL records the session's pending review", () => {
  const { emit, stores } = start();
  emit("session.tool.progress", "C", { caretUrl: URL });
  expect(stores.get("caret.pending")).toEqual({ ses_C: { callId: "C", url: URL } });
});

test("setup claims the slot above the composer once", async () => {
  const { claims } = start();
  await flush();
  expect(claims).toHaveLength(1);
  expect(claims[0]?.prepend).toBe("session.composer.top");
});

test("the pending line shows only in the waiting session and clears on success", async () => {
  const { emit, claims, stores } = start();
  await flush();
  emit("session.tool.progress", "A", { caretUrl: URL });
  expect(lineFor(onlyClaim(claims), "ses_A")).toBe("plan waiting in caret");
  expect(lineFor(onlyClaim(claims), "ses_B")).toBe("");
  emit("session.tool.success", "A", { caretDecision: "allow" });
  expect(lineFor(onlyClaim(claims), "ses_A")).toBe("");
  expect(stores.get("caret.pending")).not.toHaveProperty("ses_A");
});

test("a rendered line follows the store and its slot input", async () => {
  const { emit, claims } = start();
  await flush();
  const input = { sessionID: "ses_A" };
  const line = onlyClaim(claims).render(input) as FakeLine;
  expect(line.text()).toBe("");
  emit("session.tool.progress", "A", { caretUrl: URL });
  const waiting = line.text();
  expect(waiting).not.toBe("");
  emit("session.tool.success", "A", { caretDecision: "allow" });
  expect(line.text()).toBe("");
  emit("session.tool.progress", "B", { caretUrl: URL });
  input.sessionID = "ses_B";
  expect(line.text()).toBe(waiting);
});

test("a later linked call in a session supersedes the earlier one", async () => {
  const { emit, claims, shown } = start();
  await flush();
  emit("session.tool.progress", "A1", { caretUrl: URL }, "ses_S");
  emit("session.tool.progress", "A2", { caretUrl: URL }, "ses_S");
  emit("session.tool.success", "A1", { caretDecision: "allow" }, "ses_S");
  expect(lineFor(onlyClaim(claims), "ses_S")).not.toBe("");
  expect(shown.map((b) => b.message)).toEqual([URL, URL]);
  emit("session.tool.success", "A2", { caretDecision: "allow" }, "ses_S");
  expect(lineFor(onlyClaim(claims), "ses_S")).toBe("");
  expect(shown.map((b) => b.message)).toEqual([URL, URL, "caret: plan approved"]);
});

test("a failed call clears its session's pending line", async () => {
  const { emit, claims } = start();
  await flush();
  emit("session.tool.progress", "A", { caretUrl: URL });
  expect(lineFor(onlyClaim(claims), "ses_A")).not.toBe("");
  emit("session.tool.failed", "A");
  expect(lineFor(onlyClaim(claims), "ses_A")).toBe("");
});

test("settling one session's review leaves another session's pending line", async () => {
  const { emit, claims } = start();
  await flush();
  emit("session.tool.progress", "A", { caretUrl: URL });
  emit("session.tool.progress", "B", { caretUrl: URL });
  emit("session.tool.success", "A", { caretDecision: "allow" });
  expect(lineFor(onlyClaim(claims), "ses_A")).toBe("");
  expect(lineFor(onlyClaim(claims), "ses_B")).not.toBe("");
});

test("a rejecting OpenTUI load makes no claim and leaves no unhandled rejection", async () => {
  const unhandled: unknown[] = [];
  const record = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  try {
    const { claims } = start({ loadOpenTui: () => Promise.reject(new Error("x")) });
    await flush();
    expect(claims).toHaveLength(0);
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", record);
  }
});

test("a host missing the slot or storage gets no claim but keeps the review-link toast", async () => {
  for (const missing of [{ slot: false }, { storage: false }]) {
    const fake = fakeTui(undefined, { keymap: "record", ...missing });
    let loads = 0;
    start({
      fake,
      loadOpenTui: async () => {
        loads++;
        return fakeOpenTui;
      },
    });
    await flush();
    expect(fake.claims).toHaveLength(0);
    expect(loads).toBe(0);
    fake.emit("session.tool.progress", "C", { caretUrl: URL });
    expect(fake.shown.map((b) => b.message)).toEqual([URL]);
  }
});

test("the cleanup releases the slot claim", async () => {
  const { cleanup, released } = start();
  await flush();
  cleanup();
  expect(released()).toBe(1);
});

test("a cleanup before the OpenTUI load lands makes no claim", async () => {
  const { cleanup, claims, released } = start();
  cleanup();
  await flush();
  expect(claims).toHaveLength(0);
  expect(released()).toBe(0);
});

test("the production loader imports @opentui/solid by a bare string literal, the only form the v2 host rewrites", () => {
  const source = readFileSync(join(import.meta.dir, "../../opencode/caret.tui.ts"), "utf8");
  expect(/import\s*\(\s*"@opentui\/solid"\s*\)/.test(source)).toBe(true);
});
