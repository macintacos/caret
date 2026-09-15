// Unit coverage for caret's OpenCode plugin (the opencode/ packaging). The plugin
// is an in-process OpenCode module: it registers a plan-review tool, steers the
// plan agent to call it, restricts it to primary agents (subagent-bypass
// mitigation), and bridges to `caret review` (CARET_AGENT=opencode) by spawning it
// with a caret-defined envelope on stdin and reading the flat decision JSON back.
// These tests exercise the pure logic + the tool's execute() through an injected
// spawn runner (no real OpenCode, no real `caret review` process).

import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginInput, ToolContext } from "@opencode-ai/plugin";

import {
  applyCaretConfig,
  createCaretPlugin,
  isPlanningAgent,
  planningSteer,
  REVIEW_TOOL,
  resolvePlanSource,
  resolvePlansDir,
  type WarmRunner,
} from "@opencode/caret.plugin.ts";
import { PLAN_TITLE_INSTRUCTION, type SpawnRunner } from "@opencode/review-bridge.ts";
import { fakeDistDir } from "@test/support/fs-tree.ts";
import { recordingClient } from "@test/support/opencode-toast-client.ts";
import { until } from "@test/support/poll.ts";
import { streamingRunner, stubRunner } from "@test/support/spawn-runner.ts";

// --- isPlanningAgent (steer + warm gate) ---

test("isPlanningAgent matches the plan agent only", () => {
  expect(isPlanningAgent("plan")).toBe(true);
  expect(isPlanningAgent("build")).toBe(false);
  expect(isPlanningAgent(undefined)).toBe(false);
  expect(isPlanningAgent("general")).toBe(false);
});

// --- planning steer ---

test("planningSteer names the review tool and steers away from plan_exit", () => {
  const s = planningSteer("/data/opencode/plans");
  expect(s).toContain(REVIEW_TOOL);
  expect(s.toLowerCase()).toContain("plan_exit");
});

test("planningSteer points the plan agent at a file in the plans directory, submitted as `path`", () => {
  const s = planningSteer("/data/opencode/plans");
  expect(s).toContain("/data/opencode/plans/");
  expect(s).toContain("`path`");
});

test("planningSteer asks the plan agent to open its plan with a title heading", () => {
  expect(planningSteer("/data/opencode/plans")).toContain(PLAN_TITLE_INSTRUCTION);
});

// --- resolvePlansDir (where the steer tells the plan agent to write) ---

/** A readFile over an in-memory map that throws for any other path, as readFileSync does. */
function fakeFiles(files: Record<string, string>) {
  return (path: string) => {
    const text = files[path];
    if (text === undefined) throw new Error(`ENOENT: ${path}`);
    return text;
  };
}

test("resolvePlansDir defaults to OpenCode's data-dir plans folder", () => {
  expect(resolvePlansDir({ env: {}, home: "/h", readFile: fakeFiles({}) })).toBe(
    "/h/.local/share/opencode/plans",
  );
  expect(
    resolvePlansDir({ env: { XDG_DATA_HOME: "/xdg" }, home: "/h", readFile: fakeFiles({}) }),
  ).toBe("/xdg/opencode/plans");
});

test("resolvePlansDir takes [opencode] plans_dir from caret's config.toml, expanding ~", () => {
  const readFile = fakeFiles({
    "/h/.config/caret/config.toml": '[opencode]\nplans_dir = "~/notes/plans"\n',
  });
  expect(resolvePlansDir({ env: {}, home: "/h", readFile })).toBe("/h/notes/plans");
});

test("resolvePlansDir reads the config file caret itself reads", () => {
  const toml = '[opencode]\nplans_dir = "/elsewhere"\n';
  expect(
    resolvePlansDir({
      env: { XDG_CONFIG_HOME: "/cfg" },
      home: "/h",
      readFile: fakeFiles({ "/cfg/caret/config.toml": toml }),
    }),
  ).toBe("/elsewhere");
  expect(
    resolvePlansDir({
      env: { CARET_CONFIG_FILE: "/x/config.dev.toml" },
      home: "/h",
      readFile: fakeFiles({ "/x/config.dev.toml": toml }),
    }),
  ).toBe("/elsewhere");
});

