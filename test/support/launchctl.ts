import type { LaunchctlResult } from "@/service/launchd-manager.ts";

const OK: LaunchctlResult = { code: 0, stdout: "", stderr: "" };

/** A launchctl that records every argv it is handed and answers from `reply`. */
export function fakeLaunchctl(reply: (args: string[]) => LaunchctlResult = () => OK) {
  const calls: string[][] = [];
  return {
    calls,
    subcommands: () => calls.map((args) => args[0]),
    launchctl: async (args: string[]) => {
      calls.push(args);
      return reply(args);
    },
  };
}
