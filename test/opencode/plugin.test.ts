// Unit coverage for caret's OpenCode plugin (the opencode/ packaging). The plugin
// is an in-process OpenCode module: it registers a plan-review tool, steers the
// plan agent to call it, restricts it to primary agents (subagent-bypass
// mitigation), and bridges to `caret review` (CARET_AGENT=opencode) by spawning it
// with a caret-defined envelope on stdin and reading the flat decision JSON back.
// These tests exercise the pure logic + the tool's execute() through an injected
// spawn runner (no real OpenCode, no real `caret review` process).

import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { PluginInput, ToolContext } from "@opencode-ai/plugin";

import {
  applyCaretConfig,
  approvedMessage,
  buildEnvelope,
  createCaretPlugin,
  deniedMessage,
  isPlanningAgent,
  parseDecision,
  parseReviewUrl,
  planningSteer,
  planTitle,
  REVIEW_TOOL,
  runReviewViaCaret,
  type SpawnRunner,
  type WarmRunner,
} from "@opencode/caret.plugin.ts";
import { recordingClient } from "@test/support/opencode-toast-client.ts";
import { until } from "@test/support/poll.ts";

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

test("parseDecision preserves reviewer notes on an allow (EXC-791)", () => {
  expect(parseDecision(`{"behavior":"allow","feedback":"use the retry helper"}`)).toEqual({
    behavior: "allow",
    feedback: "use the retry helper",
  });
});

test("parseDecision drops a blank note on an allow", () => {
  expect(parseDecision(`{"behavior":"allow","feedback":"  "}`)).toEqual({ behavior: "allow" });
});

test("parseDecision fails safe to a deny on unparseable output", () => {
  const d = parseDecision("not json at all");
  expect(d.behavior).toBe("deny");
  expect(d.feedback).toBeTruthy();
});

test("parseDecision fails safe to a deny on empty output", () => {
  expect(parseDecision("   \n").behavior).toBe("deny");
});

// --- isPlanningAgent (steer + warm gate) ---

test("isPlanningAgent matches the plan agent only", () => {
  expect(isPlanningAgent("plan")).toBe(true);
  expect(isPlanningAgent("build")).toBe(false);
  expect(isPlanningAgent(undefined)).toBe(false);
  expect(isPlanningAgent("general")).toBe(false);
});

// --- messages ---

test("approvedMessage tells the agent to proceed", () => {
  expect(approvedMessage().toLowerCase()).toContain("approv");
});

test("approvedMessage folds reviewer notes into the proceed message (EXC-791)", () => {
  const msg = approvedMessage("use the retry helper");
  expect(msg.toLowerCase()).toContain("approv");
  expect(msg).toContain("## Notes from the user");
  expect(msg).toContain("use the retry helper");
  // The plan is already approved — the agent folds the notes in without re-planning.
  expect(msg.toLowerCase()).toContain("no need to re-plan");
});

test("approvedMessage without notes stays the bare proceed message", () => {
  expect(approvedMessage()).not.toContain("Notes from the user");
});

test("deniedMessage carries the feedback and resubmit instruction, without echoing the plan", () => {
  const msg = deniedMessage("narrow step 2");
  expect(msg).toContain("narrow step 2");
  expect(msg).toContain("requested CHANGES");
  expect(msg).toContain(REVIEW_TOOL);
  expect(msg).not.toContain("Current plan");
});

test("planningSteer names the review tool and steers away from plan_exit", () => {
  const s = planningSteer();
  expect(s).toContain(REVIEW_TOOL);
  expect(s.toLowerCase()).toContain("plan_exit");
});

// --- parseReviewUrl (review-link surfacing, EXC-691) ---

test("parseReviewUrl extracts the review URL from caret's stderr line", () => {
  const url = "http://caret.localhost:42718/?review=abc123";
  expect(parseReviewUrl(`caret: review this plan at ${url}\n`)).toBe(url);
});

test("parseReviewUrl returns undefined when the line is absent", () => {
  expect(parseReviewUrl("some unrelated stderr\n")).toBeUndefined();
  expect(parseReviewUrl("")).toBeUndefined();
});

