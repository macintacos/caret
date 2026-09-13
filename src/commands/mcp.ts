// `caret mcp`: the stdio MCP server the Claude Code plugin starts, serving one tool,
// review_plan, that puts an agent's plan in front of the reviewer and blocks until they
// decide. It is Claude Code's counterpart to the OpenCode plugin's caret_review_plan and
// runs the same bridge: spawn `caret review` under CARET_AGENT=claude-mcp and turn the
// flat decision into the tool result. stdout belongs to the MCP transport alone.

import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  approvedMessage,
  buildEnvelope,
  deniedMessage,
  nodeSpawnRunner,
  runReviewViaCaret,
  type SpawnRunner,
} from "@opencode/review-bridge.ts";
import { bootHookLogging } from "@/commands/boot.ts";
import { loadSettings } from "@/config/settings.ts";
import { selfCommand } from "@/daemon/lifecycle.ts";
import { VERSION } from "@/lib/build-id.ts";

export const REVIEW_PLAN_TOOL = "review_plan";

// The name and this text are the only steer the model gets, so it says plainly what the
// tool is for: caret reflows whatever it receives into its own plan layout.
export const REVIEW_PLAN_DESCRIPTION = [
  "Submit your implementation plan to the user for review in caret's browser UI. For plans only: caret renders the markdown as a plan, so do not use it for other documents or questions.",
  "The call blocks until the user approves or requests changes, which can take many minutes. If the call moves to the background, do not act on the plan until its result arrives.",
  `On a change request, revise the plan and call ${REVIEW_PLAN_TOOL} again. Do not implement the plan until a call returns an approval.`,
].join(" ");

export interface ReviewPlanDeps {
  sessionId: string;
  cwd: string;
  command: string[];
  run: SpawnRunner;
}

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text }], ...(isError ? { isError } : {}) };
}

/** The review_plan call. One review at a time: every call shares the server's session
 * id, so a second concurrent review would supersede the first and leave its call waiting
 * out the review timeout. */
export function createReviewPlanHandler(
  deps: ReviewPlanDeps,
): (plan: string, signal: AbortSignal) => Promise<CallToolResult> {
  let pending = false;
  return async (plan, signal) => {
    if (pending) {
      return textResult(
        `caret: a plan review is already pending. Wait for its decision before calling ${REVIEW_PLAN_TOOL} again.`,
        true,
      );
    }
    pending = true;
    try {
      const decision = await runReviewViaCaret(
        buildEnvelope(plan, { sessionID: deps.sessionId, directory: deps.cwd }),
        { command: deps.command, agent: "claude-mcp", run: deps.run, signal },
      );
      return textResult(
        decision.behavior === "allow"
          ? approvedMessage(decision.feedback)
          : deniedMessage(decision.feedback ?? "Plan changes requested.", REVIEW_PLAN_TOOL),
      );
    } finally {
      pending = false;
    }
  };
}

export async function runMcpSubcommand(): Promise<void> {
  bootHookLogging(loadSettings());
  const review = createReviewPlanHandler({
    sessionId: `mcp-${randomUUID()}`,
    cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
    command: selfCommand("review"),
    run: nodeSpawnRunner,
  });

  // Aborting kills each in-flight review child, which expires its review rather than
  // leaving it pending until the timeout.
  const shutdown = new AbortController();
  const server = new McpServer({ name: "caret", version: VERSION });
  server.registerTool(
    REVIEW_PLAN_TOOL,
    {
      description: REVIEW_PLAN_DESCRIPTION,
      inputSchema: { plan: z.string().describe("The complete plan, as markdown.") },
    },
    ({ plan }, extra) => review(plan, AbortSignal.any([extra.signal, shutdown.signal])),
  );
  server.server.onclose = () => shutdown.abort();
  const close = () => void server.close();
  // The stdio transport never notices stdin closing, which is how the client hangs up.
  process.stdin.once("end", close);
  process.once("SIGTERM", close);
  process.once("SIGINT", close);
  await server.connect(new StdioServerTransport());
}
