import type { PluginInput } from "@opencode-ai/plugin";

/** A plugin client that records every toast shown via `client.tui.showToast`. */
export function recordingClient(): {
  client: PluginInput["client"];
  toasts: Array<{ title?: string; message: string; variant: string }>;
} {
  const toasts: Array<{ title?: string; message: string; variant: string }> = [];
  const client = {
    tui: {
      showToast: (opts: { body: { title?: string; message: string; variant: string } }) => {
        toasts.push({
          title: opts.body.title,
          message: opts.body.message,
          variant: opts.body.variant,
        });
        return Promise.resolve({});
      },
    },
  } as unknown as PluginInput["client"];
  return { client, toasts };
}
