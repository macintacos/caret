// `/caret`, caret's one pi command: routes its argument to planning, `caret doctor`, the
// demo, or a usage hint.

import type { DemoCommandContext } from "./demo.ts";
import type { DoctorCommandContext } from "./doctor.ts";
import { OPEN_KEY } from "./notice.ts";
import type { PlanningCommandContext, PlanningHandlers } from "./plan.ts";

export type CaretCommand =
  | { kind: "usage" }
  | { kind: "bare-plan" }
  | { kind: "doctor" }
  | { kind: "demo" }
  | { kind: "plan"; task: string };

/** pi's reading of the `/caret` dispatch rule over the raw argument string; `bare-plan` is
 * pi's own, since only pi has a planning mode to leave. */
export function parseCaretArgs(args: string): CaretCommand {
  const arg = args.trim();
  if (!arg) return { kind: "usage" };
  if (arg === "plan") return { kind: "bare-plan" };
  if (arg === "doctor" || arg === "demo") return { kind: arg };
  const described = /^plan\s+(.+)$/s.exec(arg);
  return { kind: "plan", task: described?.[1] ?? arg };
}

/** The hint for a bare `/caret`; `planning` adds how to leave planning. */
export function usageText(planning: boolean): string {
  return [
    "/caret <what you want done> plans the change and opens the plan in caret for review. /caret plan <description> does the same, for a description that starts with doctor or demo.",
    "/caret doctor diagnoses this caret install.",
    "/caret demo walks a short demo plan through the review UI.",
    `${OPEN_KEY} opens the plan waiting for your review.`,
    ...(planning ? ["/caret plan leaves planning."] : []),
  ].join("\n");
}

/** Everything a `/caret` handler may read from pi's command context. */
export type CaretCommandContext = PlanningCommandContext &
  DemoCommandContext &
  DoctorCommandContext;

/** The slice of pi's extension API `/caret` calls; pinned by test/pi/sdk-conformance.ts. */
export type CommandApi = {
  registerCommand(
    name: string,
    options: {
      description: string;
      handler: (args: string, ctx: CaretCommandContext) => Promise<void>;
    },
  ): void;
};

/** What `/caret` dispatches to; built by the three installers. */
export type CaretHandlers = {
  planning: PlanningHandlers;
  demo: (ctx: DemoCommandContext) => Promise<void>;
  doctor: (ctx: DoctorCommandContext) => Promise<void>;
};

/** Registers `/caret` over the planning, demo and doctor handlers. */
export function installCaretCommand(pi: CommandApi, handlers: CaretHandlers): void {
  const { planning, demo, doctor } = handlers;
  const usage = (ctx: CaretCommandContext) =>
    ctx.ui.notify(usageText(planning.isPlanning(ctx)), "info");
  pi.registerCommand("caret", {
    description: "Plan a change and review it in caret, or run /caret doctor or /caret demo",
    handler: async (args, ctx) => {
      const command = parseCaretArgs(args);
      switch (command.kind) {
        case "usage":
          return usage(ctx);
        case "bare-plan":
          if (!planning.leave(ctx)) usage(ctx);
          return;
        case "doctor":
          return doctor(ctx);
        case "demo":
          return demo(ctx);
        case "plan":
          return planning.plan(command.task, ctx);
        default:
          command satisfies never;
      }
    },
  });
}
