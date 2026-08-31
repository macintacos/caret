// Shared child-process helpers for the tasks CLI: `runForward` spawns a command
// inheriting this process's stdio, `runCapture` pipes both streams into a sink so
// a caller can render its own progress instead, and `lastDisplayLine` reduces a
// captured chunk to the one line such a display shows. Every task run function
// that shells out to a tool (vite, hk, bun, playwright, mise, the compiled
// binary) spawns through one of the two, so the "spawn, propagate exit code"
// semantics live in one place. The child env is passed explicitly: Bun.spawn snapshots
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

// ANSI escape sequences (color, cursor control). Children emit them even when
// piped — vite's clear-line progress is the common case — and a leaked
// cursor-control code would scribble over whatever live display is rendering
// the child, so display lines are stripped. Buffered output stays raw.
const ANSI_ESCAPES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/** `text` with ANSI control sequences removed. Also used on a captured runner
 * report — the escapes survive JSON encoding, so a colorized failure message
 * would otherwise reach a machine consumer full of them. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPES, "");
}

/** The last non-empty line of a chunk with ANSI control sequences stripped — the
 * single line a live progress display shows for a child that is still running. */
export function lastDisplayLine(chunk: string): string | undefined {
  return chunk
    .split("\n")
    .map((line) => stripAnsi(line).trim())
    .filter(Boolean)
    .at(-1);
}

/** Spawn `cmd` with stdout and stderr piped into `sink` rather than inherited,
 * resolving the child's exit code. The quiet twin of runForward: nothing reaches
 * this process's stdio, so a caller can render its own progress and replay the
 * captured log only when the child fails. stdin is closed rather than inherited
 * — a child under a live display must not race the caller for the terminal. */
export async function runCapture(
  cmd: string[],
  sink: (chunk: string) => void,
  opts: ExecOpts = {},
): Promise<number> {
  const child = Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts.cwd,
    env: opts.env ?? (process.env as Record<string, string>),
  });
  const drain = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) sink(decoder.decode(chunk, { stream: true }));
    const tail = decoder.decode(); // flush a partial multibyte sequence, if any
    if (tail) sink(tail);
  };
  const [, , code] = await Promise.all([drain(child.stdout), drain(child.stderr), child.exited]);
  return code;
}

/** Run `work` with a runForward-shaped runner whose children are CAPTURED rather
 * than inherited, resolving the exit code alongside everything they wrote. `onLine`
 * receives each chunk's last displayable line, so a caller can show one live line
 * for a step that would otherwise print hundreds. The spawner is injectable so a
 * test can drive this without real children.
 *
 * Never throws. A step can fail by throwing rather than by exiting non-zero — a
 * spawn that cannot start, a precondition that gives up — and the callers render
 * this behind a live display that RESOLVES a task's throw rather than rethrowing
 * it, so an escaping throw would be reported as a successful step. The stack goes
 * into the returned log instead, where an unexpected one is still diagnosable. */
export async function runQuietly(
  work: (run: typeof runForward) => Promise<number>,
  onLine: (line: string) => void,
  spawn: typeof runCapture = runCapture,
): Promise<{ code: number; output: string }> {
  const chunks: string[] = [];
  const run: typeof runForward = (cmd, opts) =>
    spawn(
      cmd,
      (chunk) => {
        chunks.push(chunk);
        const line = lastDisplayLine(chunk);
        if (line) onLine(line);
      },
      opts,
    );
  try {
    return { code: await work(run), output: chunks.join("") };
  } catch (err) {
    chunks.push(`${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`);
    return { code: 1, output: chunks.join("") };
  }
}

/** Write `text` to `stream` and wait for the flush. Anything written on the way to
 * `process.exit()` has to be awaited: exit truncates a piped write at the pipe
 * buffer — the 64KB cliff scripts/preflight.ts documents — and the tail it drops is
 * exactly the part a failure is read from. */
export async function writeAndFlush(stream: NodeJS.WriteStream, text: string): Promise<void> {
  await new Promise<void>((resolve) => stream.write(text, () => resolve()));
}

/** Spawn `cmd` via runForward and exit this process with the child's code — the
 * "the tool's exit status is the task's exit status" tail shared by every task
 * that forwards to a single tool (build ui, lint, format, test unit, test e2e). */
export async function execAndExit(cmd: string[], opts: ExecOpts = {}): Promise<never> {
  process.exit(await runForward(cmd, opts));
}
