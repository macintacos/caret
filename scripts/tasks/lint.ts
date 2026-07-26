// `lint` task: caret's read-only formatting + lint gate (hk check over the whole
// tree). Extra args (e.g. specific paths) are forwarded to `hk check`.

import { paletteCssCommand } from "@/tasks/build.ts";
import { execAndExit, runForward } from "@/tasks/lib/exec.ts";

/** The argv `lint` runs, plus forwarded args. */
export function lintCommand(args: string[]): string[] {
  return ["hk", "check", "--all", ...args];
}

export async function runLint(args: string[]): Promise<never> {
  // hk's Tailwind step loads ui/src/app.css through Tailwind's design-system
  // API, which resolves its @imports — including the generated palette partial.
  // Emit it first so a checkout without one fails on real lint findings rather
  // than an ENOENT from inside Tailwind.
  const palette = await runForward(paletteCssCommand());
  if (palette !== 0) process.exit(palette);
  return execAndExit(lintCommand(args));
}
