// `format` task: format + autofix the whole tree (hk fix). `--no-stage` leaves
// the resulting working-tree changes unstaged. Extra args (e.g. specific paths)
// are forwarded to `hk fix`.

import { paletteCssCommand } from "@/tasks/build.ts";
import { execAndExit, runForward } from "@/tasks/lib/exec.ts";

/** The argv `format` runs, plus forwarded args. */
export function formatCommand(args: string[]): string[] {
  return ["hk", "fix", "--all", "--no-stage", ...args];
}

export async function runFormat(args: string[]): Promise<never> {
  // Same prerequisite as `lint`: hk's Tailwind step loads ui/src/app.css through
  // Tailwind's design-system API, which resolves the generated palette @import.
  const palette = await runForward(paletteCssCommand());
  if (palette !== 0) process.exit(palette);
  return execAndExit(formatCommand(args));
}
