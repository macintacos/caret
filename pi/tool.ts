// caret_review_plan for pi: submits a plan to `caret review` and blocks until the
// reviewer decides.

import { Text } from "@earendil-works/pi-tui";
import { type Static, Type } from "typebox";

import {
  buildEnvelope,
  type CaretDecision,
  decisionText,
  PLAN_ARG_DESCRIPTION,
  REVIEW_TOOL,
  REVIEW_TOOL_DESCRIPTION,
  readRegularFile,
  resolvePlanSource,
  runReviewViaCaret,
  type SpawnRunner,
} from "../bridge/review-bridge.ts";
import {
  callLine,
  type PiTheme,
  type RenderedResult,
  type ReviewDetails,
  resultLine,
} from "./render.ts";
import type { ReviewOutcome, ReviewStore } from "./state.ts";

export type { ReviewDetails } from "./render.ts";
export type PiToolContext = { cwd: string; sessionManager: { getSessionId(): string } };
export type PiToolResult = {
  content: { type: "text"; text: string }[];
  details: ReviewDetails;
  isError?: true;
};

const parameters = Type.Object({
  plan: Type.Optional(Type.String({ description: PLAN_ARG_DESCRIPTION })),
  path: Type.Optional(
    Type.String({
      description:
        "Preferred. A markdown (.md) file holding the complete plan, absolute or relative to the session directory.",
    }),
  ),
});
type Params = Static<typeof parameters>;

/** The ToolDefinition slice caret fills. */
export interface PiTool {
  name: string;
  label: string;
  description: string;
  promptSnippet: string;
  parameters: typeof parameters;
  executionMode: "sequential";
  execute(
    toolCallId: string,
    params: Params,
    signal: AbortSignal | undefined,
    onUpdate: ((update: PiToolResult) => void) | undefined,
    ctx: PiToolContext,
  ): Promise<PiToolResult>;
  renderCall(args: Params, theme: PiTheme): Text;
  renderResult(result: RenderedResult, options: unknown, theme: PiTheme): Text;
}

const CANCELLED_TEXT =
  "caret: the review was cancelled before the user decided, so this plan is not approved. Do not implement it; wait for the user's direction.";

function failedText(reason: string): string {
  return [
    "caret: the review could not run or ended without a decision, so this plan is not approved.",
    "",
    `Reason: ${reason}`,
    "",
    `Tell the user the review did not complete. Do not implement the plan until a call to \`${REVIEW_TOOL}\` returns an approval.`,
  ].join("\n");
}

const toolResult = (text: string, details: ReviewDetails): PiToolResult => ({
  content: [{ type: "text", text }],
  details,
  ...(details.state === "failed" && { isError: true as const }),
});

/** The outcome a settled review maps to. An abort wins over the decision: a killed
 * review's deny is no reviewer's. */
export function outcomeOf(decision: CaretDecision, aborted: boolean): ReviewOutcome {
  if (aborted) return "cancelled";
  if (decision.behavior === "allow") return "approved";
  return decision.failsafe ? "failed" : "changes";
}

function outcomeText(
  outcome: ReviewOutcome,
  decision: CaretDecision,
  planFilePath: string | undefined,
): string {
  if (outcome === "cancelled") return CANCELLED_TEXT;
  if (outcome === "failed") return failedText(decision.feedback ?? "");
  return decisionText(decision, REVIEW_TOOL, planFilePath);
}

export function reviewTool(deps: { bin: string; run: SpawnRunner; store: ReviewStore }): PiTool {
  return {
    name: REVIEW_TOOL,
    label: "caret",
    description: REVIEW_TOOL_DESCRIPTION,
    // No promptGuidelines: pi appends them to every system prompt while the tool is
    // active, and outside caret's planning mode users get no behaviour change they didn't
    // ask for.
    promptSnippet:
      "Submit a plan to caret for the user's review in a browser UI; blocks until they approve or request changes",
    parameters,
    executionMode: "sequential",
    async execute(_id, params, signal, onUpdate, ctx) {
      const sessionId = ctx.sessionManager.getSessionId();
      let outcome: ReviewOutcome = "failed";
      try {
        // Models sometimes prefix paths with `@`.
        const path = params.path?.replace(/^@/, "");
        const source = resolvePlanSource({ plan: params.plan, path }, ctx.cwd, readRegularFile);
        if ("error" in source) return toolResult(source.error, { state: "failed" });
        const decision = await runReviewViaCaret(
          buildEnvelope(source.plan, {
            sessionID: sessionId,
            directory: ctx.cwd,
            planFilePath: source.planFilePath,
          }),
          {
            command: [deps.bin, "review"],
            agent: "pi",
            run: deps.run,
            signal,
            onUrl: (url) => {
              deps.store.update(sessionId, { pending: url });
              onUpdate?.(
                toolResult(`caret: waiting for review at ${url}`, { state: "waiting", url }),
              );
            },
          },
        );
        outcome = outcomeOf(decision, signal?.aborted ?? false);
        return toolResult(outcomeText(outcome, decision, source.planFilePath), { state: outcome });
      } finally {
        deps.store.update(sessionId, { pending: undefined, lastOutcome: outcome });
      }
    },
    renderCall: (args, theme) => new Text(callLine(args, theme), 0, 0),
    renderResult: (result, _options, theme) => new Text(resultLine(result, theme), 0, 0),
  };
}
