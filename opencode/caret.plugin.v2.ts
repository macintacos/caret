// caret's OpenCode v2 plugin: the `setup` half of the dual default export in index.ts.
// A thin adapter over the shared review core in caret.plugin.ts. Every `@opencode/plugin`
// import is type-only: its runtime entry pulls Effect and OpenCode's client into the module
// graph, and this file also loads on v1 hosts.

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Plugin } from "@opencode/plugin";
import type { ToolContext } from "@opencode/plugin/promise/tool";

import {
  CARET_BIN,
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
} from "./caret.plugin.ts";
import { editPermitted, type Rule } from "./permission.ts";
import { nodeSpawnRunner, type SpawnRunner } from "./review-bridge.ts";

type SetupContext = Pick<Plugin.Context, "location" | "agent" | "session" | "tool">;

type SessionInfo = {
  parentID?: string;
  agent?: string;
  location?: { directory: string };
  permissions?: readonly Rule[];
};

/** Build caret's v2 `setup`. The DI seam mirrors createCaretPlugin's. */
export function createCaretSetup(opts: {
  bin: string;
  run: SpawnRunner;
  warm: WarmRunner;
  plansDir: string;
}): (ctx: SetupContext) => Promise<void> {
  const { bin, run, warm, plansDir } = opts;

  return async (ctx) => {
    const readSession = async (sessionID: string): Promise<SessionInfo> =>
      (await ctx.session.get({ sessionID })) as SessionInfo;

    async function execute(input: unknown, context: ToolContext): Promise<{ content: string }> {
      try {
        const session = await readSession(context.sessionID).catch(() => undefined);
        const directory = session?.location?.directory ?? ctx.location.directory;
        const { text } = await runPlanReview(
          input as { plan?: string; path?: string },
          {
            sessionID: context.sessionID,
            directory,
            // Fail-open: an unreadable session is treated as primary, as on v1.
            isSubagent: async () => Boolean(session?.parentID),
            canEdit: async (planFilePath) => {
              if (!session) return false;
              try {
                const agent = await ctx.agent.get({ agentID: context.agent });
                return editPermitted(
                  planFilePath,
                  { directory, projectDirectory: ctx.location.project.directory },
                  [...agent.data.permissions],
                  [...(session.permissions ?? [])],
                );
              } catch {
                return false;
              }
            },
            signal: context.signal,
          },
          { bin, run, plansDir },
        );
        return { content: text };
      } catch (error) {
        return { content: `caret: ${REVIEW_TOOL} failed: ${String(error)}` };
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
    await ctx.session.hook("context", (event) => {
      try {
        if (isPlanningAgent(event.agent)) {
          event.system.push({ type: "text", text: planningSteer(plansDir) });
        }
      } catch {
        // best-effort
      }
    });

    // Per prompt, never per session: the daemon idle-exits 60s after a warm. Not awaited,
    // so a prompt never waits on caret.
    await ctx.session.hook("prompt", (event) => {
      // ponytail: an unset session agent means the configured default agent, which is not
      // resolved, so a default-`plan` user gets no warm; resolve the default agent to fix.
      readSession(event.sessionID)
        .then((session) => {
          if (isPlanningAgent(session.agent)) warm(bin);
        })
        .catch(() => {});
    });
  };
}

/** The v2 `setup` OpenCode loads, wired to the production runners. */
const setup = createCaretSetup({
  bin: resolveCaretBin({ env: process.env, marker: CARET_BIN, importMetaUrl: import.meta.url }),
  run: nodeSpawnRunner,
  warm: nodeWarmRunner,
  plansDir: resolvePlansDir({
    env: process.env,
    home: homedir(),
    readFile: (p) => readFileSync(p, "utf-8"),
    defaultDir: join(homedir(), ".opencode", "plan"),
  }),
});
export default setup;
