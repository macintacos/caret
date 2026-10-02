// caret's OpenCode v2 plugin: the `setup` half of the dual default export in index.ts.
// A thin adapter over the shared review core in caret.core.ts. The v2 SDK shapes it
// uses are declared locally, so the shipped source names no package a consumer's install
// lacks; test/opencode/sdk-conformance.ts pins them to `@opencode/plugin`. Never import a
// value from that SDK here: its entry pulls Effect, and v1 hosts load this file too.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  CARET_DECISION_KEY,
  CARET_URL_KEY,
  isPlanningAgent,
  nodeWarmRunner,
  PLAN_ARG_DESCRIPTION,
  pathArgDescription,
  planningSteer,
  REVIEW_TOOL,
  REVIEW_TOOL_DESCRIPTION,
  resolveCaretBin,
  resolvePlansDir,
  runPlanReview,
  type WarmRunner,
} from "./caret.core.ts";
import { editPermitted, type Rule } from "./permission.ts";
import { decisionText, nodeSpawnRunner, type SpawnRunner } from "./review-bridge.ts";

/** Appended last, it outranks a config deny-all: v2 disables a tool only when the last
 * rule naming it is a `*` deny. */
export const PLAN_ALLOW_RULE: Readonly<Rule> = Object.freeze({
  action: REVIEW_TOOL,
  resource: "*",
  effect: "allow",
});

/** The session rules with caret's allow appended, or undefined when either ruleset already
 * names the tool — the user's own rule (never overridden), or caret's from an earlier prompt.
 * Agent rules count because v2 folds the user's config permissions into them. */
export function withPlanAllow(
  agentRules: readonly Rule[],
  sessionRules: readonly Rule[],
): Rule[] | undefined {
  const namesReviewTool = (rule: Rule) => rule.action === REVIEW_TOOL;
  if (agentRules.some(namesReviewTool) || sessionRules.some(namesReviewTool)) return undefined;
  return [...sessionRules, PLAN_ALLOW_RULE];
}

type SessionInfo = {
  location: { directory: string };
  parentID?: string;
  agent?: string;
  permissions?: Rule[];
};

export type ContextEvent = {
  sessionID: string;
  agent: string;
  tools?: Record<string, unknown>;
  system: { push: (part: { type: "text"; text: string }) => unknown };
};

export type PromptEvent = { sessionID: string };

type ReviewTool = {
  name: string;
  description: string;
  input: { type: "object"; properties: Record<string, { type: "string"; description: string }> };
  options: { codemode: boolean };
  execute: (
    input: unknown,
    context: ToolContext,
  ) => Promise<{ content: string; metadata?: Record<string, string> }>;
};

/** The slice of v2's plugin `Context` caret uses. */
export type SetupContext = {
  location: { directory: string; project: { directory: string } };
  session: {
    get: (input: { sessionID: string }) => Promise<SessionInfo>;
    update: (input: { sessionID: string; permissions: Rule[] }) => Promise<unknown>;
    hook: {
      (name: "context", callback: (event: ContextEvent) => Promise<void>): Promise<unknown>;
      (name: "prompt", callback: (event: PromptEvent) => Promise<void>): Promise<unknown>;
    };
  };
  agent: {
    get: (input: { agentID: string }) => Promise<{ data: { permissions: Rule[] } }>;
    list: () => Promise<{ data: { id: string }[] }>;
  };
  tool: {
    transform: (callback: (tools: { add: (tool: ReviewTool) => void }) => void) => Promise<unknown>;
  };
};

/** The v2 tool-call context fields caret's `execute` reads. */
export type ToolContext = {
  sessionID: string;
  agent: string;
  signal: AbortSignal;
  progress: (metadata: Record<string, string>) => Promise<unknown>;
};

/** Build caret's v2 `setup` over injected runners, so tests drive it with a stub review
 * runner and a recording warm. */
