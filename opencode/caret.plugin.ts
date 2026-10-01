// caret's OpenCode plugin (EXC-339). OpenCode is plugin-shaped, not command-hook
// shaped: it loads this in-process module and lets it register tools and mutate
// config. caret has no native plan-approval gate to intercept here (OpenCode has
// no ExitPlanMode equivalent), so this plugin REGISTERS its own plan-review tool,
// steers the Plan agent to call it, and runs the review synchronously inside the
// tool's execute() by spawning `caret review` (CARET_AGENT=opencode). The whole
// caret daemon/review pipeline is reused unchanged — this plugin is the
// OpenCode-side counterpart to Claude Code's hooks.json, which likewise spawns
// `caret review`. Its host-neutral parts live in caret.core.ts, shared with
// caret.plugin.v2.ts and caret.tui.ts.
//
// Subagent-bypass mitigation: OpenCode's tool.execute.before does not fire for
// subagent tool calls, so caret does NOT rely on a hook to gate subagents. The
// config hook marks the tool primary-only (experimental.primary_tools), which
// OpenCode turns into a deny rule on every subagent session it creates, and the
// tool body re-checks the calling session's shape — defense in depth. Any PRIMARY
// agent may ask for a review; only the plan agent is steered toward it.
//
// It ships in the @macintacos/caret npm package. `caret install` lists the package
// under v1's `plugin` config key or v2's `plugins` key (v2 reads both, legacy `plugin`
// first). OpenCode imports the package entry, index.ts, whose default
// `{ id, setup, server }` serves both SDKs: v2 runs `setup` (caret.plugin.v2.ts, plus
// caret.tui.ts from `exports["./tui"]`), and v1 (1.3.4+) runs `server`, which is this
// file's default. Its imports are node builtins, caret.core.ts, review-bridge.ts, and
// @opencode-ai/plugin (resolved by OpenCode at runtime). Which ctx/tool/config shapes are
// live-verified and which are not:
// doc/agents/opencode-integration.md § Verified vs. follow-up.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { relative } from "node:path";

import { type Hooks, type Plugin, tool } from "@opencode-ai/plugin";

import {
  decisionToast,
  isPlanningAgent,
  nodeWarmRunner,
  PLAN_ARG_DESCRIPTION,
  PLANNING_AGENTS,
  pathArgDescription,
  planningSteer,
  productionUpdateCheck,
  REVIEW_TOOL,
  REVIEW_TOOL_DESCRIPTION,
  resolveCaretBin,
  resolvePlansDir,
  reviewLinkToast,
  runPlanReview,
  type ToastBody,
  type ToastSink,
  toastBestEffort,
  type WarmRunner,
} from "./caret.core.ts";
import { nodeSpawnRunner, type SpawnRunner } from "./review-bridge.ts";

/** OpenCode's plugin client, structurally narrowed to the calls caret makes.
 * A structural type (rather than importing the SDK client) keeps this robust
 * against version skew between the pinned plugin SDK and the running OpenCode. */
export type ToastClient =
  | { tui?: { showToast?: (opts: { body: ToastBody }) => unknown } }
  | undefined;

/** The same client, narrowed to the session read the review tool's subagent check
 * makes — narrowed separately, and for the same skew-safety reason, so each helper
 * declares exactly the one call it performs. */
type SessionClient =
  | { session?: { get?: (opts: { path: { id: string } }) => unknown } }
  | undefined;

/** What OpenCode actually hands the plugin: both narrowings at once. */
type CaretClient = NonNullable<ToastClient> & NonNullable<SessionClient>;

/** Best-effort toast: surfacing or clearing the review link must never crash or
 * delay the review. Swallows a missing method (SDK skew) and any sync throw or
 * async rejection. Called as `tui.showToast(...)` so the SDK client keeps its
 * `this` binding. */
export function showToast(client: ToastClient, body: ToastBody): void {
  const tui = client?.tui;
  if (!tui || typeof tui.showToast !== "function") return;
  toastBestEffort((b) => tui.showToast?.({ body: b }), body);
}

