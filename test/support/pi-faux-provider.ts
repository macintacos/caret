// A pi extension that scripts pi's model with pi-ai's faux provider. pi loads it with
// `-e`, so it runs on Node: no bun APIs.
import {
  type FauxResponseFactory,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const FAUX_PLAN_TITLE = "Live check plan";

const STEER_HEADING = "## Planning mode (caret)";

type Message = Parameters<FauxResponseFactory>[0]["messages"][number];

function textOf(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

const hasSteer = (messages: Message[]) =>
  messages.some((m) => m.role === "user" && textOf(m).includes(STEER_HEADING));

/** The plan path: from the steer while it is present, else from the plan write already made. */
function planPath(messages: Message[]): string | undefined {
  for (const m of messages) {
    if (m.role === "user") {
      const file = textOf(m).match(/`([^`]*<short-name>-[^`]*\.md)`/)?.[1];
      if (file && textOf(m).includes(STEER_HEADING))
        return file.replace("<short-name>", "greeting");
    }
    if (m.role === "assistant") {
      for (const part of m.content) {
        const path = part.type === "toolCall" ? part.arguments.path : undefined;
        if (typeof path === "string" && path.endsWith(".md")) return path;
      }
    }
  }
  return undefined;
}

const write = (path: string, content: string) =>
  fauxAssistantMessage(fauxToolCall("write", { path, content }), { stopReason: "toolUse" });

/** /caret:plan's run: write the plan, attempt a blocked write, submit, write again after
 * the review, then report whether the steer still reaches the model. */
function planningStep(messages: Message[], plan: string) {
  const results = messages.filter((m) => m.role === "toolResult").length;
  if (results === 0) return write(plan, "# Greeting\n\n1. Add greeting.txt.\n");
  if (results === 1 || results === 3) return write("greeting.txt", "hello");
  if (results === 2) {
    return fauxAssistantMessage(fauxToolCall("caret_review_plan", { path: plan }), {
      stopReason: "toolUse",
    });
  }
  return fauxAssistantMessage(
    fauxText(`steer after approval: ${hasSteer(messages) ? "yes" : "no"}`),
  );
}

/** `steer check` serves driving pi by hand with this provider: it replies whether the
 * planning steer reaches the model. A planning run follows planningStep; otherwise the
 * first call submits a plan, and after a tool result the model echoes its text so pi's
 * output shows what it received. */
const step: FauxResponseFactory = (context) => {
  const lastUser = context.messages.findLast(
    (m) => m.role === "user" && !textOf(m).includes(STEER_HEADING),
  );
  if (lastUser && textOf(lastUser).trim() === "steer check") {
    return fauxAssistantMessage(fauxText(`steer: ${hasSteer(context.messages) ? "yes" : "no"}`));
  }
  const plan = planPath(context.messages);
  if (plan) return planningStep(context.messages, plan);
  const lastMessage = context.messages.at(-1);
  if (lastMessage?.role === "toolResult") {
    const text = lastMessage.content
      .flatMap((part) => (part.type === "text" ? [part.text] : []))
      .join("\n");
    return fauxAssistantMessage(fauxText(text));
  }
  return fauxAssistantMessage(
    fauxToolCall("caret_review_plan", {
      plan: `# ${FAUX_PLAN_TITLE}\n\n1. Prove the pi extension end to end.\n`,
    }),
    { stopReason: "toolUse" },
  );
};

export default function (pi: ExtensionAPI): void {
  const faux = fauxProvider({ provider: "faux" });
  // One step per model call: a planning run makes five; the rest is slack for a
  // hand-driven interactive session.
  faux.setResponses(Array(32).fill(step));
  pi.registerProvider(faux.provider);
}
