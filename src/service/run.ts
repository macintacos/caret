// Spawn-and-capture for the supervisor CLIs the platform managers drive — launchctl
// on macOS, systemctl and loginctl on Linux. One helper because both need the same
// three things back and the same drain discipline; nothing here knows which tool it
// is running.

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `argv` and capture what it wrote. Never rejects on a non-zero exit — every
 * caller branches on the status rather than on a throw. */
export async function runCommand(argv: string[]): Promise<CommandResult> {
  const proc = Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" });
  // Drained alongside proc.exited, never after it: a command that filled either pipe
  // would block forever waiting for a reader that had not started.
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout, stderr };
}
