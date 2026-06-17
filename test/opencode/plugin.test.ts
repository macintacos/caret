// Unit coverage for caret's OpenCode plugin (the opencode/ packaging). The plugin
// is an in-process OpenCode module: it registers a plan-review tool, steers the
// plan agent to call it, restricts it to primary agents (subagent-bypass
// mitigation), and bridges to `caret review` (CARET_AGENT=opencode) by spawning it
// with a caret-defined envelope on stdin and reading the flat decision JSON back.
// These tests exercise the pure logic + the tool's execute() through an injected
// spawn runner (no real OpenCode, no real `caret review` process).

import { expect, test } from "bun:test";
import {
  applyCaretConfig,
  approvedMessage,
  buildEnvelope,
  createCaretPlugin,
  deniedMessage,
  isPlanningAgent,
  parseDecision,
  planningSteer,
  planTitle,
  REVIEW_TOOL,
  runReviewViaCaret,
  type SpawnRunner,
} from "../../opencode/caret.plugin.ts";
import type { PluginInput, ToolContext } from "@opencode-ai/plugin";

// --- buildEnvelope / planTitle ---

test("buildEnvelope produces the caret review envelope the opencode adapter parses", () => {
  const env = JSON.parse(
    buildEnvelope("# Ship it\n\nbody", { sessionID: "S", directory: "/proj" }),
  );
  expect(env).toEqual({
    session_id: "S",
    cwd: "/proj",
    tool_input: { plan: "# Ship it\n\nbody", title: "Ship it" },
  });
});

test("planTitle pulls the first markdown heading, else undefined", () => {
  expect(planTitle("# Add status endpoint\n\nsteps")).toBe("Add status endpoint");
  expect(planTitle("no heading here")).toBeUndefined();
});

// --- parseDecision (fail-safe) ---

test("parseDecision reads an allow decision", () => {
  expect(parseDecision(`{"behavior":"allow"}`)).toEqual({ behavior: "allow" });
});

test("parseDecision reads a deny decision with feedback", () => {
  expect(parseDecision(`{"behavior":"deny","feedback":"tighten scope"}`)).toEqual({
    behavior: "deny",
    feedback: "tighten scope",
  });
});

test("parseDecision uses the LAST json line (ignores stray earlier output)", () => {
  expect(parseDecision(`some noise\n{"behavior":"allow"}\n`)).toEqual({ behavior: "allow" });
});

test("parseDecision fails safe to a deny on unparseable output", () => {
  const d = parseDecision("not json at all");
  expect(d.behavior).toBe("deny");
  expect(d.feedback).toBeTruthy();
});

test("parseDecision fails safe to a deny on empty output", () => {
  expect(parseDecision("   \n").behavior).toBe("deny");
});

// --- isPlanningAgent (subagent guard) ---

test("isPlanningAgent allows the plan agent only", () => {
  expect(isPlanningAgent("plan")).toBe(true);
  expect(isPlanningAgent("build")).toBe(false);
  expect(isPlanningAgent(undefined)).toBe(false);
  expect(isPlanningAgent("general")).toBe(false);
});

// --- messages ---

test("approvedMessage tells the agent to proceed", () => {
  expect(approvedMessage().toLowerCase()).toContain("approv");
});

test("deniedMessage carries the feedback and a line-numbered plan for revision", () => {
  const msg = deniedMessage("narrow step 2", "line one\nline two");
  expect(msg).toContain("narrow step 2");
  expect(msg).toContain(REVIEW_TOOL); // tells the agent to resubmit
  expect(msg).toContain("1"); // line numbers
  expect(msg).toContain("line two");
});

test("planningSteer names the review tool and steers away from plan_exit", () => {
  const s = planningSteer();
  expect(s).toContain(REVIEW_TOOL);
  expect(s.toLowerCase()).toContain("plan_exit");
});

// --- applyCaretConfig (subagent-bypass mitigation) ---

test("applyCaretConfig restricts the tool to primary agents and allows only the planner", () => {
  const config: Record<string, unknown> = {};
  applyCaretConfig(config);
  expect((config.experimental as { primary_tools: string[] }).primary_tools).toContain(REVIEW_TOOL);
  const agent = config.agent as {
    plan: { permission: Record<string, string> };
    build: { permission: Record<string, string> };
  };
  expect(agent.plan.permission[REVIEW_TOOL]).toBe("allow");
  expect(agent.build.permission[REVIEW_TOOL]).toBe("deny");
});

test("applyCaretConfig is idempotent and preserves existing config", () => {
  const config: Record<string, unknown> = {
    experimental: { primary_tools: ["other_tool"] },
    agent: { plan: { mode: "primary", permission: { edit: "allow" } } },
  };
  applyCaretConfig(config);
  applyCaretConfig(config); // second pass must not duplicate
  const pt = (config.experimental as { primary_tools: string[] }).primary_tools;
  expect(pt).toEqual(["other_tool", REVIEW_TOOL]);
  const plan = (config.agent as { plan: { mode: string; permission: Record<string, string> } })
    .plan;
  expect(plan.mode).toBe("primary"); // preserved
  expect(plan.permission.edit).toBe("allow"); // preserved
  expect(plan.permission[REVIEW_TOOL]).toBe("allow");
});

