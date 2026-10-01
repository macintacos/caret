// Unit coverage for caret's OpenCode v2 `setup` adapter: tool registration, the
// planning steer, the `context`-hook subagent removal, the prewarm, the plan-agent allow,
// the evaluate-then-refuse `path` check, the subagent refusal, abort, and the toast
// progress and metadata keys — driven through a fake v2 plugin context and a stub runner.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { Plugin } from "@opencode/plugin";
import type { ToolContext } from "@opencode/plugin/promise/tool";
import type { PluginInput, ToolContext as V1ToolContext } from "@opencode-ai/plugin";

import { CARET_DECISION_KEY, CARET_URL_KEY, planningSteer, REVIEW_TOOL } from "@oc/caret.core.ts";
import { createCaretPlugin } from "@oc/caret.plugin.ts";
import { createCaretSetup, PLAN_ALLOW_RULE, withPlanAllow } from "@oc/caret.plugin.v2.ts";
import type { Rule } from "@oc/permission.ts";
import type { SpawnRunner } from "@oc/review-bridge.ts";
import { fakeDistDir } from "@test/support/fs-tree.ts";
import { streamingRunner, stubRunner } from "@test/support/spawn-runner.ts";

const PLANS_DIR = "/home/u/.opencode/plan";
const ALLOW = `{"behavior":"allow"}`;

type Registered = {
  name: string;
  description: string;
  input: unknown;
  options?: { codemode?: boolean };
  execute: (
    input: unknown,
    context: ToolContext,
  ) => Promise<{ content?: unknown; metadata?: unknown }>;
};

type FakeOpts = {
  directory?: string;
  projectDirectory?: string;
  session?: (id: string) => Promise<Record<string, unknown>>;
  agentRules?: (id: string) => Promise<Rule[]>;
  /** Agent ids, default first. */
  agents?: () => Promise<string[]>;
  update?: (input: { sessionID: string; permissions: Rule[] }) => Promise<void>;
};

/** A v2 plugin context that records the registered tool and hooks. */
function fakeContext(opts: FakeOpts = {}) {
  const directory = opts.directory ?? "/proj";
  const tools: Registered[] = [];
  const hooks = new Map<string, (event: unknown) => Promise<void> | void>();
  const updates: Array<{ sessionID: string; permissions: Rule[] }> = [];
  const registration = { dispose: async () => {} };
  const ctx = {
    location: { directory, project: { directory: opts.projectDirectory ?? directory } },
    tool: {
      transform: async (cb: (editor: { add: (info: Registered) => void }) => void) => {
        cb({ add: (info) => tools.push(info) });
        return registration;
      },
    },
    session: {
      get: async ({ sessionID }: { sessionID: string }) => ({
        location: { directory },
        ...(await (opts.session ?? (async () => ({ id: sessionID })))(sessionID)),
      }),
      update: async (input: { sessionID: string; permissions: Rule[] }) => {
        await opts.update?.(input);
        updates.push(input);
      },
      hook: async (name: string, cb: (event: unknown) => Promise<void> | void) => {
        hooks.set(name, cb);
        return registration;
      },
    },
    agent: {
      get: async ({ agentID }: { agentID: string }) => ({
        location: { directory },
        data: { permissions: await (opts.agentRules ?? (async () => []))(agentID) },
      }),
      list: async () => ({
        location: { directory },
        data: (await (opts.agents ?? (async () => ["build", "plan"]))()).map((id) => ({ id })),
      }),
    },
  };
  return { ctx: ctx as unknown as Plugin.Context, tools, hooks, updates };
}

async function setupWith(
  run: SpawnRunner,
  fake: FakeOpts = {},
  warm: (bin: string) => void = () => {},
) {
  const harness = fakeContext(fake);
  await createCaretSetup({ bin: "caret", run, warm, plansDir: PLANS_DIR })(harness.ctx);
  const tool = harness.tools[0];
  if (!tool) throw new Error("no tool registered");
  return { ...harness, tool };
}

