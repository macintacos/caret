// A single live progress line for a task step that would otherwise print its whole
// transcript. `mise run build` renders one for the UI+binary build (vite alone is
// some four hundred lines); `mise run test e2e` renders one for the UI build it
// does first. The captured log is not thrown away — it comes back for the caller
// to replay when the step fails, which is what makes hiding it safe.

import { Listr } from "listr2";

/** Run `work` under one live progress line titled `title`, resolving its exit code
 * and captured log. `work` is handed an `onLine` sink and reports progress through
 * it; the line shows the latest.
 *
 * The task's throw is how listr2 is told to render the line red — the outcome
 * travels in the returned value, never in that throw. */
export async function underProgressLine(
  title: string,
  work: (onLine: (line: string) => void) => Promise<{ code: number; output: string }>,
): Promise<{ code: number; output: string }> {
  let result: { code: number; output: string } | undefined;
  const listr = new Listr(
    [
      {
        title,
        task: async (_ctx, task) => {
          result = await work((line) => {
            task.output = line;
          });
          if (result.code !== 0) throw new Error("failed — full log below");
        },
      },
    ],
    {
      exitOnError: false,
      // listr2's own SIGINT handler calls process.exit(127) before the children
      // see anything; Ctrl-C must reach them through the foreground process group,
      // as it does today.
      registerSignalListeners: false,
      // Non-TTY (CI, a pipe) falls back to line-per-event, so a piped run still
      // reports progress instead of going silent.
      fallbackRenderer: "verbose",
    },
  );
  await listr.run();
  // `exitOnError: false` makes listr2 collect a task's throw rather than rethrow it,
  // so a task that died before assigning leaves `result` unset. That is a failed
  // step, not a silent success — listr2 has already rendered the error on the line.
  return result ?? { code: 1, output: "" };
}