test("resolvePlansDir falls back to the default on an unreadable or malformed config", () => {
  const readFile = fakeFiles({ "/h/.config/caret/config.toml": "[opencode\nplans_dir =" });
  expect(resolvePlansDir({ env: {}, home: "/h", readFile })).toBe("/h/.local/share/opencode/plans");
});

// --- resolvePlanSource (the tool's plan / path args) ---

/** A plan-file reader over an in-memory map, recording every path it is asked for. */
function fakeReader(files: Record<string, string>) {
  const asked: string[] = [];
  const read = (absPath: string) => {
    asked.push(absPath);
    return files[absPath];
  };
  return { read, asked };
}

test("resolvePlanSource reads an absolute .md path and carries it as planFilePath", () => {
  const { read } = fakeReader({ "/abs/plan.md": "# P" });
  expect(resolvePlanSource({ path: "/abs/plan.md" }, "/proj", read)).toEqual({
    plan: "# P",
    planFilePath: "/abs/plan.md",
  });
});

test("resolvePlanSource resolves a relative path against the session directory", () => {
  const { read, asked } = fakeReader({ "/proj/.opencode/plans/p.md": "# P" });
  expect(resolvePlanSource({ path: ".opencode/plans/p.md" }, "/proj", read)).toEqual({
    plan: "# P",
    planFilePath: "/proj/.opencode/plans/p.md",
  });
  expect(asked).toEqual(["/proj/.opencode/plans/p.md"]);
});

test("resolvePlanSource rejects a path that is not a markdown file without reading it", () => {
  const { read, asked } = fakeReader({ "/proj/plan.txt": "# P" });
  const out = resolvePlanSource({ path: "plan.txt" }, "/proj", read);
  expect("error" in out && out.error).toContain(".md");
  expect(asked).toEqual([]);
});

test("resolvePlanSource reports a path it cannot read as a regular file", () => {
  const { read } = fakeReader({});
  const out = resolvePlanSource({ path: "missing.md" }, "/proj", read);
  expect("error" in out && out.error).toContain("/proj/missing.md");
});

test.each([
  ["both", { plan: "# P", path: "p.md" }],
  ["neither", {}],
])("resolvePlanSource requires exactly one of plan or path (%s given)", (_label, args) => {
  const out = resolvePlanSource(args, "/proj", fakeReader({ "/proj/p.md": "# P" }).read);
  expect("error" in out && out.error).toContain(REVIEW_TOOL);
});

test.each([
  ["plan", { path: "p.md", plan: "" }, { plan: "# P", planFilePath: "/proj/p.md" }],
  ["path", { plan: "# P", path: "" }, { plan: "# P" }],
])("resolvePlanSource treats an empty-string %s as absent", (_label, args, expected) => {
  expect(resolvePlanSource(args, "/proj", fakeReader({ "/proj/p.md": "# P" }).read)).toEqual(
    expected,
  );
});

test("resolvePlanSource passes an inline plan through with no plan file", () => {
  expect(resolvePlanSource({ plan: "# P" }, "/proj", fakeReader({}).read)).toEqual({
    plan: "# P",
  });
});

// --- applyCaretConfig (subagent-bypass mitigation) ---

test("applyCaretConfig restricts the tool to primary agents and allows the planner", () => {
  const config: Record<string, unknown> = {};
  applyCaretConfig(config);
  expect((config.experimental as { primary_tools: string[] }).primary_tools).toContain(REVIEW_TOOL);
  const agent = config.agent as Record<string, { permission: Record<string, string> }>;
  expect(agent.plan?.permission[REVIEW_TOOL]).toBe("allow");
  // Every other primary agent is left untouched: OpenCode permits an unknown tool
  // id by default, so no entry is what makes the tool available to all of them.
  expect(agent.build).toBeUndefined();
});

test("applyCaretConfig never overwrites a user's own review-tool permission", () => {
  const config: Record<string, unknown> = {
    agent: {
      plan: { permission: { [REVIEW_TOOL]: "ask" } },
      build: { permission: { [REVIEW_TOOL]: "deny" } },
    },
  };
  applyCaretConfig(config);
  const agent = config.agent as Record<string, { permission: Record<string, string> }>;
  expect(agent.plan?.permission[REVIEW_TOOL]).toBe("ask");
  expect(agent.build?.permission[REVIEW_TOOL]).toBe("deny");
});