function toolContext(extra: Partial<ToolContext> = {}): ToolContext {
  return {
    sessionID: "S",
    agent: "plan",
    messageID: "M",
    id: "C",
    signal: new AbortController().signal,
    progress: async () => {},
    ...extra,
  } as unknown as ToolContext;
}

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function planDir(files: Record<string, string>): string {
  const directory = fakeDistDir("caret-v2-plan-", files);
  dirs.push(directory);
  return directory;
}

const ALLOW_ALL: Rule[] = [{ action: "*", resource: "*", effect: "allow" }];

// --- registration ---

test("setup registers caret_review_plan outside Code Mode with plan/path string inputs", async () => {
  const { tool } = await setupWith(stubRunner(ALLOW));
  expect(tool.name).toBe(REVIEW_TOOL);
  expect(tool.options?.codemode).toBe(false);
  const input = tool.input as { type: string; properties: Record<string, { type: string }> };
  expect(input.type).toBe("object");
  expect(Object.keys(input.properties).sort()).toEqual(["path", "plan"]);
  expect(input.properties.plan?.type).toBe("string");
  expect(input.properties.path?.type).toBe("string");
});

// --- v1 and v2 reject the same inputs ---

test("v1 and v2 reject the same invalid inputs with identical text, never spawning", async () => {
  const directory = planDir({ "notes.txt": "x", "sub/keep.md": "x" });
  const rows: Array<Record<string, string>> = [
    { plan: "# P", path: "a.md" },
    {},
    { plan: "", path: "" },
    { path: "notes.txt" },
    { path: "missing.md" },
    { path: "sub" },
  ];
  mkdirSync(join(directory, "dir.md"), { recursive: true });
  rows.push({ path: "dir.md" });

  let spawned = false;
  const run: SpawnRunner = async () => {
    spawned = true;
    return { exitCode: 0, stdout: ALLOW };
  };
  const v1 = await createCaretPlugin({ bin: "caret", run, plansDir: PLANS_DIR })({
    client: undefined,
  } as unknown as PluginInput);
  const { tool } = await setupWith(run, { directory, agentRules: async () => ALLOW_ALL });
  for (const args of rows) {
    const v1Text = await v1.tool?.[REVIEW_TOOL]?.execute?.(args, {
      agent: "plan",
      sessionID: "S",
      directory,
      worktree: directory,
      ask: async () => {},
    } as unknown as V1ToolContext);
    const v2 = await tool.execute(args, toolContext());
    expect(v2.content).toBe(String(v1Text));
  }
  expect(spawned).toBe(false);
});

// --- steer ---

type ContextEvent = {
  agent: string;
  system: Array<{ type: string; text: string }>;
  sessionID?: string;
  tools?: Record<string, unknown>;
};

async function steer(agent: string) {
  const { hooks } = await setupWith(stubRunner(ALLOW));
  const event: ContextEvent = { agent, system: [], tools: { [REVIEW_TOOL]: {} } };
  await hooks.get("context")?.(event);
  return event.system;
}

test("the context hook steers the plan agent with a text system part", async () => {
  expect(await steer("plan")).toEqual([{ type: "text", text: planningSteer(PLANS_DIR) }]);
});

test("the context hook leaves other agents unsteered", async () => {
  expect(await steer("build")).toEqual([]);
  expect(await steer("mystery")).toEqual([]);
});

test("a context hook that cannot push resolves instead of rejecting", async () => {
  const { hooks } = await setupWith(stubRunner(ALLOW));
  await hooks.get("context")?.({ agent: "plan", system: null });
});

// --- subagent deny ---

async function contextTools(session: FakeOpts["session"], agent = "build") {
  const { hooks } = await setupWith(stubRunner(ALLOW), { session });
  const event: ContextEvent = {
    agent,
    system: [],
    sessionID: "S",
    tools: { [REVIEW_TOOL]: {}, read: {} },
  };
  await hooks.get("context")?.(event);
  return { tools: Object.keys(event.tools ?? {}).sort(), system: event.system };
}

