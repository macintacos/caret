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

/** First call submits a plan; after a tool result, echo its text so pi's output shows
 * what the model received. */
const step: FauxResponseFactory = (context) => {
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
  // One step per model call; the run makes two, the rest is slack.
  faux.setResponses([step, step, step, step]);
  pi.registerProvider(faux.provider);
}
