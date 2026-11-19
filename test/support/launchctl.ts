import { basename } from "node:path";

import type { LaunchctlResult } from "@/service/launchd-manager.ts";

const OK: LaunchctlResult = { code: 0, stdout: "", stderr: "" };
const NO_SUCH_SERVICE: LaunchctlResult = { code: 113, stdout: "", stderr: "" };

/** A launchctl that records every argv it is handed and answers from `reply` — except that,
 * as launchd does, a `print` of a target booted out and not since bootstrapped finds
 * nothing. */
export function fakeLaunchctl(reply: (args: string[]) => LaunchctlResult = () => OK) {
  const calls: string[][] = [];
  const bootedOut = new Set<string>();
  return {
    calls,
    subcommands: () => calls.map((args) => args[0]),
    launchctl: async (args: string[]) => {
      calls.push(args);
      const [cmd, target = "", plist = ""] = args;
      if (cmd === "bootout") bootedOut.add(target);
      if (cmd === "bootstrap") bootedOut.delete(`${target}/${basename(plist, ".plist")}`);
      if (cmd === "print" && bootedOut.has(target)) return NO_SUCH_SERVICE;
      return reply(args);
    },
  };
}
