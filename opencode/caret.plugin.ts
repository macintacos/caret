// caret's OpenCode plugin (EXC-339). OpenCode is plugin-shaped, not command-hook
// shaped: it loads this in-process module and lets it register tools and mutate
// config. caret has no native plan-approval gate to intercept here (OpenCode has
// no ExitPlanMode equivalent), so this plugin REGISTERS its own plan-review tool,
// steers the Plan agent to call it, and
// runs the review synchronously inside the tool's execute(): it spawns
// `caret review` (CARET_AGENT=opencode) with a caret-defined envelope on stdin,
// blocks until the human decides in caret's browser UI, and returns the approval
// or change-request string as the tool result. The whole caret daemon/review
// pipeline is reused unchanged — this plugin is the OpenCode-side counterpart to
// Claude Code's hooks.json, which likewise spawns `caret review`.
//
// Subagent-bypass mitigation: OpenCode's tool.execute.before does not fire for
// subagent tool calls, so caret does NOT rely on a hook to gate subagents. The
// config hook restricts the tool to primary agents (experimental.primary_tools +
// per-agent permission), and the tool body re-checks the caller — defense in depth.
//
// This file is deployed verbatim (with the two __CARET_*__ markers substituted) by
// `caret install-opencode` into OpenCode's auto-loaded plugin dir, so it is
// self-contained: its only imports are node:child_process and @opencode-ai/plugin
// (the latter resolved by OpenCode at runtime). Live in-OpenCode verification of
// the exact ctx/tool/config shapes against the installed OpenCode version is a
// documented follow-up; the pure logic below is covered by test/opencode/.

import { spawn } from "node:child_process";
import { type Hooks, type Plugin, tool } from "@opencode-ai/plugin";

/** Install-time markers: `caret install-opencode` rewrites these string literals
 * with the resolved caret version and binary path before deploying this file. */
export const CARET_PLUGIN_VERSION = "__CARET_VERSION__";
const CARET_BIN = "__CARET_BIN__";

/** The plan-review tool the Plan agent calls. */
export const REVIEW_TOOL = "caret_review_plan";

/** OpenCode's built-in primary planning agent — the one agent caret steers toward
 * the review tool and allows to call it. */
export const PLANNING_AGENTS = ["plan"] as const;

export interface CaretDecision {
  behavior: "allow" | "deny";
  feedback?: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit tests)
// ---------------------------------------------------------------------------

/** The first markdown heading in the plan, used as the review title — or
 * undefined when the plan has no `# ` heading. */