/** True when this tool call arrived from a subagent — a `parentID` on the calling
 * session, which OpenCode's `task` tool always sets and an agent-name test cannot
 * see. Failure falls back to ALLOW, deliberately inverting this file's failsafeDeny
 * convention; both choices are argued in `doc/agents/opencode-integration.md` § The
 * subagent bypass. Not raced against a timeout: the call is loopback to OpenCode's
 * own server, so a hang is out of scope. Called as `session.get(...)` so the SDK
 * client keeps its `this` binding. */
async function isSubagentSession(client: SessionClient, sessionID: string): Promise<boolean> {
  const session = client?.session;
  if (!session || typeof session.get !== "function") return false;
  try {
    const res = (await session.get({ path: { id: sessionID } })) as {
      data?: { parentID?: unknown } | null;
    };
    return typeof res?.data?.parentID === "string";
  } catch {
    return false;
  }
}

// --- config-hook mutation (subagent-bypass mitigation) -------------------------

type LooseAgent = { mode?: string; permission?: unknown } & Record<string, unknown>;
type LooseConfig = {
  experimental?: { primary_tools?: string[] } & Record<string, unknown>;
  agent?: Record<string, LooseAgent>;
} & Record<string, unknown>;

/** Mutate the OpenCode config in place to mark the review tool primary-only, so
 * subagents cannot call it. Every primary agent may call it — OpenCode's base
 * ruleset permits an unknown tool id, so the absence of a per-agent entry is what
 * makes it available. The mechanism and the reasoning are in
 * `doc/agents/opencode-integration.md` § The subagent bypass.
 *
 * Idempotent and preservation-safe: existing primary_tools, agent modes, and other
 * permissions survive, as does a user's own entry for the review tool. */
export function applyCaretConfig(config: LooseConfig): void {
  config.experimental ??= {};
  const pt = Array.isArray(config.experimental.primary_tools)
    ? config.experimental.primary_tools
    : [];
  if (!pt.includes(REVIEW_TOOL)) config.experimental.primary_tools = [...pt, REVIEW_TOOL];

  for (const name of PLANNING_AGENTS) {
    // The plan agent is the one that depends on the tool, so rescue it from a
    // restrictive global `permission: { "*": "deny" }` — agent-level permission
    // merges after the global ruleset. Written only when the agent has no entry for
    // this tool id: a `"*"` catch-all is deliberately overridden, an explicit entry
    // for the tool is not.
    ensurePermission(ensureAgent(config, name))[REVIEW_TOOL] ??= "allow";
  }
}

function ensureAgent(config: LooseConfig, name: string): LooseAgent {
  config.agent ??= {};
  config.agent[name] ??= {};
  return config.agent[name];
}

/** Return the agent's permission map, normalizing the two degenerate shapes
 * OpenCode allows — a bare action string (preserved as a `"*"` catch-all) or an
 * absent/non-object value — so the assignment below never corrupts it. */