test("applyCaretConfig is idempotent and preserves existing config", () => {
  const config: Record<string, unknown> = {
    experimental: { primary_tools: ["other_tool"] },
    agent: { plan: { mode: "primary", permission: { edit: "allow" } } },
  };
  applyCaretConfig(config);
  applyCaretConfig(config);
  const pt = (config.experimental as { primary_tools: string[] }).primary_tools;
  expect(pt).toEqual(["other_tool", REVIEW_TOOL]);
  const plan = (config.agent as { plan: { mode: string; permission: Record<string, string> } })
    .plan;
  expect(plan.mode).toBe("primary");
  expect(plan.permission.edit).toBe("allow");
  expect(plan.permission[REVIEW_TOOL]).toBe("allow");
});

test("applyCaretConfig defensively replaces a non-object agent permission", () => {
  // OpenCode allows an agent's `permission` to be a bare action string; spreading
  // it would corrupt the map, so the helper normalizes it to an object first.
  const config: Record<string, unknown> = { agent: { plan: { permission: "deny" } } };
  applyCaretConfig(config);
  const plan = (config.agent as { plan: { permission: Record<string, string> } }).plan;
  expect(typeof plan.permission).toBe("object");
  expect(plan.permission["*"]).toBe("deny"); // the bare action survives as a catch-all
  expect(plan.permission[REVIEW_TOOL]).toBe("allow");
});

// --- the assembled plugin: tool.execute end-to-end with a stubbed runner ---

const PLANS_DIR = "/data/opencode/plans";

async function buildHooks(run: SpawnRunner, client?: PluginInput["client"]) {
  const plugin = createCaretPlugin({ bin: "caret", run, plansDir: PLANS_DIR });
  return await plugin({ client } as unknown as PluginInput);
}

// Minimal ToolContext stub — an inline-plan execute() only reads agent/sessionID/directory.
function ctx(agent: string): ToolContext {
  return { agent, sessionID: "S", directory: "/p" } as unknown as ToolContext;
}

test("the review tool runs `<bin> review` as the opencode agent", async () => {
  const calls: Array<{ command: string[]; agent: string | undefined }> = [];
  const hooks = await buildHooks(
    stubRunner(`{"behavior":"allow"}`, (command, env) => {
      calls.push({ command, agent: env.CARET_AGENT });
    }),
  );
  await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P" }, ctx("plan"));
  expect(calls).toEqual([{ command: ["caret", "review"], agent: "opencode" }]);
});

test("the review tool denies by naming itself as the tool to call again", async () => {
  const hooks = await buildHooks(stubRunner(`{"behavior":"deny","feedback":"narrow it"}`));
  const out = await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P" }, ctx("plan"));
  expect(String(out)).toContain(`\`${REVIEW_TOOL}\``);
});

test("the review tool approves: a plan-agent call returns the approved message", async () => {
  const hooks = await buildHooks(stubRunner(`{"behavior":"allow"}`));
  const execute = hooks.tool?.[REVIEW_TOOL]?.execute;
  expect(execute).toBeDefined();
  const out = await execute?.({ plan: "# P" }, ctx("plan"));
  expect(String(out).toLowerCase()).toContain("approv");
});

test("the review tool denies: a plan-agent call returns the feedback", async () => {
  const hooks = await buildHooks(stubRunner(`{"behavior":"deny","feedback":"narrow it"}`));
  const out = await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P\nbody" }, ctx("plan"));
  expect(String(out)).toContain("narrow it");
});