test("the context hook removes the review tool from a subagent session's request", async () => {
  expect((await contextTools(async () => ({ parentID: "P" }))).tools).toEqual(["read"]);
});

test("the context hook keeps the review tool for a primary session", async () => {
  expect((await contextTools(async () => ({}))).tools).toEqual([REVIEW_TOOL, "read"].sort());
});

test("the context hook keeps the review tool when the session cannot be read", async () => {
  const { tools } = await contextTools(async () => {
    throw new Error("gone");
  });
  expect(tools).toEqual([REVIEW_TOOL, "read"].sort());
});

test("the context hook strips the tool from a plan subagent and does not steer it", async () => {
  const { tools, system } = await contextTools(async () => ({ parentID: "P" }), "plan");
  expect(tools).toEqual(["read"]);
  expect(system).toEqual([]);
});

test("a steer that cannot push still removes the tool from a subagent", async () => {
  const { hooks } = await setupWith(stubRunner(ALLOW), {
    session: async () => ({ parentID: "P" }),
  });
  const event = { agent: "plan", system: null, sessionID: "S", tools: { [REVIEW_TOOL]: {} } };
  await hooks.get("context")?.(event);
  expect(Object.keys(event.tools)).toEqual([]);
});

test("a context event without tools resolves", async () => {
  const { hooks } = await setupWith(stubRunner(ALLOW), {
    session: async () => ({ parentID: "P" }),
  });
  await hooks.get("context")?.({ agent: "build", system: [], sessionID: "S" });
});

// --- plan-agent allow ---

const DENY_ALL: Rule[] = [{ action: "*", resource: "*", effect: "deny" }];
const DENY_TOOL: Rule[] = [{ action: REVIEW_TOOL, resource: "*", effect: "deny" }];

test("withPlanAllow appends caret's allow to the session rules", () => {
  expect(withPlanAllow(DENY_ALL, DENY_ALL)).toEqual([...DENY_ALL, PLAN_ALLOW_RULE]);
  expect(withPlanAllow([], [])).toEqual([PLAN_ALLOW_RULE]);
});

test("withPlanAllow leaves rules that already name the tool alone", () => {
  expect(withPlanAllow([], DENY_TOOL)).toBeUndefined();
  expect(withPlanAllow(DENY_TOOL, [])).toBeUndefined();
  expect(withPlanAllow([], [PLAN_ALLOW_RULE])).toBeUndefined();
});

async function grant(fake: FakeOpts) {
  const { hooks, updates } = await setupWith(stubRunner(ALLOW), fake);
  await hooks.get("prompt")?.({ sessionID: "S" });
  return updates;
}

test("the prompt hook grants a plan session the review tool before it resolves", async () => {
  const updates = await grant({
    session: async () => ({ agent: "plan", permissions: DENY_ALL }),
    agentRules: async () => DENY_ALL,
    update: () => Bun.sleep(1),
  });
  expect(updates).toEqual([{ sessionID: "S", permissions: [...DENY_ALL, PLAN_ALLOW_RULE] }]);
});

test("the prompt hook grants nothing outside a plan session or over the user's rule", async () => {
  expect(await grant({ session: async () => ({ agent: "build" }) })).toEqual([]);
  expect(await grant({ session: async () => ({ agent: "plan", permissions: DENY_TOOL }) })).toEqual(
    [],
  );
  expect(
    await grant({ session: async () => ({ agent: "plan" }), agentRules: async () => DENY_TOOL }),
  ).toEqual([]);
  const agents = async () => ["plan"];
  expect(await grant({ session: async () => ({ permissions: DENY_TOOL }), agents })).toEqual([]);
  expect(
    await grant({
      session: async () => ({}),
      agents,
      agentRules: async (id) => (id === "plan" ? DENY_TOOL : []),
    }),
  ).toEqual([]);
});

