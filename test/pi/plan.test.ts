import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PLAN_TITLE_INSTRUCTION, REVIEW_TOOL } from "@bridge/review-bridge.ts";
import {
  type PlanningEntry as Entry,
  installPlanning,
  PLANNING,
  type PlanningApi,
  planningSteer,
  sessionTag,
} from "@piext/plan.ts";
import { createReviewStore, footerText, type ReviewStore } from "@piext/state.ts";

const SID = "0190a1b2-c3d4-7e5f-8a9b-0123456789ab";

type Handler = (event: unknown, ctx: unknown) => unknown;

let tmp: string;
let plansDir: string;
let store: ReviewStore;
let warms: number;

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "caret-plan-")));
  plansDir = join(tmp, "agent", "plans");
  store = createReviewStore();
  warms = 0;
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const planningEntry = (active: boolean): Entry => ({
  type: "custom",
  customType: PLANNING,
  data: { active },
});

function fakePi(warm: () => void = () => warms++) {
  const handlers: Record<string, Handler> = {};
  const commands: Record<string, (args: string, ctx: unknown) => Promise<void>> = {};
  const entries: { customType: string; data: unknown }[] = [];
  const sent: { content: string; options: unknown }[] = [];
  const notices: string[] = [];
  let idleAwaited = 0;
  let branch: Entry[] = [];
  const ctx = {
    cwd: tmp,
    sessionManager: { getSessionId: () => SID, getBranch: () => branch },
    ui: { notify: (message: string) => notices.push(message) },
    waitForIdle: async () => {
      idleAwaited++;
    },
  };
  const pi = {
    registerCommand: (
      name: string,
      options: { handler: (a: string, c: unknown) => Promise<void> },
    ) => {
      commands[name] = options.handler;
    },
    appendEntry: (customType: string, data: unknown) => entries.push({ customType, data }),
    sendUserMessage: (content: string, options: unknown) => sent.push({ content, options }),
    on: (event: string, handler: Handler) => {
      handlers[event] = handler;
    },
  } as unknown as PlanningApi;
  installPlanning(pi, { store, plansDir, warm });
  return {
    entries,
    sent,
    notices,
    idle: () => idleAwaited,
    setBranch: (b: Entry[]) => {
      branch = b;
    },
    fire: (event: string, payload: unknown) => handlers[event]?.(payload, ctx),
    command: (args: string) => commands["caret:plan"]?.(args, ctx),
  };
}

const planning = () => store.get(SID).planning;

describe("/caret:plan", () => {
  test("with a task, turns planning on and sends the task", async () => {
    const f = fakePi();
    await f.command("  add a cache  ");
    expect(planning()).toBe(true);
    expect(f.entries).toEqual([{ customType: PLANNING, data: { active: true } }]);
    expect(existsSync(plansDir)).toBe(true);
    expect(f.sent).toEqual([{ content: "add a cache", options: { deliverAs: "followUp" } }]);
    expect(f.idle()).toBe(1);
  });

  test("with no task, turns planning on and plans the earlier request", async () => {
    const f = fakePi();
    await f.command("");
    expect(planning()).toBe(true);
    expect(f.sent.length).toBe(1);
    expect(f.sent[0]?.content).not.toBe("");
  });

  test("with no task while planning, turns planning off and sends nothing", async () => {
    const f = fakePi();
    await f.command("x");
    await f.command(" ");
    expect(planning()).toBe(false);
    expect(f.entries.at(-1)).toEqual({ customType: PLANNING, data: { active: false } });
    expect(f.notices.length).toBe(1);
    expect(f.sent.length).toBe(1);
    expect(footerText(store.get(SID))).toBeUndefined();
  });

  test("with a task while planning, stays on without a new entry", async () => {
    const f = fakePi();
    await f.command("x");
    await f.command("y");
    expect(planning()).toBe(true);
    expect(f.entries.length).toBe(1);
    expect(f.sent.map((s) => s.content)).toEqual(["x", "y"]);
  });
});

describe("steer", () => {
  test("a user run while planning gets the hidden steer and a warm", async () => {
    const f = fakePi();
    await f.command("x");
    const result = f.fire("before_agent_start", { messageType: "user" }) as {
      message: { customType: string; content: string; display: boolean };
    };
    expect(result.message.customType).toBe(PLANNING);
    expect(result.message.display).toBe(false);
    for (const part of [plansDir, sessionTag(SID), REVIEW_TOOL, PLAN_TITLE_INSTRUCTION]) {
      expect(result.message.content).toContain(part);
    }
    expect(warms).toBe(1);
  });

  test("a warm that throws still yields the steer", async () => {
    const f = fakePi(() => {
      throw new Error("EAGAIN");
    });
    await f.command("x");
    const result = f.fire("before_agent_start", { messageType: "user" }) as {
      message: { customType: string };
    };
    expect(result.message.customType).toBe(PLANNING);
  });

  test("no steer or warm when not planning", () => {
    const f = fakePi();
    expect(f.fire("before_agent_start", { messageType: "user" })).toBeUndefined();
    expect(warms).toBe(0);
  });

  test("no steer or warm for a custom-message run", async () => {
    const f = fakePi();
    await f.command("x");
    expect(f.fire("before_agent_start", { messageType: "custom" })).toBeUndefined();
    expect(warms).toBe(0);
  });
});

