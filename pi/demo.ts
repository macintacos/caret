// `/caret:demo` for pi: sends the agent OpenCode's `/caret:demo` prompt with caret's demo
// template in place of its marker, both read from beside the package on every run, so a
// new user sees a review end to end.

import { readFile } from "node:fs/promises";

import { errorMessage } from "../bridge/review-bridge.ts";
import { sendAndWait } from "./follow-up.ts";

/** The demo template and OpenCode's `/caret:demo` command, relative to the extension
 * entry `pi/caret.ts`. Both hosts submit through the same review tool, so the command's
 * body is pi's prompt too. */
export const DEMO_TEMPLATE = "../templates/demo.md";
export const DEMO_COMMAND = "../opencode/commands/demo.md";

const TEMPLATE_MARKER = "__CARET_DEMO_TEMPLATE__";
const FRONTMATTER = /^---\n[\s\S]*?\n---\n+/;

/** `command`'s body with `template` taken literally in place of its marker. */
const demoPrompt = (command: string, template: string): string =>
  command.replace(FRONTMATTER, "").replace(TEMPLATE_MARKER, () => template);

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

/** Registers `/caret:demo`, which reads the command at `commandPath` and the template at
 * `templatePath` on every run and refuses while the session is planning, where approving
 * the demo could end planning for the real task. */
export function installDemo(
  pi: DemoApi,
  deps: {
    commandPath: string;
    templatePath: string;
    isPlanning: (sessionId: string) => boolean;
  },
): void {
  const { commandPath, templatePath, isPlanning } = deps;
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
      let prompt: string;
      try {
        const [command, template] = await Promise.all([
          readFile(commandPath, "utf-8"),
          readFile(templatePath, "utf-8"),
        ]);
        prompt = demoPrompt(command, template);
      } catch (err) {
        // The error names the file that failed.
        ctx.ui.notify(`caret couldn't read its demo prompt: ${errorMessage(err)}`, "error");
        return;
      }
      await sendAndWait(pi, ctx, prompt);
    },
  });
}