test("a second prompt on a granted session writes nothing", async () => {
  let permissions: Rule[] = [];
  const { hooks, updates } = await setupWith(stubRunner(ALLOW), {
    session: async () => ({ agent: "plan", permissions }),
    update: async (input) => {
      permissions = input.permissions;
    },
  });
  await hooks.get("prompt")?.({ sessionID: "S" });
  await hooks.get("prompt")?.({ sessionID: "S" });
  expect(updates).toHaveLength(1);
});

test("the prompt hook swallows a failing agent read or session write", async () => {
  const fail = async () => {
    throw new Error("boom");
  };
  const planSession = async () => ({ agent: "plan" });
  expect(await grant({ session: planSession, agentRules: fail })).toEqual([]);
  expect(await grant({ session: planSession, update: fail })).toEqual([]);
});

test("a warm that throws still grants a plan session", async () => {
  const { hooks, updates } = await setupWith(
    stubRunner(ALLOW),
    { session: async () => ({ agent: "plan" }) },
    () => {
      throw new Error("spawn failed");
    },
  );
  await hooks.get("prompt")?.({ sessionID: "S" });
  expect(updates).toEqual([{ sessionID: "S", permissions: [PLAN_ALLOW_RULE] }]);
});

// --- prewarm ---

async function prompt(fake: FakeOpts) {
  const warmed: string[] = [];
  const { hooks, updates } = await setupWith(stubRunner(ALLOW), fake, (bin) => warmed.push(bin));
  await hooks.get("prompt")?.({ sessionID: "S" });
  return { warmed, updates };
}

const NOTHING = { warmed: [], updates: [] };

test("the prompt hook warms the daemon for a plan-agent session", async () => {
  expect((await prompt({ session: async () => ({ agent: "plan" }) })).warmed).toEqual(["caret"]);
});

test("the prompt hook neither warms nor grants a build session or a session on a build default agent", async () => {
  expect(await prompt({ session: async () => ({ agent: "build" }) })).toEqual(NOTHING);
  expect(
    await prompt({ session: async () => ({}), agents: async () => ["build", "plan"] }),
  ).toEqual(NOTHING);
});

test("the prompt hook swallows a session read failure", async () => {
  const session = async () => {
    throw new Error("gone");
  };
  expect((await prompt({ session })).warmed).toEqual([]);
});

test("the prompt hook warms and grants a session on a plan default agent", async () => {
  expect(
    await prompt({
      session: async () => ({ permissions: DENY_ALL }),
      agents: async () => ["plan", "build"],
      agentRules: async () => DENY_ALL,
      update: () => Bun.sleep(1),
    }),
  ).toEqual({
    warmed: ["caret"],
    updates: [{ sessionID: "S", permissions: [...DENY_ALL, PLAN_ALLOW_RULE] }],
  });
});

test("the prompt hook fails closed when the default agent cannot be resolved", async () => {
  const session = async () => ({});
  const agents = async (): Promise<string[]> => {
    throw new Error("boom");
  };
  expect(await prompt({ session, agents })).toEqual(NOTHING);
  expect(await prompt({ session, agents: async () => [] })).toEqual(NOTHING);
});

test("an explicit session agent outranks the default agent", async () => {
  expect(
    await prompt({ session: async () => ({ agent: "build" }), agents: async () => ["plan"] }),
  ).toEqual(NOTHING);
  const agents = async (): Promise<string[]> => {
    throw new Error("boom");
  };
  expect(await prompt({ session: async () => ({ agent: "plan" }), agents })).toEqual({
    warmed: ["caret"],
    updates: [{ sessionID: "S", permissions: [PLAN_ALLOW_RULE] }],
  });
});

// --- path flow ---

async function pathReview(fake: FakeOpts, path: string) {
  const stdins: string[] = [];
  const { tool } = await setupWith(
    stubRunner(ALLOW, (_c, _e, stdin) => stdins.push(stdin)),
    fake,
  );
  const result = await tool.execute({ path }, toolContext());
  return { result, stdins };
}