test("parseReviewUrl waits for the whole line — a URL not yet newline-terminated does not match", () => {
  // A mid-stream stderr chunk cut off before the trailing newline must not yield a
  // truncated URL; the match requires the whitespace core always writes after it.
  expect(parseReviewUrl("caret: review this plan at http://caret.localhost:4271")).toBeUndefined();
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

// A runner that streams the given stderr chunks (as the real child does) before
// resolving with the decision on stdout — exercises the review-link surfacing.
function streamingRunner(stdout: string, stderrChunks: string[]): SpawnRunner {
  return async (_bin, _env, _stdin, onStderr) => {
    for (const chunk of stderrChunks) onStderr?.(chunk);
    return { stdout, exitCode: 0 };
  };
}

test("runReviewViaCaret surfaces the review URL via onUrl when the child streams it on stderr", async () => {
  const url = "http://caret.localhost:42718/?review=xyz";
  const seen: string[] = [];
  const decision = await runReviewViaCaret("{}", {
    bin: "caret",
    run: streamingRunner(`{"behavior":"allow"}`, [`caret: review this plan at ${url}\n`]),
    onUrl: (u) => seen.push(u),
  });
  expect(seen).toEqual([url]);
  expect(decision).toEqual({ behavior: "allow" });
});

test("runReviewViaCaret fires onUrl once even when the URL line arrives split across chunks", async () => {
  const url = "http://caret.localhost:42718/?review=split";
  const seen: string[] = [];
  await runReviewViaCaret("{}", {
    bin: "caret",
    run: streamingRunner(`{"behavior":"allow"}`, ["caret: review this ", `plan at ${url}\n`]),
    onUrl: (u) => seen.push(u),
  });
  expect(seen).toEqual([url]);
});

test("runReviewViaCaret never calls onUrl when no review URL appears on stderr", async () => {
  const seen: string[] = [];
  await runReviewViaCaret("{}", {
    bin: "caret",
    run: streamingRunner(`{"behavior":"allow"}`, ["unrelated diagnostic noise\n"]),
    onUrl: (u) => seen.push(u),
  });
  expect(seen).toEqual([]);
});

test("runReviewViaCaret reassembles a URL split mid-URL across stderr chunks", async () => {
  const url = "http://caret.localhost:42718/?review=midsplit";
  const seen: string[] = [];
  await runReviewViaCaret("{}", {
    bin: "caret",
    run: streamingRunner(`{"behavior":"allow"}`, [
      "caret: review this plan at http://caret.localhost:42718/?rev",
      "iew=midsplit\n",
    ]),
    onUrl: (u) => seen.push(u),
  });
  expect(seen).toEqual([url]);
});

test("runReviewViaCaret still returns the decision when onUrl throws (never crashes the review)", async () => {
  const decision = await runReviewViaCaret("{}", {
    bin: "caret",
    run: streamingRunner(`{"behavior":"allow"}`, [
      "caret: review this plan at http://caret.localhost:42718/?review=boom\n",
    ]),
    onUrl: () => {
      throw new Error("toast surface blew up");
    },
  });
  expect(decision).toEqual({ behavior: "allow" });
});

// --- the assembled plugin: tool.execute end-to-end with a stubbed runner ---

async function buildHooks(run: SpawnRunner, client?: PluginInput["client"]) {
  const plugin = createCaretPlugin({ bin: "caret", run });
  return await plugin({ client } as unknown as PluginInput);
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

test("the review tool denies: a plan-agent call returns the feedback without echoing the plan", async () => {
  const hooks = await buildHooks(stubRunner(`{"behavior":"deny","feedback":"narrow it"}`));
  const out = await hooks.tool?.[REVIEW_TOOL]?.execute?.({ plan: "# P\nbody" }, ctx("plan"));
  expect(String(out)).toContain("narrow it");
  expect(String(out)).not.toContain("body");
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
  expect((await steeredSystem(hooks, "S")).join("\n")).toContain(REVIEW_TOOL);
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