describe("context", () => {
  const messages = [
    { role: "user" },
    { role: "custom", customType: PLANNING },
    { role: "custom", customType: "other" },
  ];

  test("drops the steer once planning is off", () => {
    const f = fakePi();
    expect(f.fire("context", { messages })).toEqual({
      messages: [messages[0], messages[2]],
    });
  });

  test("keeps everything while planning", async () => {
    const f = fakePi();
    await f.command("x");
    expect(f.fire("context", { messages })).toBeUndefined();
  });
});

describe("gate", () => {
  const call = (toolName: string, input: unknown) => ({ toolName, toolCallId: "c", input });

  test("while planning, blocks edits outside the plans folder", async () => {
    const f = fakePi();
    await f.command("x");
    const outside = join(tmp, "src.ts");
    const write = f.fire("tool_call", call("write", { path: outside })) as {
      block: boolean;
      reason: string;
    };
    expect(write.block).toBe(true);
    expect(write.reason).toContain(REVIEW_TOOL);
    expect(f.fire("tool_call", call("edit", { path: outside }))).toMatchObject({ block: true });
    expect(f.fire("tool_call", call("write", { path: 7 }))).toMatchObject({ block: true });
  });

  test("while planning, passes plan-file writes and other tools", async () => {
    const f = fakePi();
    await f.command("x");
    expect(f.fire("tool_call", call("write", { path: join(plansDir, "p.md") }))).toBeUndefined();
    expect(f.fire("tool_call", call("bash", { command: "rm -rf /" }))).toBeUndefined();
  });

  test("when not planning, passes everything", () => {
    const f = fakePi();
    expect(f.fire("tool_call", call("write", { path: join(tmp, "a.ts") }))).toBeUndefined();
  });
});

describe("leaving on approval", () => {
  async function review(
    details: unknown,
    opts: { planningAtCall?: boolean; input?: Record<string, unknown> } = {},
  ) {
    const f = fakePi();
    if (opts.planningAtCall !== false) await f.command("x");
    const input = opts.input ?? { path: join(plansDir, "p.md") };
    f.fire("tool_call", { toolName: REVIEW_TOOL, toolCallId: "r1", input });
    if (opts.planningAtCall === false) await f.command("x");
    f.fire("tool_result", { toolName: REVIEW_TOOL, toolCallId: "r1", details });
    return f;
  }

  test("an approval of a review submitted while planning ends planning", async () => {
    const f = await review({ state: "approved" });
    expect(planning()).toBe(false);
    expect(f.entries.at(-1)).toEqual({ customType: PLANNING, data: { active: false } });
  });

  test.each([[{ state: "changes" }], [{ state: "cancelled" }], [{ state: "failed" }], [undefined]])(
    "%p keeps planning on",
    async (details) => {
      await review(details);
      expect(planning()).toBe(true);
    },
  );

  test.each([
    ["a file outside the plans folder", () => ({ path: join(tmp, "other.md") })],
    ["an inline plan", () => ({ plan: "# P" })],
  ])("approving %s keeps planning on", async (_name, input) => {
    await review({ state: "approved" }, { input: input() });
    expect(planning()).toBe(true);
  });

  test("approving a review submitted before planning began keeps planning on", async () => {
    await review({ state: "approved" }, { planningAtCall: false });
    expect(planning()).toBe(true);
  });
});

describe("rebuild from the branch", () => {
  test.each([
    ["[on]", [planningEntry(true)], true],
    ["[on, off]", [planningEntry(true), planningEntry(false)], false],
    ["empty", [], false],
    [
      "unrelated and malformed entries",
      [
        planningEntry(true),
        { type: "custom", customType: "other", data: { active: false } },
        { type: "custom", customType: PLANNING, data: "x" },
      ],
      true,
    ],
  ])("session_start with %s", (_name, branch, expected) => {
    const f = fakePi();
    f.setBranch(branch as Entry[]);
    f.fire("session_start", {});
    expect(planning()).toBe(expected as boolean);
  });

  test("a fork cut before planning began is not planning", () => {
    store.update(SID, { planning: true });
    const f = fakePi();
    f.setBranch([{ type: "message" }]);
    f.fire("session_start", {});
    expect(planning()).toBe(false);
  });

  test("session_tree back to before planning turns it off", async () => {
    const f = fakePi();
    await f.command("x");
    f.setBranch([]);
    f.fire("session_tree", {});
    expect(planning()).toBe(false);
  });
});

describe("helpers", () => {
  test("sessionTag is the id's last 8 characters", () => {
    expect(sessionTag(SID)).toBe("456789ab");
  });

  test("planningSteer names a session-tagged file in the plans folder", () => {
    expect(planningSteer("/p", SID)).toContain("/p/<short-name>-456789ab.md");
  });
});