test("a relative path resolves against the session directory and spawns when allowed", async () => {
  const directory = planDir({ "plans/p.md": "# From disk\n" });
  const { stdins } = await pathReview(
    {
      directory: "/elsewhere",
      session: async () => ({ location: { directory } }),
      agentRules: async () => ALLOW_ALL,
    },
    "plans/p.md",
  );
  expect(JSON.parse(stdins[0] ?? "{}").tool_input).toMatchObject({
    plan: "# From disk\n",
    planFilePath: join(directory, "plans/p.md"),
  });
});

test("deny, ask, and failed reads refuse a path review without spawning", async () => {
  const directory = planDir({ "p.md": "# P\n" });
  const cases: FakeOpts[] = [
    { directory, agentRules: async () => [{ action: "edit", resource: "*", effect: "deny" }] },
    { directory, agentRules: async () => [{ action: "edit", resource: "*", effect: "ask" }] },
    {
      directory,
      agentRules: async () => {
        throw new Error("no agent");
      },
    },
    {
      directory,
      agentRules: async () => ALLOW_ALL,
      session: async () => {
        throw new Error("no session");
      },
    },
  ];
  for (const fake of cases) {
    const { result, stdins } = await pathReview(fake, "p.md");
    expect(String(result.content)).toContain("not permitted to edit");
    expect(stdins).toEqual([]);
  }
});

test("stock agent rules allow an in-project file and refuse an out-of-project one", async () => {
  const stock: Rule[] = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "external_directory", resource: "*", effect: "ask" },
  ];
  const project = planDir({ "p.md": "# In\n" });
  const outside = planDir({ "p.md": "# Out\n" });
  const inside = await pathReview({ directory: project, agentRules: async () => stock }, "p.md");
  expect(inside.stdins).toHaveLength(1);
  const out = await pathReview(
    { directory: project, agentRules: async () => stock },
    join(outside, "p.md"),
  );
  expect(out.stdins).toEqual([]);
});

// --- subagent refusal ---

test("a subagent session is refused without spawning; an unreadable session proceeds", async () => {
  const childStdins: string[] = [];
  const child = await setupWith(
    stubRunner(ALLOW, (_c, _e, stdin) => childStdins.push(stdin)),
    { session: async () => ({ parentID: "P" }) },
  );
  const refused = await child.tool.execute({ plan: "# P" }, toolContext());
  expect(String(refused.content)).toContain("primary agents only");
  expect(childStdins).toEqual([]);

  let spawned = 0;
  const { tool } = await setupWith(
    stubRunner(ALLOW, () => spawned++),
    {
      session: async () => {
        throw new Error("gone");
      },
    },
  );
  await tool.execute({ plan: "# P" }, toolContext());
  expect(spawned).toBe(1);
});

// --- abort + results ---

test("execute hands the tool call's signal to the runner", async () => {
  const signal = new AbortController().signal;
  let handed: AbortSignal | undefined;
  const { tool } = await setupWith(async (_c, _e, _s, _o, s) => {
    handed = s;
    return { exitCode: 0, stdout: ALLOW };
  });
  await tool.execute({ plan: "# P" }, toolContext({ signal }));
  expect(handed === signal).toBe(true);
});

test("execute returns the decision as string content", async () => {
  const { tool } = await setupWith(stubRunner(`{"behavior":"deny","feedback":"narrow it"}`));
  const result = await tool.execute({ plan: "# P" }, toolContext());
  expect(typeof result.content).toBe("string");
  expect(String(result.content)).toContain("narrow it");
});

test("a runner that throws fails safe to a deny from the bridge", async () => {
  const { tool } = await setupWith(async () => {
    throw new Error("boom");
  });
  const result = await tool.execute({ plan: "# P" }, toolContext());
  expect(typeof result.content).toBe("string");
});

