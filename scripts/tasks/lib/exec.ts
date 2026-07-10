// Shared child-process helper for the tasks CLI: spawn a command inheriting
// this process's stdio and resolve its exit code. Every task run function that
// shells out to a tool (vite, hk, bun, playwright, mise, the compiled binary)
// goes through here, so the "spawn, inherit, propagate exit code" semantics live
// in one place. The child env is passed explicitly: Bun.spawn snapshots
// process.env at startup and ignores later mutations, so a run function that sets
// overrides must hand them to `env` rather than mutating process.env.

export interface ExecOpts {
  /** Working directory for the child (default: this process's cwd). */
  cwd?: string;
  /** Full child environment (default: this process's env, passed explicitly). */
  env?: Record<string, string>;
}

/** Spawn `cmd`, inherit stdio, and resolve the child's exit code. */
export async function runForward(cmd: string[], opts: ExecOpts = {}): Promise<number> {
  const child = Bun.spawn(cmd, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    cwd: opts.cwd,
    env: opts.env ?? (process.env as Record<string, string>),
  });
  return await child.exited;
}

/** Spawn `cmd` via runForward and exit this process with the child's code — the
 * "the tool's exit status is the task's exit status" tail shared by every task
 * that forwards to a single tool (build-ui, lint, format, test, test-e2e). */
export async function execAndExit(cmd: string[], opts: ExecOpts = {}): Promise<never> {
  process.exit(await runForward(cmd, opts));
}