export function planTitle(plan: string): string | undefined {
  for (const line of plan.split("\n")) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** Build the caret review envelope `caret review` (CARET_AGENT=opencode) parses.
 * Mirrors the snake_case session/cwd shape the opencode adapter's parseHookInput
 * reads — both ends are caret-owned. */
export function buildEnvelope(
  plan: string,
  ctx: { sessionID?: string; directory?: string },
): string {
  return JSON.stringify({
    session_id: ctx.sessionID,
    cwd: ctx.directory,
    tool_input: { plan, title: planTitle(plan) },
  });
}

/** Parse the single decision JSON line `caret review` prints on stdout. Fail-safe:
 * anything unrecognized or unparseable becomes a deny — shipping an unreviewed
 * plan is the one outcome caret never allows. */
export function parseDecision(stdout: string): CaretDecision {
  const line =
    stdout
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  try {
    const d = JSON.parse(line) as { behavior?: unknown; feedback?: unknown };
    if (d.behavior === "allow") return { behavior: "allow" };
    if (d.behavior === "deny") {
      return {
        behavior: "deny",
        feedback: typeof d.feedback === "string" ? d.feedback : "Plan changes requested.",
      };
    }
    return failsafeDeny("caret: unrecognized review decision — denying to fail safe.");
  } catch {
    return failsafeDeny("caret: could not parse the review decision — denying to fail safe.");
  }
}

function failsafeDeny(feedback: string): CaretDecision {
  return { behavior: "deny", feedback };
}

/** Only the configured planning agent(s) may call the review tool — the second
 * line of defense against the subagent-bypass (the config hook is the first). */
export function isPlanningAgent(agent: string | undefined): boolean {
  return agent !== undefined && (PLANNING_AGENTS as readonly string[]).includes(agent);
}

/** Tool result returned to the agent on approval. */
export function approvedMessage(): string {
  return "caret: the user APPROVED this plan. Proceed with the implementation as planned.";
}

/** Tool result returned to the agent on a change request: the reviewer feedback
 * plus a line-numbered copy of the current plan so the agent can revise precisely
 * and resubmit via the same tool. */
export function deniedMessage(feedback: string, plan: string): string {
  const lines = plan.split("\n");
  const numbered = lines.map((l, i) => `${i + 1}\t${l}`).join("\n");
  return [
    "caret: the user requested CHANGES to this plan.",
    "",
    "Feedback:",
    feedback,
    "",
    `Revise the plan accordingly, then call \`${REVIEW_TOOL}\` again with the updated plan.`,
    "",
    `## Current plan (${lines.length} lines)`,
    "",
    "```",
    numbered,
    "```",
  ].join("\n");
}

/** The planning-prompt steer appended to the system array so the Plan agent
 * submits its plan to caret instead of calling the native plan_exit. */
export function planningSteer(): string {
  return [
    "## Plan review (caret)",
    "",
    `When you have a plan ready for the user, do NOT call plan_exit. Instead call the \`${REVIEW_TOOL}\` tool with your full plan (markdown) as the \`plan\` argument.`,
    "It opens caret's visual review UI in the browser; the user approves or requests changes. Any change request comes back as the tool result — revise the plan and call the tool again until it is approved.",
  ].join("\n");
}

// --- config-hook mutation (subagent-bypass mitigation) -------------------------

type LooseAgent = { mode?: string; permission?: unknown } & Record<string, unknown>;
type LooseConfig = {
  experimental?: { primary_tools?: string[] } & Record<string, unknown>;
  agent?: Record<string, LooseAgent>;
} & Record<string, unknown>;

/** Mutate the OpenCode config in place to (1) mark the review tool primary-only so
 * subagents cannot call it, and (2) allow it on the planning agent while denying it
 * on the build agent. Idempotent and preservation-safe (existing primary_tools,
 * agent modes, and other permissions are kept). */
export function applyCaretConfig(config: LooseConfig): void {
  config.experimental ??= {};
  const pt = Array.isArray(config.experimental.primary_tools)
    ? config.experimental.primary_tools
    : [];
  if (!pt.includes(REVIEW_TOOL)) config.experimental.primary_tools = [...pt, REVIEW_TOOL];

  for (const name of PLANNING_AGENTS) setToolPermission(config, name, "allow");
  // Deny on the build agent so a non-planning primary can't ship an unreviewed plan.
  setToolPermission(config, "build", "deny");
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

function setToolPermission(config: LooseConfig, agentName: string, action: "allow" | "deny"): void {
  ensurePermission(ensureAgent(config, agentName))[REVIEW_TOOL] = action;
}

// --- the spawn bridge ----------------------------------------------------------

/** Runs `caret review`, returning its captured stdout. Injected so execute() is
 * unit-testable without spawning a real process. */
export type SpawnRunner = (
  bin: string,
  env: Record<string, string | undefined>,
  stdin: string,
) => Promise<{ stdout: string; exitCode: number }>;

/** Spawn `caret review` with the review envelope on stdin and CARET_AGENT=opencode,
 * then parse its decision line. Any spawn failure fails safe to a deny. */
export async function runReviewViaCaret(
  envelope: string,
  opts: { bin: string; run: SpawnRunner },
): Promise<CaretDecision> {
  try {
    const { stdout } = await opts.run(
      opts.bin,
      { ...process.env, CARET_AGENT: "opencode" },
      envelope,
    );
    return parseDecision(stdout);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return failsafeDeny(`caret: review failed to run (${message}) — denying to fail safe.`);
  }
}

/** Production runner: spawn the caret binary's `review` subcommand. stderr is
 * inherited so caret's "review this plan at <url>" line reaches the user. */
const nodeSpawnRunner: SpawnRunner = (bin, env, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(bin, ["review"], { env, stdio: ["pipe", "pipe", "inherit"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, exitCode: code ?? 0 }));
    child.stdin.write(stdin);
    child.stdin.end();
  });

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

/** Build the caret OpenCode plugin. The DI seam (bin/run) keeps the tool's
 * execute() unit-testable; the default export wires the production runner. */
export function createCaretPlugin(opts: { bin?: string; run?: SpawnRunner } = {}): Plugin {
  const bin = opts.bin ?? process.env.CARET_OPENCODE_BIN ?? CARET_BIN;
  const run = opts.run ?? nodeSpawnRunner;

  return async () => {
    const hooks: Hooks = {
      // Restrict the review tool to primary agents + allow/deny per agent.
      config: async (config) => {
        applyCaretConfig(config as unknown as LooseConfig);
      },
      // Steer the Plan agent to submit its plan to caret instead of plan_exit.
      "experimental.chat.system.transform": async (_input, output) => {
        output.system.push(planningSteer());
      },
      // Redirect the native plan_exit tool's description toward caret's tool.
      "tool.definition": async (input, output) => {
        if (input.toolID === "plan_exit") {
          output.description = `Do not call this tool. Call ${REVIEW_TOOL} instead — it opens caret's visual plan-review UI for human approval.`;
        }
      },
      tool: {
        [REVIEW_TOOL]: tool({
          description:
            "Submit the current plan to caret for human review in a local browser UI. Blocks until the user approves or requests changes. On a change request, revise the plan and call this tool again with the updated plan.",
          args: {
            plan: tool.schema
              .string()
              .describe("The complete plan, as markdown, to present for human review."),
          },
          async execute(args, context) {
            const agent = (context as { agent?: string }).agent;
            if (!isPlanningAgent(agent)) {
              return `${REVIEW_TOOL} is restricted to the plan agent (${PLANNING_AGENTS.join(", ")}); it was called by "${agent ?? "unknown"}". Continue without caret review, or switch to the plan agent and resubmit.`;
            }
            const envelope = buildEnvelope(args.plan, {
              sessionID: context.sessionID,
              directory: context.directory,
            });
            const decision = await runReviewViaCaret(envelope, { bin, run });
            return decision.behavior === "allow"
              ? approvedMessage()
              : deniedMessage(decision.feedback ?? "Plan changes requested.", args.plan);
          },
        }),
      },
    };
    return hooks;
  };
}

/** The deployed plugin OpenCode auto-loads (bare default-export function). */
const CaretPlugin: Plugin = createCaretPlugin();
export default CaretPlugin;
