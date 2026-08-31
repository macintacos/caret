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

/** `text` with ANSI control sequences removed. Also used on captured reports —
 * the escapes survive JSON encoding, so a runner's colorized failure message
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
  const child = spawnPiped(cmd, opts);
  const [, , code] = await Promise.all([
    drain(child.stdout, sink),
    drain(child.stderr, sink),
    child.exited,
  ]);
  return code;
}

/** Spawn `cmd` with both streams piped and buffered SEPARATELY, resolving the
 * exit code alongside each stream's full text. runCapture's sibling for a child
 * whose stdout is data rather than log: `test --json` reads Playwright's report
 * off stdout, which a single interleaved sink would mix with its stderr. */
export async function runCaptureSplit(
  cmd: string[],
  opts: ExecOpts = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = spawnPiped(cmd, opts);
  const out: string[] = [];
  const err: string[] = [];
  const [, , code] = await Promise.all([
    drain(child.stdout, (chunk) => out.push(chunk)),
    drain(child.stderr, (chunk) => err.push(chunk)),
    child.exited,
  ]);
  return { code, stdout: out.join(""), stderr: err.join("") };
}

/** Spawn with both streams piped. stdin is closed rather than inherited — a
 * child whose output the caller is capturing must not race it for the terminal. */
function spawnPiped(cmd: string[], opts: ExecOpts) {
  return Bun.spawn(cmd, {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    cwd: opts.cwd,
    env: opts.env ?? (process.env as Record<string, string>),
  });
}

/** Decode one piped stream into `sink`, flushing any partial multibyte tail. */
async function drain(
  stream: ReadableStream<Uint8Array>,
  sink: (chunk: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) sink(decoder.decode(chunk, { stream: true }));
  const tail = decoder.decode();
  if (tail) sink(tail);
}

/** Spawn `cmd` via runForward and exit this process with the child's code — the
 * "the tool's exit status is the task's exit status" tail shared by every task
 * that forwards to a single tool (build ui, lint, format, test unit, test e2e). */
export async function execAndExit(cmd: string[], opts: ExecOpts = {}): Promise<never> {
  process.exit(await runForward(cmd, opts));
}
