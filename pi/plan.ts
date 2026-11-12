// `/caret <task>`, caret's planning mode for pi: a hidden steer to write and submit a plan,
// and a gate on edit/write outside the plans folder until a review of a plan in that
// folder, submitted while planning, is approved. State lives in the review store (which
// outlives `/reload`) and in session entries, rebuilt from the current branch so a fork or
// `/tree` jump to before planning began is not planning.

import { mkdirSync } from "node:fs";

import { PLAN_TITLE_INSTRUCTION, REVIEW_TOOL } from "../bridge/review-bridge.ts";
import { sendAndWait } from "./follow-up.ts";
import { landsInside } from "./gate.ts";
import type { ReviewStore } from "./state.ts";

/** The customType of both the hidden steer message and the session entry. */
export const PLANNING = "caret-planning";

export const LEAVE_NOTICE = "caret planning is off; edits are no longer blocked.";

type SessionCtx = { sessionManager: { getSessionId(): string } };
export type PlanningEntry = { type: string; customType?: string; data?: unknown };
export type PlanningContext = SessionCtx & {
  cwd: string;
  sessionManager: { getBranch(): PlanningEntry[] };
};
export type PlanningCommandContext = PlanningContext & {
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
  waitForIdle(): Promise<void>;
};
type SteerResult = { message: { customType: string; content: string; display: boolean } };
type ToolCall = { toolName: string; toolCallId: string; input: Record<string, unknown> };
type ToolResult = { toolName: string; toolCallId: string; details?: unknown };

/** The slice of pi's extension API the planning mode calls; pinned by
 * test/pi/sdk-conformance.ts. */
export type PlanningApi = {
  sendUserMessage(content: string, options: { deliverAs: "followUp" }): void;
  appendEntry(customType: string, data: { active: boolean }): void;
  on(
    event: "before_agent_start",
    handler: (
      event: { messageType: "user" | "custom" },
      ctx: SessionCtx,
    ) => SteerResult | undefined,
  ): void;
  on(
    event: "context",
    handler: <M>(event: { messages: M[] }, ctx: SessionCtx) => { messages: M[] } | undefined,
  ): void;
  on(
    event: "tool_call",
    handler: (event: ToolCall, ctx: PlanningContext) => { block: true; reason: string } | undefined,
  ): void;
  on(event: "tool_result", handler: (event: ToolResult, ctx: SessionCtx) => void): void;
  on(
    event: "session_start" | "session_tree",
    handler: (event: unknown, ctx: PlanningContext) => void,
  ): void;
};

export interface PlanningDeps {
  store: ReviewStore;
  plansDir: string;
  /** Stands the caret daemon up ahead of the review; best-effort. */
  warm: () => void;
}

/** The session id's last 8 characters: pi's ids are UUIDv7, whose leading characters are a
 * timestamp shared by sessions started close together. */
export function sessionTag(sessionId: string): string {
  return sessionId.slice(-8);
}

/** The hidden message that tells the model to write its plan under `plansDir` and
 * submit it. */
export function planningSteer(plansDir: string, sessionId: string): string {
  const file = `${plansDir}/<short-name>-${sessionTag(sessionId)}.md`;
  return [
    "## Planning mode (caret)",
    "",
    `You are in caret's planning mode. Research the change — read the relevant code and trace the real flow — but do not modify any file outside \`${plansDir}/\`: edit and write calls elsewhere are blocked until the plan is approved, and do not change files with shell commands either.`,
    `Write the plan as markdown to \`${file}\`, replacing \`<short-name>\` with a short kebab-case name, then call the \`${REVIEW_TOOL}\` tool with that file as the \`path\` argument.`,
    "It opens caret's visual review UI in the browser; the user approves or requests changes. A change request comes back as the tool result: re-read the file, revise it with targeted edits rather than rewriting it, and call the tool again with the same `path` until it is approved. Once it is approved, planning ends and you can implement the plan.",
    PLAN_TITLE_INSTRUCTION,
  ].join("\n");
}

