// Unit coverage for caret's OpenCode v2 `setup` adapter: tool registration, the
// planning steer, the prewarm, the evaluate-then-refuse `path` check, the subagent
// refusal, and abort — driven through a fake v2 plugin context and a stub runner.

import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import type { PluginInput, ToolContext as V1ToolContext } from "@opencode-ai/plugin";

import { createCaretPlugin, planningSteer, REVIEW_TOOL } from "@opencode/caret.plugin.ts";
import { createCaretSetup } from "@opencode/caret.plugin.v2.ts";
import type { Rule } from "@opencode/permission.ts";
import type { Plugin } from "@opencode/plugin";
import type { ToolContext } from "@opencode/plugin/promise/tool";
import type { SpawnRunner } from "@opencode/review-bridge.ts";
import { fakeDistDir } from "@test/support/fs-tree.ts";
import { stubRunner } from "@test/support/spawn-runner.ts";

const PLANS_DIR = "/home/u/.opencode/plan";
const ALLOW = `{"behavior":"allow"}`;

type Registered = {
  name: string;
  description: string;
  input: unknown;
  options?: { codemode?: boolean };
  execute: (input: unknown, context: ToolContext) => Promise<{ content?: unknown }>;
};

type FakeOpts = {
  directory?: string;
  projectDirectory?: string;
  session?: (id: string) => Promise<Record<string, unknown>>;
  agentRules?: (id: string) => Promise<Rule[]>;
};

/** A v2 plugin context that records the registered tool and hooks. */
function fakeContext(opts: FakeOpts = {}) {
  const directory = opts.directory ?? "/proj";
  const tools: Registered[] = [];
  const hooks = new Map<string, (event: unknown) => Promise<void> | void>();
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
    },
  };
  return { ctx: ctx as unknown as Plugin.Context, tools, hooks };
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

type ContextEvent = { agent: string; system: Array<{ type: string; text: string }> };

async function steer(agent: string) {
  const { hooks } = await setupWith(stubRunner(ALLOW));
  const event: ContextEvent = { agent, system: [] };
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

// --- prewarm ---

async function prompt(session: FakeOpts["session"]) {
  const warmed: string[] = [];
  const { hooks } = await setupWith(stubRunner(ALLOW), { session }, (bin) => warmed.push(bin));
  await hooks.get("prompt")?.({ sessionID: "S" });
  await Bun.sleep(0);
  return warmed;
}

test("the prompt hook warms the daemon for a plan-agent session", async () => {
  expect(await prompt(async () => ({ agent: "plan" }))).toEqual(["caret"]);
});

test("the prompt hook does not warm for a build session or an unset agent", async () => {
  expect(await prompt(async () => ({ agent: "build" }))).toEqual([]);
  expect(await prompt(async () => ({}))).toEqual([]);
});

test("the prompt hook swallows a session read failure", async () => {
  expect(
    await prompt(async () => {
      throw new Error("gone");
    }),
  ).toEqual([]);
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
