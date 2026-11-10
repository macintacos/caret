// Spawn-and-capture for the external CLIs caret drives — the service supervisors and
// pi's package commands.

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

/** Runs `argv` with stdin and stderr ignored and returns its exit code and stdout; the
 * code is null when the bound killed it. At `timeoutMs` the whole process group is
 * killed — a wrapper's grandchild holding stdout would otherwise keep the read open.
 * May throw when `argv[0]` cannot be spawned. */
export async function runBounded(
  argv: readonly string[],
  timeoutMs: number,
): Promise<{ exitCode: number | null; stdout: string }> {
  const proc = Bun.spawn([...argv], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
    detached: true,
  });
  let killed = false;
  const timer = setTimeout(() => {
    killed = true;
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      // The group already exited between the last read and the bound.
    }
  }, timeoutMs);
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  clearTimeout(timer);
  return { exitCode: killed ? null : code, stdout };
}

/** A supervisor CLI's own exit code and stderr, kept because its status is stable where
 * its prose is not — launchctl's 113 and systemd's 4 outlive the wording beside them. */
export function commandError(tool: string, verb: string, result: CommandResult): Error {
  return new Error(
    `caret service: ${tool} ${verb} failed (${result.code}): ${result.stderr.trim()}`,
  );
}