test("applyCaretConfig defensively replaces a non-object agent permission", () => {
  // OpenCode allows an agent's `permission` to be a bare action string; spreading
  // it would corrupt the map, so the helper normalizes it to an object first.
  const config: Record<string, unknown> = { agent: { build: { permission: "deny" } } };
  applyCaretConfig(config);
  const build = (config.agent as { build: { permission: Record<string, string> } }).build;
  expect(typeof build.permission).toBe("object");
  expect(build.permission[REVIEW_TOOL]).toBe("deny");
});

// --- runReviewViaCaret (the spawn bridge) ---

function stubRunner(
  stdout: string,
  capture?: (bin: string, env: Record<string, string | undefined>, stdin: string) => void,
): SpawnRunner {
  return async (bin, env, stdin) => {
    capture?.(bin, env, stdin);
    return { stdout, exitCode: 0 };
  };
}

test("runReviewViaCaret spawns caret with CARET_AGENT=opencode and the envelope on stdin", async () => {
  let seenBin = "";
  let seenAgent: string | undefined;
  let seenStdin = "";
  const run = stubRunner(`{"behavior":"allow"}`, (bin, env, stdin) => {
    seenBin = bin;
    seenAgent = env.CARET_AGENT;
    seenStdin = stdin;
  });
  const decision = await runReviewViaCaret(`{"x":1}`, { bin: "/path/to/caret", run });
  expect(decision).toEqual({ behavior: "allow" });
  expect(seenBin).toBe("/path/to/caret");
  expect(seenAgent).toBe("opencode");
  expect(seenStdin).toBe(`{"x":1}`);
});

test("runReviewViaCaret returns the deny+feedback decision", async () => {
  const decision = await runReviewViaCaret("{}", {
    bin: "caret",
    run: stubRunner(`{"behavior":"deny","feedback":"redo"}`),
  });
  expect(decision).toEqual({ behavior: "deny", feedback: "redo" });
});

test("runReviewViaCaret fails safe to a deny when the spawn throws", async () => {
  const run: SpawnRunner = async () => {
    throw new Error("ENOENT");
  };
  const decision = await runReviewViaCaret("{}", { bin: "caret", run });
  expect(decision.behavior).toBe("deny");
  expect(decision.feedback).toContain("ENOENT");
});

// --- the assembled plugin: tool.execute end-to-end with a stubbed runner ---

async function buildHooks(run: SpawnRunner) {
  const plugin = createCaretPlugin({ bin: "caret", run });
  // caret's hooks never read the PluginInput; a minimal stub suffices.
  return await plugin({} as unknown as PluginInput);
}

// Minimal ToolContext stub — execute() only reads agent/sessionID/directory.
function ctx(agent: string): ToolContext {
  return { agent, sessionID: "S", directory: "/p" } as unknown as ToolContext;
}

test("the review tool approves: a plan-agent call returns the approved message", async () => {
  const hooks = await buildHooks(stubRunner(`{"behavior":"allow"}`));
  const execute = hooks.tool?.[REVIEW_TOOL]?.execute;
  expect(execute).toBeDefined();
  const out = await execute?.({ plan: "# P" }, ctx("plan"));
  expect(String(out).toLowerCase()).toContain("approv");
});

test("the review tool denies: a plan-agent call returns the feedback + plan", async () => {
  const hooks = await buildHooks(stubRunner(`{"behavior":"deny","feedback":"narrow it"}`));
  const out = await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P\nbody" }, ctx("plan"));
  expect(String(out)).toContain("narrow it");
});

test("the review tool refuses a non-planning (subagent) caller without spawning caret", async () => {
  let spawned = false;
  const run: SpawnRunner = async () => {
    spawned = true;
    return { stdout: `{"behavior":"allow"}`, exitCode: 0 };
  };
  const hooks = await buildHooks(run);
  const out = await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P" }, ctx("general"));
  expect(spawned).toBe(false);
  expect(String(out)).toContain(REVIEW_TOOL);
});

test("the config hook restricts the tool to primary agents", async () => {
  const hooks = await buildHooks(stubRunner("{}"));
  const config: Record<string, unknown> = {};
  await hooks.config?.(config as never);
  expect((config.experimental as { primary_tools: string[] }).primary_tools).toContain(REVIEW_TOOL);
});

test("the system-transform hook injects the planning steer", async () => {
  const hooks = await buildHooks(stubRunner("{}"));
  const output = { system: ["base"] };
  await hooks["experimental.chat.system.transform"]?.({ model: {} } as never, output as never);
  expect(output.system.join("\n")).toContain(REVIEW_TOOL);
});

test("the tool.definition hook redirects plan_exit to the review tool", async () => {
  const hooks = await buildHooks(stubRunner("{}"));
  const output = { description: "original", parameters: {} };
  await hooks["tool.definition"]?.({ toolID: "plan_exit" } as never, output as never);
  expect(output.description).toContain(REVIEW_TOOL);
});
