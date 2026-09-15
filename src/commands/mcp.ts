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
  buildEnvelope,
  decisionText,
  nodeSpawnRunner,
  PLAN_TITLE_INSTRUCTION,
  runReviewViaCaret,
  type SpawnRunner,
} from "@opencode/review-bridge.ts";
import { CLAUDE_MCP_AGENT } from "@/adapters/index.ts";
import { bootHookLogging } from "@/commands/boot.ts";
import { loadSettings } from "@/config/settings.ts";
import { selfCommand } from "@/daemon/lifecycle.ts";
import { VERSION } from "@/lib/build-id.ts";
import { logInfo, logWarn } from "@/lib/log.ts";

export const REVIEW_PLAN_TOOL = "review_plan";

// The name and this text are the only steer the model gets, so it says plainly what the
// tool is for: caret reflows whatever it receives into its own plan layout.
const REVIEW_PLAN_DESCRIPTION = [
  "Submit your implementation plan to the user for review in caret's browser UI. For plans only: caret renders the markdown as a plan, so do not use it for other documents or questions.",
  "The call blocks until the user approves or requests changes, which can take many minutes. If the call moves to the background, do not act on the plan until its result arrives.",
  `On a change request, revise the plan and call ${REVIEW_PLAN_TOOL} again. Do not implement the plan until a call returns an approval.`,
  PLAN_TITLE_INSTRUCTION,
].join(" ");

export interface ReviewPlanDeps {
  /** One per server, so resubmissions thread into the same review session. */
  sessionId: string;
  cwd: string;
  /** The `caret review` argv to spawn — `selfCommand("review")` in production. */
  command: string[];
  run: SpawnRunner;
}

type ReviewPlanHandler = (plan: string, signal: AbortSignal) => Promise<CallToolResult>;

/** The review_plan call. One review at a time: every call shares the server's session
 * id, so a second concurrent review would supersede the first and leave its call waiting
 * out the review timeout. */
export function createReviewPlanHandler(deps: ReviewPlanDeps): ReviewPlanHandler {
  let pending = false;
  return async (plan, signal) => {
    if (pending) {
      logWarn("mcp", "review refused: one already pending", { sessionId: deps.sessionId });
      const text = `caret: a plan review is already pending. Wait for its decision before calling ${REVIEW_PLAN_TOOL} again.`;
      return { content: [{ type: "text", text }], isError: true };
    }
    pending = true;
    try {
      const decision = await runReviewViaCaret(
        buildEnvelope(plan, { sessionID: deps.sessionId, directory: deps.cwd }),
        { command: deps.command, agent: CLAUDE_MCP_AGENT, run: deps.run, signal },
      );
      return { content: [{ type: "text", text: decisionText(decision, REVIEW_PLAN_TOOL) }] };
    } finally {
      pending = false;
    }
  };
}

/** The caret MCP server around `review`. The SDK aborts a call's signal when the client
 * cancels it or the connection closes, which kills the in-flight review child and
 * expires its review rather than leaving it pending until the timeout. */
export function createCaretMcpServer(review: ReviewPlanHandler): McpServer {
  const server = new McpServer({ name: "caret", version: VERSION });
  server.registerTool(
    REVIEW_PLAN_TOOL,
    {
      description: REVIEW_PLAN_DESCRIPTION,
      inputSchema: { plan: z.string().describe("The complete plan, as markdown.") },
    },
    ({ plan }, extra) => review(plan, extra.signal),
  );
  return server;
}

export async function runMcpSubcommand(): Promise<void> {
  bootHookLogging(loadSettings());
  const sessionId = `mcp-${randomUUID()}`;
  const server = createCaretMcpServer(
    createReviewPlanHandler({
      sessionId,
      cwd: process.env.CLAUDE_PROJECT_DIR ?? process.cwd(),
      command: selfCommand("review"),
      run: nodeSpawnRunner,
    }),
  );
  const close = (reason: string) => () => {
    logInfo("mcp", "mcp server closing", { sessionId, reason });
    void server.close();
  };
  // The stdio transport never notices stdin closing, which is how the client hangs up.
  process.stdin.once("end", close("stdin end"));
  process.once("SIGTERM", close("SIGTERM"));
  process.once("SIGINT", close("SIGINT"));
  await server.connect(new StdioServerTransport());
  logInfo("mcp", "mcp server started", { sessionId });
}
