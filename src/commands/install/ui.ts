// How `caret install` talks to the terminal. Every install surface — the intro, each
// operation's spinner, warnings, the dry-run preview, the closing line — goes through
// one reporter so the whole command reads as a single @clack/prompts session rather
// than a mix of prompt chrome and bare stdout writes.
//
// It is an interface, not a direct clack dependency, for two reasons: the target
// runners stay unit-testable against a recorder, and the real implementation can
// dynamic-import clack (src/cli.ts is the review hook's entrypoint on every plan, so
// nothing on the import path may pull clack in eagerly).
//
// Two implementations, chosen once per run: clack's session for a human at a terminal,
// plain `caret: …` lines everywhere else. clack draws its bars, colors, and cursor
// escapes unconditionally — it honours neither NO_COLOR nor a piped stdout — so without
// that split a CI transcript, or any log capturing the install's output, would fill with
// escape junk. The chooser stays clack either way: NO_COLOR asks for no color, not for a
// question to go unasked.

/** Report sub-status while a step is still running (e.g. the command being spawned). */
export type StepDetail = (message: string) => void;

/** Whether this run can ask the user a question. BOTH ends must be a terminal: a prompt
 * reads keys from stdin and draws to stdout, so a piped stdout would render its UI into
 * the pipe and look like a hang. Every surface that gates on *asking* — the target
 * chooser, the OpenCode upgrade confirm — resolves through this one predicate;
 * `createInstallUI`'s own render check is separate and stricter (it also honours NO_COLOR
 * and CI), because drawing clack's chrome and asking a question are different questions. */
export function isTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

export interface InstallUI {
  /** Open the session. `action` is the bare verb ("install", "uninstall (dry run)") —
   * each implementation brands it, so no caller hand-rolls a "caret" prefix. */
  intro(action: string): void;
  /**
   * Run one operation behind a spinner. `work` may call its `detail` argument to
   * update the spinner's message while it runs; `done` renders the settled line from
   * whatever `work` returned. A throwing `work` settles the step as failed and the
   * error propagates — callers that treat a failure as non-fatal catch it themselves.
   */
  step<T>(
    label: string,
    work: (detail: StepDetail) => Promise<T>,
    done?: (value: T) => string,
  ): Promise<T>;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** A titled block — the dry-run preview's home. */
  note(body: string, title: string): void;
  /** Close the session after the user aborted. */
  cancel(message: string): void;
  /** Close the session. */
  outro(message: string): void;
}

/** Runs the work, renders nothing. The default for a runner called without a UI (every
 * unit test that doesn't assert on presentation). */
export const silentUI: InstallUI = {
  intro: () => {},
  step: async (_label, work) => work(() => {}),
  info: () => {},
  warn: () => {},
  error: () => {},
  note: () => {},
  cancel: () => {},
  outro: () => {},
};

/** A UI that records what it was asked to render, for tests that assert the step
 * sequence a runner reports. */
export function recordingUI(): InstallUI & { events: string[] } {
  const events: string[] = [];
  return {
    events,
    intro: (t) => void events.push(`intro:${t}`),
    async step(label, work, done) {
      events.push(`step:${label}`);
      try {
        const value = await work((m) => void events.push(`detail:${m}`));
        events.push(`settled:${done ? done(value) : label}`);
        return value;
      } catch (e) {
        events.push(`failed:${label}`);
        throw e;
      }
    },
    info: (m) => void events.push(`info:${m}`),
    warn: (m) => void events.push(`warn:${m}`),
    error: (m) => void events.push(`error:${m}`),
    note: (_body, title) => void events.push(`note:${title}`),
    cancel: (m) => void events.push(`cancel:${m}`),
    outro: (m) => void events.push(`outro:${m}`),
  };
}

/** Plain `caret: …` lines, for when there is no terminal to draw to. clack renders its
 * bars, colors, and cursor hide/show escapes unconditionally — it honours neither
 * NO_COLOR nor a piped stdout — so a captured log or a CI transcript would fill with
 * escape junk. Steps report once, when they settle: the settled line names the outcome,
 * and nobody is watching a spinner. */
function plainUI(write: (s: string) => void): InstallUI {
  const line = (s: string) => write(`caret: ${s}\n`);
  return {
    intro: (action) => line(action),
    async step(label, work, done) {
      try {
        const value = await work(() => {});
        line(done ? done(value) : label);
        return value;
      } catch (e) {
        line(`${label} — failed`);
        throw e;
      }
    },
    info: line,
    warn: line,
    error: line,
    note: (body, title) =>
      line(
        `${title}\n${body
          .split("\n")
          .map((l) => `  ${l}`)
          .join("\n")}`,
      ),
    cancel: line,
    outro: line,
  };
}

/** Options exist for the tests: production reads the real terminal. */
export interface InstallUIOptions {
  /** Draw clack's full session? Defaults to "stdout is a terminal, and the environment
   * hasn't asked for plain output". */
  interactive?: boolean;
  /** Where the plain reporter writes. */
  write?: (s: string) => void;
}

/** Build the reporter for this run: clack's session for a human at a terminal, plain
 * lines everywhere else. Loads clack lazily so only an actual `caret install` pays for
 * it, and reuses that one module instance for every surface (including the chooser). */
export async function createInstallUI(opts: InstallUIOptions = {}): Promise<InstallUI> {
  const write = opts.write ?? ((s: string) => void process.stdout.write(s));
  const interactive =
    opts.interactive ??
    (process.stdout.isTTY === true && !process.env.NO_COLOR && process.env.CI !== "true");
  if (!interactive) return plainUI(write);

  const clack = await import("@clack/prompts");
  return {
    intro: (action) => clack.intro(`caret · ${action}`),
    async step(label, work, done) {
      const spin = clack.spinner();
      spin.start(label);
      try {
        const value = await work((m) => spin.message(m));
        spin.stop(done ? done(value) : label);
        return value;
      } catch (e) {
        spin.error(label);
        throw e;
      }
    },
    info: (m) => clack.log.info(m),
    warn: (m) => clack.log.warn(m),
    error: (m) => clack.log.error(m),
    note: (body, title) => clack.note(body, title),
    cancel: (m) => clack.cancel(m),
    outro: (m) => clack.outro(m),
  };
}
