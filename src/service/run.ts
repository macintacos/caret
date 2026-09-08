// Spawn-and-capture for the supervisor CLIs the platform managers drive — launchctl on
// macOS, systemctl and loginctl on Linux.

import { errorMessage } from "@/lib/types.ts";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `argv`, capturing both streams. Never rejects: a non-zero exit and a tool that
 * is not installed both come back as a result, so a caller on a host without the tool
 * branches rather than catching. */
export async function runCommand(argv: string[]): Promise<CommandResult> {
  let proc: Bun.Subprocess<"ignore", "pipe", "pipe">;
  try {
    proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  } catch (err) {
    // The shell's own status for a command that is not there — a whole class of host
    // (a distro with no systemd) rather than a command that ran and failed.
    return { code: 127, stdout: "", stderr: errorMessage(err) };
  }
  // Drained alongside proc.exited rather than after it, so a command that outfills the
  // pipe buffer cannot wedge on a reader that never started.
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}

/** A supervisor CLI's own exit code and stderr, kept because its status is stable where
 * its prose is not — launchctl's 113 and systemd's 4 outlive the wording beside them. */
export function commandError(tool: string, verb: string, result: CommandResult): Error {
  return new Error(
    `caret service: ${tool} ${verb} failed (${result.code}): ${result.stderr.trim()}`,
  );
}
