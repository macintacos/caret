// `/caret:demo` for pi: sends the agent caret's demo template, read from beside the
// package on every run, so a new user sees a review end to end.

import { readFile } from "node:fs/promises";

import { REVIEW_TOOL } from "../opencode/review-bridge.ts";
import { sendAndWait } from "./follow-up.ts";

/** The demo template, relative to the extension entry `pi/caret.ts`. */
export const DEMO_TEMPLATE = "../templates/demo.md";

/** The prompt sent ahead of the template. Keep in step with opencode/commands/demo.md,
 * which it mirrors. */
export const DEMO_INSTRUCTION = [
  `The demo template is at the end of this message. Follow its leading HTML comment exactly to fill the slots, then call the \`${REVIEW_TOOL}\` tool with everything after that comment as the \`plan\` argument. Do **no** other research and edit **no** file — this is only to exercise caret's plan-review flow.`,
  "",
  "caret opens the plan in a local browser UI for inline review. When the user approves or requests changes, the decision returns as the tool result:",
  "",
  "- **Approved** → acknowledge that caret approved the demo plan, and stop.",
  `- **Changes requested** → revise the plan accordingly, keeping it about the same size, and call \`${REVIEW_TOOL}\` again (caret captures it as a new version).`,
].join("\n");

export type DemoCommandContext = {
  ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
  waitForIdle(): Promise<void>;
  sessionManager: { getSessionId(): string };
};

/** The slice of pi's extension API `/caret:demo` calls; pinned by
 * test/pi/sdk-conformance.ts. */
export type DemoApi = {
  registerCommand(
    name: string,
    options: {
      description: string;
      handler: (args: string, ctx: DemoCommandContext) => Promise<void>;
    },
  ): void;
  sendUserMessage(content: string, options: { deliverAs: "followUp" }): void;
};

/** Registers `/caret:demo`, which reads the template at `templatePath` on every run and
 * refuses while the session is planning, since approving the demo would end planning. */
export function installDemo(
  pi: DemoApi,
  deps: { templatePath: string; isPlanning: (sessionId: string) => boolean },
): void {
  const { templatePath, isPlanning } = deps;
  pi.registerCommand("caret:demo", {
    description: "Demo caret: review a short plan about this repo",
    handler: async (_args, ctx) => {
      if (isPlanning(ctx.sessionManager.getSessionId())) {
        ctx.ui.notify(
          "caret's demo is off while planning; run /caret:plan to leave planning first.",
          "warning",
        );
        return;
      }
      let template: string;
      try {
        template = await readFile(templatePath, "utf-8");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.ui.notify(
          `caret couldn't read its demo template at ${templatePath}: ${message}`,
          "error",
        );
        return;
      }
      await sendAndWait(pi, ctx, `${DEMO_INSTRUCTION}\n\n${template}`);
    },
  });
}