/** Whether the branch's last planning entry turned planning on. */
export function planningFromBranch(entries: readonly PlanningEntry[]): boolean {
  const lastPlanningEntry = entries.findLast(
    (e) =>
      e.type === "custom" &&
      e.customType === PLANNING &&
      typeof (e.data as { active?: unknown } | undefined)?.active === "boolean",
  );
  return (lastPlanningEntry?.data as { active: boolean } | undefined)?.active === true;
}

/** What `/caret` calls into the planning mode. */
export type PlanningHandlers = {
  /** Turns planning on if it is off and sends `task`. */
  plan(task: string, ctx: PlanningCommandContext): Promise<void>;
  /** Turns planning off and says so; false, doing nothing, when it was already off. */
  leave(ctx: PlanningCommandContext): boolean;
  isPlanning(ctx: SessionCtx): boolean;
};

/** Installs the planning mode's handlers on `pi` and returns what `/caret` calls. Call once
 * per pi instance: the set of in-flight review calls is per install. */
export function installPlanning(pi: PlanningApi, deps: PlanningDeps): PlanningHandlers {
  const { store, plansDir, warm } = deps;
  const reviewsWhilePlanning = new Set<string>();
  const sid = (ctx: SessionCtx) => ctx.sessionManager.getSessionId();
  const isPlanning = (ctx: SessionCtx) => store.get(sid(ctx)).planning;
  const setPlanning = (ctx: SessionCtx, active: boolean) => {
    if (active) mkdirSync(plansDir, { recursive: true });
    pi.appendEntry(PLANNING, { active });
    store.update(sid(ctx), { planning: active });
  };
  const restorePlanningFromBranch = (_event: unknown, ctx: PlanningContext) =>
    store.update(sid(ctx), { planning: planningFromBranch(ctx.sessionManager.getBranch()) });
  const pathInPlansDir = (call: ToolCall, ctx: PlanningContext) =>
    typeof call.input.path === "string" && landsInside(call.input.path, ctx.cwd, plansDir);

  pi.on("before_agent_start", (event, ctx) => {
    if (event.messageType !== "user" || !isPlanning(ctx)) return undefined;
    try {
      warm();
    } catch {
      /* best-effort */
    }
    return {
      message: { customType: PLANNING, content: planningSteer(plansDir, sid(ctx)), display: false },
    };
  });

  pi.on("context", (event, ctx) => {
    if (isPlanning(ctx)) return undefined;
    return {
      messages: event.messages.filter(
        (m) => (m as { customType?: unknown }).customType !== PLANNING,
      ),
    };
  });

  // Must not throw: pi does not catch a tool_call handler's throw.
  pi.on("tool_call", (event, ctx) => {
    if (!isPlanning(ctx)) return undefined;
    if (event.toolName === REVIEW_TOOL) {
      if (pathInPlansDir(event, ctx)) reviewsWhilePlanning.add(event.toolCallId);
      return undefined;
    }
    if (event.toolName !== "edit" && event.toolName !== "write") return undefined;
    if (pathInPlansDir(event, ctx)) return undefined;
    return {
      block: true,
      reason: `Planning mode: only files in \`${plansDir}/\` can change until the plan is approved. Finish the plan there and submit it with \`${REVIEW_TOOL}\`.`,
    };
  });

  pi.on("tool_result", (event, ctx) => {
    if (event.toolName !== REVIEW_TOOL || !reviewsWhilePlanning.delete(event.toolCallId)) return;
    if ((event.details as { state?: unknown } | undefined)?.state === "approved") {
      setPlanning(ctx, false);
    }
  });

  pi.on("session_start", restorePlanningFromBranch);
  pi.on("session_tree", restorePlanningFromBranch);

  return {
    plan: async (task, ctx) => {
      if (!isPlanning(ctx)) setPlanning(ctx, true);
      await sendAndWait(pi, ctx, task);
    },
    leave: (ctx) => {
      if (!isPlanning(ctx)) return false;
      setPlanning(ctx, false);
      ctx.ui.notify(LEAVE_NOTICE, "info");
      return true;
    },
    isPlanning,
  };
}