const planDirs: string[] = [];
afterAll(() => {
  for (const dir of planDirs) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway session directory holding `rel` with `text`, for path-arg reviews. */
function planDir(text: string, rel = "plans/plan.md"): { directory: string; planFilePath: string } {
  const directory = fakeDistDir("caret-plan-path-", { [rel]: text });
  planDirs.push(directory);
  return { directory, planFilePath: join(directory, rel) };
}

type AskInput = Parameters<ToolContext["ask"]>[0];

/** A plan-agent ToolContext for a path review: `directory` doubles as the worktree
 * unless one is given, and OpenCode's permission `ask` grants unless stubbed. */
function pathCtx(
  directory: string,
  ask: ToolContext["ask"] = async () => {},
  worktree = directory,
): ToolContext {
  return { ...ctx("plan"), directory, worktree, ask };
}

test("a path review sends the file's text and its absolute path in the envelope", async () => {
  const { directory, planFilePath } = planDir("# From disk\n");
  const stdins: string[] = [];
  const hooks = await buildHooks(
    stubRunner(`{"behavior":"allow"}`, (_command, _env, stdin) => stdins.push(stdin)),
  );
  await hooks.tool?.[REVIEW_TOOL]?.execute?.({ path: "plans/plan.md" }, pathCtx(directory));
  expect(JSON.parse(stdins[0] ?? "{}").tool_input).toMatchObject({
    plan: "# From disk\n",
    planFilePath,
  });
});

test("a path review's change request names the file and asks for a re-read", async () => {
  const { directory, planFilePath } = planDir("# P\n");
  const hooks = await buildHooks(stubRunner(`{"behavior":"deny","feedback":"narrow it"}`));
  const out = String(
    await hooks.tool?.[REVIEW_TOOL]?.execute?.({ path: planFilePath }, pathCtx(directory)),
  );
  expect(out).toContain(planFilePath);
  expect(out.toLowerCase()).toContain("re-read");
});

test("a path review asks OpenCode for edit permission on the file, relative to the worktree", async () => {
  const { directory: worktree, planFilePath } = planDir("# P\n", "sub/plans/plan.md");
  const asks: AskInput[] = [];
  const hooks = await buildHooks(stubRunner(`{"behavior":"allow"}`));
  await hooks.tool?.[REVIEW_TOOL]?.execute?.(
    { path: "plans/plan.md" },
    pathCtx(join(worktree, "sub"), async (input) => void asks.push(input), worktree),
  );
  expect(asks).toEqual([
    {
      permission: "edit",
      patterns: ["sub/plans/plan.md"],
      always: ["*"],
      metadata: { filepath: planFilePath },
    },
  ]);
});

test("a path review denied edit permission returns an error without spawning caret", async () => {
  const { directory, planFilePath } = planDir("# P\n");
  const spawns: unknown[] = [];
  const hooks = await buildHooks(stubRunner(`{"behavior":"allow"}`, () => spawns.push(1)));
  const out = await hooks.tool?.[REVIEW_TOOL]?.execute?.(
    { path: "plans/plan.md" },
    pathCtx(directory, () => Promise.reject(new Error("rejected"))),
  );
  expect(spawns).toEqual([]);
  expect(String(out)).toContain(planFilePath);
  expect(String(out)).toContain(PLANS_DIR);
});

test("an inline plan review never asks for a permission", async () => {
  const asks: AskInput[] = [];
  const hooks = await buildHooks(stubRunner(`{"behavior":"allow"}`));
  await hooks.tool?.[REVIEW_TOOL]?.execute?.(
    { plan: "# P" },
    { ...ctx("plan"), ask: async (input) => void asks.push(input) },
  );
  expect(asks).toEqual([]);
});

test("a path review of an unreadable file returns the error without spawning caret", async () => {
  const spawns: unknown[] = [];
  const hooks = await buildHooks(stubRunner(`{"behavior":"allow"}`, () => spawns.push(1)));
  const out = await hooks.tool?.[REVIEW_TOOL]?.execute?.(
    { path: "/nonexistent/plan.md" },
    pathCtx("/p"),
  );
  expect(spawns).toEqual([]);
  expect(String(out)).toContain("/nonexistent/plan.md");
});

test("a path review of a FIFO returns the error without spawning caret", async () => {
  // Reading a FIFO blocks until a writer opens it, which would freeze OpenCode's event loop.
  const directory = fakeDistDir("caret-plan-fifo-", {});
  planDirs.push(directory);
  const fifo = join(directory, "plan.md");
  expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
  // A waiting writer, so a regression that reads the FIFO fails here instead of hanging the suite.
  const writer = Bun.spawn(["sh", "-c", `printf '# P' > '${fifo}'`]);
  const spawns: unknown[] = [];
  const hooks = await buildHooks(stubRunner(`{"behavior":"allow"}`, () => spawns.push(1)));
  const out = await hooks.tool?.[REVIEW_TOOL]?.execute?.({ path: "plan.md" }, pathCtx(directory));
  writer.kill();
  expect(spawns).toEqual([]);
  expect(String(out)).toContain(fifo);
});

// A plugin client whose `session.get` is `get` — the one call the review tool's
// subagent check makes. `get` may resolve a payload, reject, or throw.
function sessionClient(get: (opts: { path: { id: string } }) => unknown): PluginInput["client"] {
  return { session: { get } } as unknown as PluginInput["client"];
}

test("the review tool refuses a subagent caller (a child session) without spawning caret", async () => {
  let spawned = false;
  const run: SpawnRunner = async () => {
    spawned = true;
    return { stdout: `{"behavior":"allow"}`, exitCode: 0 };
  };
  const asked: string[] = [];
  const hooks = await buildHooks(
    run,
    sessionClient((opts) => {
      asked.push(opts.path.id);
      return Promise.resolve({ data: { parentID: "parent-session" } });
    }),
  );
  const out = await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P" }, ctx("build"));
  expect(spawned).toBe(false);
  expect(asked).toEqual(["S"]); // the CALLING session is the one asked about
  expect(String(out)).toContain(REVIEW_TOOL);
  expect(String(out).toLowerCase()).toContain("subagent");
});

test("the review tool proceeds for any primary caller — build and a user-defined agent", async () => {
  const client = sessionClient(() => Promise.resolve({ data: { parentID: null } }));
  // execute() deliberately does not consult context.agent; both names are here to
  // pin the requirement (any primary agent), not because they drive distinct paths.
  for (const agent of ["build", "refine"]) {
    const hooks = await buildHooks(stubRunner(`{"behavior":"allow"}`), client);
    const out = await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P" }, ctx(agent));
    expect(String(out).toLowerCase()).toContain("approv");
  }
});

test("the review tool proceeds when the session read fails — allow, not deny", async () => {
  // experimental.primary_tools is the enforcing gate; this in-body check is only
  // second-line defense, so an unreadable session must not cost every primary
  // caller the tool. Deliberately the opposite of the fail-safe DENY that governs
  // review decisions.
  const clients: Array<PluginInput["client"]> = [
    {} as unknown as PluginInput["client"], // session.get absent (SDK skew)
    sessionClient(() => Promise.reject(new Error("request blew up"))),
    sessionClient(() => Promise.resolve({ data: undefined, error: { message: "not found" } })),
  ];
  for (const client of clients) {
    const hooks = await buildHooks(stubRunner(`{"behavior":"allow"}`), client);
    const out = await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P" }, ctx("build"));
    expect(String(out).toLowerCase()).toContain("approv");
  }
});

test("the review tool shows the pending review URL as a toast, then clears it on approval (EXC-691)", async () => {
  const url = "http://caret.localhost:42718/?review=live";
  const { client, toasts } = recordingClient();
  const hooks = await buildHooks(
    streamingRunner(`{"behavior":"allow"}`, [`caret: review this plan at ${url}\n`]),
    client,
  );
  await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P" }, ctx("plan"));
  // First: the review-link toast while pending — the URL is the message ALONE so it
  // lands on its own full-width line and stays terminal-clickable. Then: a decision
  // toast that supersedes it (single-slot surface, no hide API).
  expect(toasts[0]?.title).toBe("caret: review this plan");
  expect(toasts[0]?.message).toBe(url);
  expect(toasts[0]?.variant).toBe("info");
  expect(toasts).toHaveLength(2);
  expect(toasts[1]?.message.toLowerCase()).toContain("approv");
});

test("the review tool clears the link with a changes-requested toast on deny (EXC-691)", async () => {
  const url = "http://caret.localhost:42718/?review=deny";
  const { client, toasts } = recordingClient();
  const hooks = await buildHooks(
    streamingRunner(`{"behavior":"deny","feedback":"narrow it"}`, [
      `caret: review this plan at ${url}\n`,
    ]),
    client,
  );
  await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P" }, ctx("plan"));
  expect(toasts[0]?.message).toBe(url);
  expect(toasts[1]?.message.toLowerCase()).toContain("change");
});

test("the review tool shows no toast when no review URL is surfaced", async () => {
  const { client, toasts } = recordingClient();
  // stubRunner emits no stderr, so onUrl never fires and no toast is shown.
  const hooks = await buildHooks(stubRunner(`{"behavior":"allow"}`), client);
  await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P" }, ctx("plan"));
  expect(toasts).toEqual([]);
});

test("the review tool does not crash when the client lacks tui.showToast (SDK skew)", async () => {
  const url = "http://caret.localhost:42718/?review=noguard";
  // A client with no `tui` — the guard must skip the toast, not throw.
  const hooks = await buildHooks(
    streamingRunner(`{"behavior":"allow"}`, [`caret: review this plan at ${url}\n`]),
    {} as unknown as PluginInput["client"],
  );
  const out = await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P" }, ctx("plan"));
  expect(String(out).toLowerCase()).toContain("approv");
});

test("the config hook restricts the tool to primary agents", async () => {
  const hooks = await buildHooks(stubRunner("{}"));
  const config: Record<string, unknown> = {};
  await hooks.config?.(config as never);
  expect((config.experimental as { primary_tools: string[] }).primary_tools).toContain(REVIEW_TOOL);
});

// --- the system-transform steer (plan-agent only) ---
//
// system.transform receives only { sessionID?, model } — no agent — and chat.params,
// which does carry the agent, fires AFTER it in the same request prep. So the steer
// is gated on an agent recorded by chat.message, the one hook carrying both.

/** Runs the system-transform hook (optionally with a sessionID) against a fresh
 * `{ system: ["base"] }` output and returns the resulting `system` array. */
async function steeredSystem(
  hooks: Awaited<ReturnType<typeof buildHooks>>,
  sessionID?: string,
): Promise<string[]> {
  const output = { system: ["base"] };
  await hooks["experimental.chat.system.transform"]?.(
    (sessionID === undefined ? { model: {} } : { sessionID, model: {} }) as never,
    output as never,
  );
  return output.system;
}

test("the system-transform hook injects the planning steer for a plan-agent session", async () => {
  const hooks = await buildHooks(stubRunner("{}"));
  await hooks["chat.message"]?.({ sessionID: "S", agent: "plan" } as never, {} as never);
  const steer = (await steeredSystem(hooks, "S")).join("\n");
  expect(steer).toContain(REVIEW_TOOL);
  expect(steer).toContain(PLANS_DIR);
});

test.each([
  ["a non-planning agent's session", [{ sessionID: "S", agent: "build" }]],
  [
    "a session whose agent switched to build",
    [
      { sessionID: "S", agent: "plan" },
      { sessionID: "S", agent: "build" },
    ],
  ],
])("the system-transform hook pushes nothing for %s", async (_label, messages) => {
  const hooks = await buildHooks(stubRunner("{}"));
  for (const message of messages) await hooks["chat.message"]?.(message as never, {} as never);
  expect(await steeredSystem(hooks, "S")).toEqual(["base"]);
});

test("the system-transform hook pushes nothing when there is no sessionID", async () => {
  // OpenCode calls system.transform from a second site (Agent.generate, for
  // generating an agent config) with no session at all — the steer must not leak
  // into that unrelated prompt.
  const hooks = await buildHooks(stubRunner("{}"));
  await hooks["chat.message"]?.({ sessionID: "S", agent: "plan" } as never, {} as never);
  expect(await steeredSystem(hooks)).toEqual(["base"]);
});

test("the system-transform hook pushes nothing for a session chat.message never saw", async () => {
  const hooks = await buildHooks(stubRunner("{}"));
  expect(await steeredSystem(hooks, "unseen")).toEqual(["base"]);
});

test("a chat.message with an unknown agent does not clobber the recorded one", async () => {
  const hooks = await buildHooks(stubRunner("{}"));
  await hooks["chat.message"]?.({ sessionID: "S", agent: "plan" } as never, {} as never);
  await hooks["chat.message"]?.({ sessionID: "S" } as never, {} as never);
  expect((await steeredSystem(hooks, "S")).join("\n")).toContain(REVIEW_TOOL);
});

test("the tool.definition hook redirects plan_exit to the review tool", async () => {
  const hooks = await buildHooks(stubRunner("{}"));
  const output = { description: "original", parameters: {} };
  await hooks["tool.definition"]?.({ toolID: "plan_exit" } as never, output as never);
  expect(output.description).toContain(REVIEW_TOOL);
});

// --- the chat.message warm hook (plan-agent daemon prewarm) ---

/** Assemble the plugin with a recording warm runner, so the chat.message hook's
 * spawn decision is observable without a real `caret prewarm` process. */
async function buildWarmHooks(warm: WarmRunner) {
  const plugin = createCaretPlugin({ bin: "caret", run: stubRunner("{}"), warm });
  return await plugin({} as unknown as PluginInput);
}

/** A chat.message hook input addressed to `agent` (undefined ⇒ unknown caller). */
function message(agent: string | undefined) {
  return { sessionID: "S", agent } as never;
}

test("the chat.message hook warms the daemon for a plan-agent message", async () => {
  const warmed: string[] = [];
  const hooks = await buildWarmHooks((bin) => warmed.push(bin));
  await hooks["chat.message"]?.(message("plan"), {} as never);
  expect(warmed).toEqual(["caret"]);
});

test("the chat.message hook does not warm for a non-planning or unknown agent", async () => {
  const warmed: string[] = [];
  const hooks = await buildWarmHooks((bin) => warmed.push(bin));
  await hooks["chat.message"]?.(message("build"), {} as never);
  await hooks["chat.message"]?.(message(undefined), {} as never);
  expect(warmed).toEqual([]);
});

test("the chat.message hook swallows a warm failure (best-effort, never disrupts the turn)", async () => {
  const hooks = await buildWarmHooks(() => {
    throw new Error("spawn blew up");
  });
  await expect(hooks["chat.message"]?.(message("plan"), {} as never)).resolves.toBeUndefined();
});

// The two below drive the REAL nodeWarmRunner (no injected warm), because its
// contract lives entirely in the spawn options the DI seam hides: the async
// 'error' handler and the CARET_AGENT the child inherits. A stubbed runner can
// pin neither.

/** Assemble the plugin against a real binary path, with the production warm runner. */
async function buildRealWarmHooks(bin: string) {
  return await createCaretPlugin({ bin, run: stubRunner("{}") })({} as unknown as PluginInput);
}

test("the real warm runner survives a bad caret binary (async spawn error)", async () => {
  // spawn emits 'error' (ENOENT) ASYNCHRONOUSLY, so the hook's synchronous
  // try/catch cannot see it — without nodeWarmRunner's own 'error' handler this
  // is an uncaught exception that kills the host process.
  const hooks = await buildRealWarmHooks("/nonexistent/caret-838");
  await hooks["chat.message"]?.(message("plan"), {} as never);
  await Bun.sleep(150);
  // Reaching this line at all is the assertion: an unhandled 'error' event would
  // have taken the runner down before it.
  await expect(hooks["chat.message"]?.(message("plan"), {} as never)).resolves.toBeUndefined();
});

test("the real warm runner runs `prewarm` with CARET_AGENT=opencode", async () => {
  // The warm spawns the daemon, and the daemon picks its adapter from CARET_AGENT.
  // Omitting it stands up a claude-flavored daemon that the later `caret review`
  // reuses, offering OpenCode reviewers Claude's approve variants.
  const dir = mkdtempSync(join(tmpdir(), "caret-warm-"));
  const out = join(dir, "argv");
  const shim = join(dir, "shim");
  writeFileSync(shim, `#!/bin/sh\nprintf '%s %s' "$1" "$CARET_AGENT" > ${out}\n`);
  chmodSync(shim, 0o755);

  const hooks = await buildRealWarmHooks(shim);
  await hooks["chat.message"]?.(message("plan"), {} as never);
  // The `>` creates the file empty and the lone printf lands in one write, so wait on non-empty.
  expect(await until(() => existsSync(out) && readFileSync(out, "utf-8") !== "")).toBe(true);
  expect(readFileSync(out, "utf-8")).toBe("prewarm opencode");
});
