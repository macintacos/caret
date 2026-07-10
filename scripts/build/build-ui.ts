// `build-ui` task: build the Svelte UI with Vite into ui/dist. It runs from the
// `ui/` workspace (its own vite config); extra args are forwarded to
// `vite build`.

import { runForward } from "../tasks/exec.ts";

/** The argv `build-ui` runs (from the `ui/` directory), plus forwarded args. */
export function buildUiCommand(args: string[]): string[] {
  return ["bunx", "vite", "build", ...args];
}

export async function runBuildUi(args: string[]): Promise<never> {
  process.exit(await runForward(buildUiCommand(args), { cwd: "ui" }));
}