export function createCaretSetup(opts: {
  bin: string;
  run: SpawnRunner;
  warm: WarmRunner;
  plansDir: string;
}): (ctx: SetupContext) => Promise<void> {
  const { bin, run, warm, plansDir } = opts;

  return async (ctx) => {
    const readSession = (sessionID: string) => ctx.session.get({ sessionID });

    async function execute(
      input: unknown,
      context: ToolContext,
    ): Promise<{ content: string; metadata?: Record<string, string> }> {
      try {
        const session = await readSession(context.sessionID).catch(() => undefined);
        const directory = session?.location.directory ?? ctx.location.directory;
        const { text, decision } = await runPlanReview(
          // v2 decodes input against the JSON Schema below before execute runs.
          input as { plan?: string; path?: string },
          {
            sessionID: context.sessionID,
            directory,
            // Fail-open: an unreadable session is treated as primary, as on v1.
            isSubagent: async () => Boolean(session?.parentID),
            canEdit: async (planFilePath) => {
              // Session rules can deny, so an unreadable session cannot prove allow.
              if (!session) return false;
              try {
                const agent = await ctx.agent.get({ agentID: context.agent });
                return editPermitted(
                  planFilePath,
                  { directory, projectDirectory: ctx.location.project.directory },
                  { agent: agent.data.permissions, session: session.permissions ?? [] },
                );
              } catch {
                return false;
              }
            },
            signal: context.signal,
            // The TUI half toasts from these progress and result keys.
            onUrl: (url) => {
              context.progress({ [CARET_URL_KEY]: url }).catch(() => {});
            },
          },
          { bin, run, plansDir },
        );
        // An abort's fail-safe deny is no reviewer's decision; the TUI reads a missing key as cancelled.
        if (!decision || context.signal.aborted) return { content: text };
        return { content: text, metadata: { [CARET_DECISION_KEY]: decision.behavior } };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: decisionText(
            {
              behavior: "deny",
              feedback: `caret: review failed to run (${message}) — denying to fail safe.`,
            },
            REVIEW_TOOL,
          ),
        };
      }
    }

    await ctx.tool.transform((tools) =>
      tools.add({
        name: REVIEW_TOOL,
        description: REVIEW_TOOL_DESCRIPTION,
        input: {
          type: "object",
          properties: {
            plan: { type: "string", description: PLAN_ARG_DESCRIPTION },
            path: { type: "string", description: pathArgDescription(plansDir) },
          },
        },
        options: { codemode: false },
        execute,
      }),
    );

    // A rejected hook aborts the model request that fired it, so every hook swallows.
    await ctx.session.hook("context", async (event) => {
      try {
        if (event.tools?.[REVIEW_TOOL] && (await readSession(event.sessionID)).parentID) {
          delete event.tools[REVIEW_TOOL];
        }
      } catch {
        // Fail-open: an unreadable session keeps the tool; execute still refuses a subagent.
      }
      try {
        // Only while the tool is still offered: never steer toward a denied or disabled tool.
        if (isPlanningAgent(event.agent) && event.tools?.[REVIEW_TOOL]) {
          event.system.push({ type: "text", text: planningSteer(plansDir) });
        }
      } catch {
        // best-effort
      }
    });

    // Per prompt, never per session: the daemon idle-exits 60s after a warm. Awaited so the
    // allow lands before the step selects its tools; the warm itself is never awaited.
    await ctx.session.hook("prompt", async (event) => {
      try {
        const session = await readSession(event.sessionID);
        // v2 never writes the resolved default agent back to the session; `list()` leads with
        // it — an order v2 implements but does not document.
        const agentID = session.agent ?? (await ctx.agent.list()).data[0]?.id;
        if (!agentID || !isPlanningAgent(agentID)) return;
        try {
          warm(bin);
        } catch {
          // best-effort — the review path spawns the daemon itself if this missed
        }
        const agent = await ctx.agent.get({ agentID });
        const permissions = withPlanAllow(agent.data.permissions, session.permissions ?? []);
        if (permissions) await ctx.session.update({ sessionID: event.sessionID, permissions });
      } catch {
        // best-effort
      }
    });
  };
}

/** The v2 `setup` OpenCode loads, wired to the production runners. */
const setup = createCaretSetup({
  bin: resolveCaretBin({ env: process.env, importMetaUrl: import.meta.url }),
  run: nodeSpawnRunner,
  warm: nodeWarmRunner,
  plansDir: resolvePlansDir({
    env: process.env,
    home: homedir(),
    readFile: (p) => readFileSync(p, "utf-8"),
    // v2's plan agent may edit only this dir, and v2 roots it at $HOME, not XDG.
    defaultDir: join(homedir(), ".opencode", "plan"),
  }),
});
export default setup;