function ensurePermission(agent: LooseAgent): Record<string, unknown> {
  const p = agent.permission;
  if (typeof p === "string") agent.permission = { "*": p };
  else if (typeof p !== "object" || p === null) agent.permission = {};
  return agent.permission as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

/** Build the caret OpenCode plugin. The DI seam (bin/run/warm/checkUpdate/plansDir)
 * keeps the tool's execute(), the daemon warm, the planning steer, and the startup
 * update check unit-testable; the default export wires the production runners and
 * update checker. */
export function createCaretPlugin(
  opts: {
    bin?: string;
    run?: SpawnRunner;
    warm?: WarmRunner;
    checkUpdate?: (show: ToastSink) => void;
    plansDir?: string;
  } = {},
): Plugin {
  const bin = opts.bin ?? resolveCaretBin({ env: process.env, importMetaUrl: import.meta.url });
  const run = opts.run ?? nodeSpawnRunner;
  const warm = opts.warm ?? nodeWarmRunner;
  const plansDir =
    opts.plansDir ??
    resolvePlansDir({
      env: process.env,
      home: homedir(),
      readFile: (p) => readFileSync(p, "utf-8"),
    });

  return async (input) => {
    // The SDK client OpenCode hands every plugin — caret uses it for the review-link
    // toast (EXC-691) and to read the calling session's shape.
    const client = (input as { client?: CaretClient }).client;
    // Startup update nudge (EXC-794), fire-and-forget. Only the production default
    // export wires this.
    if (opts.checkUpdate) opts.checkUpdate((body) => showToast(client, body));
    // The agent driving each session, recorded by chat.message and read by
    // system.transform, which carries no agent of its own. Why a map is the only
    // route: `doc/agents/opencode-integration.md` § Why gating the steer needs a
    // session→agent map. One instance per plugin, closed over rather than
    // module-global, so a test constructs a fresh one.
    const sessionAgents = new Map<string, string>();
    const hooks: Hooks = {
      config: async (config) => {
        applyCaretConfig(config as unknown as LooseConfig);
      },
      // Two jobs. (1) Record the session's agent, ALWAYS — it is what the steer below
      // gates on. (2) Warm the daemon, for the PLAN AGENT ONLY, so the first
      // caret_review_plan call doesn't pay the cold-spawn cost. Deliberately per-message
      // and unthrottled: the daemon idle-exits after [daemon].idle_ms (60s default; a
      // resident daemon never does), so a once-per-session warm would be dead
      // long before the plan lands. The warm stays plan-only even though any primary agent
      // may call the tool: the plan agent is the one whose turn reliably ends in a review,
      // and warming on every build message would spawn a process on the session's busiest
      // traffic to save ~0.4s in the rare case.
      "chat.message": async (input) => {
        // A message whose agent is unknown must not clobber the recorded one.
        if (input.sessionID && input.agent) sessionAgents.set(input.sessionID, input.agent);
        if (!isPlanningAgent(input.agent)) return;
        try {
          warm(bin);
        } catch {
          // best-effort — the review path spawns the daemon itself if this missed.
        }
      },
      // Steer the Plan agent to submit its plan to caret instead of plan_exit.
      // Only the plan agent: every other primary agent may call the review tool
      // but is not prompted toward it. A session with no recorded agent gets no
      // steer rather than a wrong one — which also keeps it out of the second
      // call site (Agent.generate, generating an agent config, passes no session).
      // A turn that reaches the model without a preceding chat.message therefore
      // misses the steer; the tool.definition hook below is the safety net, since
      // it points plan_exit — permitted only on the plan agent — at caret.
      "experimental.chat.system.transform": async (input, output) => {
        const agent = input.sessionID ? sessionAgents.get(input.sessionID) : undefined;
        if (isPlanningAgent(agent)) output.system.push(planningSteer(plansDir));
      },
      "tool.definition": async (input, output) => {
        if (input.toolID === "plan_exit") {
          output.description = `Do not call this tool. Call ${REVIEW_TOOL} instead — it opens caret's visual plan-review UI for human approval.`;
        }
      },
      tool: {
        [REVIEW_TOOL]: tool({
          description: REVIEW_TOOL_DESCRIPTION,
          args: {
            plan: tool.schema.string().optional().describe(PLAN_ARG_DESCRIPTION),
            path: tool.schema.string().optional().describe(pathArgDescription(plansDir)),
          },
          async execute(args, context) {
            let linkShown = false;
            const { text, decision } = await runPlanReview(
              args,
              {
                sessionID: context.sessionID,
                directory: context.directory,
                isSubagent: () => isSubagentSession(client, context.sessionID),
                canEdit: async (planFilePath) => {
                  try {
                    await context.ask({
                      permission: "edit",
                      patterns: [relative(context.worktree, planFilePath)],
                      always: ["*"],
                      metadata: { filepath: planFilePath },
                    });
                    return true;
                  } catch {
                    return false;
                  }
                },
                signal: context.abort,
                onUrl: (url) => {
                  linkShown = true;
                  showToast(client, reviewLinkToast(url));
                },
              },
              { bin, run, plansDir },
            );
            // Supersede the pending review-link toast with a brief decision toast —
            // the surface is single-slot with no hide API (EXC-691).
            if (linkShown && context.abort.aborted) {
              showToast(client, decisionToast("cancelled"));
            } else if (linkShown && decision) {
              showToast(client, decisionToast(decision.behavior));
            }
            return text;
          },
        }),
      },
    };
    return hooks;
  };
}

/** caret's OpenCode v1 plugin (the `server` half of index.ts's default), wiring the
 * production update checker. */
const CaretPlugin: Plugin = createCaretPlugin({ checkUpdate: productionUpdateCheck });
export default CaretPlugin;
