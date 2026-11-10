// Sends a slash command's prompt as a follow-up and waits for the run it starts, so print
// mode stays up until the agent has answered.

type FollowUpApi = { sendUserMessage(content: string, options: { deliverAs: "followUp" }): void };

/** Queues `content` as a follow-up and resolves once the run it starts has finished. */
export async function sendAndWait(
  pi: FollowUpApi,
  ctx: { waitForIdle(): Promise<void> },
  content: string,
): Promise<void> {
  pi.sendUserMessage(content, { deliverAs: "followUp" });
  // ponytail: one macrotask lets the queued run start before waitForIdle; a run whose
  // preflight awaits I/O (an extension's `input` handler, the auth check) starts later, so
  // a print-mode run of a command that sends a follow-up may exit early. Fix once pi exposes
  // the queued run's promise.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await ctx.waitForIdle();
}