test("a failure escaping the review core resolves to a fail-safe deny, not a rejection", async () => {
  const { tool } = await setupWith(stubRunner(ALLOW));
  const result = await tool.execute(null, toolContext());
  expect(String(result.content)).toContain("denying to fail safe");
});

// --- trust-boundary inputs ---

test("session edit denies refuse a path review even when the agent allows all", async () => {
  const directory = planDir({ "p.md": "# P\n" });
  const { result, stdins } = await pathReview(
    {
      directory,
      agentRules: async () => ALLOW_ALL,
      session: async () => ({
        location: { directory },
        permissions: [{ action: "edit", resource: "*", effect: "deny" }],
      }),
    },
    "p.md",
  );
  expect(String(result.content)).toContain("not permitted to edit");
  expect(stdins).toEqual([]);
});

test("the calling agent's rules decide a path review", async () => {
  const directory = planDir({ "p.md": "# P\n" });
  const stdins: string[] = [];
  const { tool } = await setupWith(
    stubRunner(ALLOW, (_c, _e, stdin) => stdins.push(stdin)),
    { directory, agentRules: async (id) => (id === "plan" ? ALLOW_ALL : []) },
  );
  const result = await tool.execute(
    { path: "p.md" },
    toolContext({ agent: "build" } as Partial<ToolContext>),
  );
  expect(String(result.content)).toContain("not permitted to edit");
  expect(stdins).toEqual([]);
});

test("a file in the project but outside the session directory counts as internal", async () => {
  const project = planDir({ "plan.md": "# P\n", "pkg/.keep": "" });
  const stock: Rule[] = [
    { action: "*", resource: "*", effect: "allow" },
    { action: "external_directory", resource: "*", effect: "ask" },
  ];
  const { stdins } = await pathReview(
    { directory: join(project, "pkg"), projectDirectory: project, agentRules: async () => stock },
    join(project, "plan.md"),
  );
  expect(stdins).toHaveLength(1);
});

test("a build-agent call with an inline plan spawns the review", async () => {
  let spawned = 0;
  const { tool } = await setupWith(stubRunner(ALLOW, () => spawned++));
  await tool.execute({ plan: "# P" }, toolContext({ agent: "build" } as Partial<ToolContext>));
  expect(spawned).toBe(1);
});

// --- toast metadata ---

const URL_LINE = "caret: review this plan at http://127.0.0.1:4242/r/1\n";

test("execute reports the review URL as tool progress", async () => {
  const progressed: unknown[] = [];
  const { tool } = await setupWith(streamingRunner(ALLOW, [URL_LINE]));
  await tool.execute(
    { plan: "# P" },
    toolContext({ progress: async (m: unknown) => void progressed.push(m) }),
  );
  expect(progressed).toEqual([{ [CARET_URL_KEY]: "http://127.0.0.1:4242/r/1" }]);
});

test("a rejecting progress call does not stop the review", async () => {
  const { tool } = await setupWith(streamingRunner(ALLOW, [URL_LINE]));
  const result = await tool.execute(
    { plan: "# P" },
    toolContext({ progress: async () => Promise.reject(new Error("gone")) }),
  );
  expect(result.metadata).toEqual({ [CARET_DECISION_KEY]: "allow" });
});

test("execute returns the decision's behavior as metadata beside the content", async () => {
  for (const behavior of ["allow", "deny"]) {
    const { tool } = await setupWith(stubRunner(`{"behavior":"${behavior}","feedback":"x"}`));
    const result = await tool.execute({ plan: "# P" }, toolContext());
    expect(typeof result.content).toBe("string");
    expect(result.metadata).toEqual({ [CARET_DECISION_KEY]: behavior });
  }
});

test("an aborted review returns content without decision metadata", async () => {
  const controller = new AbortController();
  controller.abort();
  const { tool } = await setupWith(stubRunner(ALLOW));
  const result = await tool.execute({ plan: "# P" }, toolContext({ signal: controller.signal }));
  expect(typeof result.content).toBe("string");
  expect(result.metadata).toBeUndefined();
});
