#!/usr/bin/env bun
// Preflight orchestrator (EXC-462): runs the pre-push gate's constituent mise
// tasks concurrently per their dependency DAG, rendered as a live listr2 task
// list (plain line-per-event output when not a TTY). Check-only: nothing here
// writes to the tree — `lint` (hk check) is the formatting gate, and a lint
// failure points at `mise run format`.
//
// DAG: lint, test, and build-ui start immediately; test-e2e and build-bin
// start once build-ui passes. Both dependents declare depends=["build-ui"] in
// their mise task, and `mise run` has no --no-deps flag, so each is spawned
// with MISE_TASK_SKIP=build-ui to keep build-ui at exactly one run per gate.
//
// DI mirrors scripts/release/cli.ts: the spawn collaborator is injected so
// test/preflight.test.ts can drive the DAG without running real tasks;
// import.meta.main wires Bun.spawn and process.exit.

import { Listr, type ListrTask } from "listr2";

export interface SpawnOutcome {
  exitCode: number;
  output: string;
}

/** Runs one mise task to completion, reporting output lines for live display. */
export type SpawnTask = (
  name: string,
  env: Record<string, string> | undefined,
  onLine: (line: string) => void,
) => Promise<SpawnOutcome>;

export type TaskStatus = "passed" | "failed" | "skipped";

export interface TaskResult {
  status: TaskStatus;
  output: string;
}

export interface PreflightOutcome {
  results: Map<string, TaskResult>;
  exitCode: number;
  summary: string;
}

// --json reports (EXC-471): the documents an LLM/agent consumer reads instead
// of the human display — one before the run (planned tasks + the filters in
// effect), one after (per-task results). Failures show their output by default
// (abbreviated to a tail when large, with `totalLines` + `truncated` so the
// consumer knows there's more); passing tasks stay status-only. Verbosity turns
// that up: -v makes failures full and surfaces a snippet of passing tasks, -vv
// shows everything. --grep / --task narrow or scope further.
export interface PreflightStartReport {
  event: "start";
  schemaVersion: number;
  tasks: string[];
  /** Echoes the parsed output filters so the consumer can confirm its flags parsed. */
  filters: { verbosity: number; grep: string | null; tasks: string[] | null };
}

export interface PreflightTaskReport {
  name: string;
  status: TaskStatus;
  /** Captured output, included per the verbosity / --grep / --task selection. */
  output?: string;
  /** Total output lines, included when the output isn't fully inlined (a "fetch more" signal). */
  totalLines?: number;
  /** Lines matching --grep, included only when a pattern was supplied. */
  matchedLines?: number;
  /** True when `output` is a truncated tail of a larger capture (run with -v for the full text). */
  truncated?: boolean;
}

export interface PreflightResultReport {
  event: "result";
  schemaVersion: number;
  ok: boolean;
  tasks: PreflightTaskReport[];
}

export interface PreflightErrorReport {
  event: "error";
  schemaVersion: number;
  message: string;
}

/** The --json-mode flags parsed out of argv. All are inert without --json. */
export interface JsonArgs {
  json: boolean;
  verbosity: number;
  grep?: string;
  tasks: string[];
}

const IMMEDIATE = ["lint", "test", "build-ui"] as const;
const DEPENDENT = ["test-e2e", "build-bin"] as const;
const TASK_ORDER = [...IMMEDIATE, ...DEPENDENT];

// Bumpable integer so machine consumers detect a breaking shape change,
// mirroring scripts/release/contract.ts.
const SCHEMA_VERSION = 1;

// Shared by the human summary and the --json output so the remediation text
// can't drift between the two surfaces.
const LINT_FORMAT_HINT = "hint: run `mise run format` to fix formatting failures";

// At the default verbosity a large failed output is abbreviated to its last N
// lines — errors and summaries cluster at the end; `-v` shows the full capture.
const DEFAULT_OUTPUT_TAIL_LINES = 20;

export async function runPreflight(deps: {
  spawnTask: SpawnTask;
  renderer?: "default" | "silent";
}): Promise<PreflightOutcome> {
  const results = new Map<string, TaskResult>();
  const { promise: buildUiDone, resolve: releaseBuildUi } = Promise.withResolvers<boolean>();

  // Spawn one task, record its result, and report whether it passed. A spawn
  // rejection (e.g. the binary itself failing to start) counts as a failure.
  const runTask = async (
    name: string,
    env: Record<string, string> | undefined,
    onLine: (line: string) => void,
  ): Promise<boolean> => {
    let outcome: SpawnOutcome;
    try {
      outcome = await deps.spawnTask(name, env, onLine);
    } catch (err) {
      outcome = { exitCode: 1, output: String(err) };
    }
    const status = outcome.exitCode === 0 ? "passed" : "failed";
    results.set(name, { status, output: outcome.output });
    return status === "passed";
  };

  const immediate = (name: string): ListrTask => ({
    title: name,
    task: async (_ctx, task) => {
      const passed = await runTask(name, undefined, (line) => {
        task.output = line;
      });
      if (name === "build-ui") releaseBuildUi(passed);
      if (!passed) throw new Error(`${name} failed`);
    },
  });

  const dependent = (name: string): ListrTask => ({
    title: name,
    task: async (_ctx, task) => {
      task.output = "waiting for build-ui";
      if (!(await buildUiDone)) {
        results.set(name, { status: "skipped", output: "" });
        return task.skip(`${name} (skipped: build-ui failed)`);
      }
      const passed = await runTask(name, { MISE_TASK_SKIP: "build-ui" }, (line) => {
        task.output = line;
      });
      if (!passed) throw new Error(`${name} failed`);
    },
  });

  const listr = new Listr([...IMMEDIATE.map(immediate), ...DEPENDENT.map(dependent)], {
    concurrent: true,
    exitOnError: false,
    renderer: deps.renderer ?? "default",
    // Non-TTY (CI, pipes) auto-falls back to verbose: line-per-event, no
    // cursor-control sequences — color codes may still appear; that's expected.
    fallbackRenderer: "verbose",
  });
  await listr.run();

  const exitCode = [...results.values()].some((r) => r.status === "failed") ? 1 : 0;
  return { results, exitCode, summary: buildSummary(results) };
}

function buildSummary(results: Map<string, TaskResult>): string {
  const icons: Record<TaskStatus, string> = { passed: "✔", failed: "✘", skipped: "○" };
  const lines = ["preflight summary:"];
  for (const name of TASK_ORDER) {
    const result = results.get(name);
    if (!result) continue;
    lines.push(`  ${icons[result.status]} ${name.padEnd(9)} ${result.status}`);
  }
  for (const name of TASK_ORDER) {
    const result = results.get(name);
    if (result?.status !== "failed") continue;
    lines.push("", `--- ${name} output ---`, result.output.trimEnd());
    if (name === "lint") lines.push(LINT_FORMAT_HINT);
  }
  return lines.join("\n");
}

/**
 * Parse the --json-mode flags out of argv (EXC-471). `-v`/`-vv` accumulate into
 * verbosity; `--grep`/`--task` accept either a following arg or the `=` form;
 * `--task` is repeatable. All flags are inert unless `--json` is also present.
 */
export function parseJsonArgs(argv: string[]): JsonArgs {
  const args: JsonArgs = { json: false, verbosity: 0, tasks: [] };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === undefined) continue;
    if (arg === "--json") args.json = true;
    else if (/^-v+$/.test(arg)) args.verbosity += arg.length - 1;
    else if (arg === "--grep") {
      // An empty or missing value (e.g. `--grep` at the end) means no filter,
      // not a match-everything `new RegExp("")`.
      const value = rest[++i];
      if (value) args.grep = value;
    } else if (arg.startsWith("--grep=")) {
      const value = arg.slice("--grep=".length);
      if (value) args.grep = value;
    } else if (arg === "--task") {
      const name = rest[++i];
      if (name) args.tasks.push(name);
    } else if (arg.startsWith("--task=")) args.tasks.push(arg.slice("--task=".length));
  }
  return args;
}

/**
 * Parse the same flags from mise's `usage_*` env vars (EXC-471). When preflight
 * runs under its mise usage spec, mise consumes the flags and exposes them as
 * env vars rather than argv: `usage_json` ("true"), `usage_verbose` (a count),
 * `usage_grep` (the pattern), `usage_task` (space-joined names — mise task names
 * never contain spaces, so a whitespace split is exact).
 */
export function parseJsonEnv(env: Record<string, string | undefined>): JsonArgs {
  const args: JsonArgs = {
    json: env.usage_json === "true",
    verbosity: env.usage_verbose ? Number.parseInt(env.usage_verbose, 10) || 0 : 0,
    tasks: env.usage_task ? env.usage_task.trim().split(/\s+/).filter(Boolean) : [],
  };
  if (env.usage_grep) args.grep = env.usage_grep;
  return args;
}

/**
 * Resolve the --json-mode flags from whichever channel delivered them: mise's
 * `usage_*` env vars when running under the usage spec (`usage_json` is set only
 * then), or `process.argv` for a direct `bun scripts/preflight.ts …` / test run.
 */
export function resolveJsonArgs(argv: string[], env: Record<string, string | undefined>): JsonArgs {
  return env.usage_json === "true" ? parseJsonEnv(env) : parseJsonArgs(argv);
}

// Trailing-trimmed output split into lines; "" → [] so an empty capture is 0 lines.
function splitLines(output: string): string[] {
  const trimmed = output.trimEnd();
  return trimmed === "" ? [] : trimmed.split("\n");
}

// Fold the shared lint hint into a failed lint task's output so the JSON output
// and the human summary surface the same remediation step.
function withLintHint(name: string, status: TaskStatus, text: string): string {
  return name === "lint" && status === "failed" ? `${text}\n${LINT_FORMAT_HINT}` : text;
}

// How much of a task's output to inline, given its status, the verbosity level,
// and whether --task named it. Failures lead passing tasks by one notch: a
// failure shows a tail at level 0 and full output at -v; a passing task shows
// nothing at level 0, a tail at -v, and full at -vv. A --task-named task is
// always shown in full.
function outputDetail(
  status: TaskStatus,
  verbosity: number,
  scoped: boolean,
): "none" | "tail" | "full" {
  if (scoped) return "full";
  if (status === "failed") return verbosity >= 1 ? "full" : "tail";
  if (status === "passed") return verbosity >= 2 ? "full" : verbosity >= 1 ? "tail" : "none";
  return "none"; // skipped — nothing ran
}

/** Planned task set + the filters in effect, emitted to stdout before the run in --json mode. */
export function buildStartReport(
  args: JsonArgs = { json: true, verbosity: 0, tasks: [] },
): PreflightStartReport {
  return {
    event: "start",
    schemaVersion: SCHEMA_VERSION,
    tasks: [...TASK_ORDER],
    filters: {
      verbosity: args.verbosity,
      grep: args.grep ?? null,
      tasks: args.tasks.length > 0 ? args.tasks : null,
    },
  };
}

/**
 * Per-task results, emitted to stdout after the run in --json mode (EXC-471).
 * Failures show output by default — in full when small, or a truncated tail
 * (with `totalLines` + `truncated`) when large. Passing tasks are status-only
 * by default. Verbosity turns it up: `-v` makes failures full and adds a
 * snippet of passing tasks, `-vv` shows every task in full. `--grep` narrows
 * output to matching lines (with `matchedLines`); `--task` scopes to the named
 * task(s) and shows them in full (or, with `--grep`, the matching lines).
 */
export function buildResultReport(
  results: Map<string, TaskResult>,
  opts: { verbosity?: number; grep?: RegExp; tasks?: string[] } = {},
): PreflightResultReport {
  const verbosity = opts.verbosity ?? 0;
  const grep = opts.grep;
  const scope = opts.tasks && opts.tasks.length > 0 ? new Set(opts.tasks) : null;
  const tasks: PreflightTaskReport[] = [];
  for (const name of TASK_ORDER) {
    const result = results.get(name);
    if (!result) continue;
    const entry: PreflightTaskReport = { name, status: result.status };
    const lines = splitLines(result.output);
    const inScope = !scope || scope.has(name);
    if (inScope && lines.length > 0) {
      if (grep) {
        const matched = lines.filter((line) => grep.test(line));
        entry.matchedLines = matched.length;
        entry.totalLines = lines.length;
        if (matched.length > 0)
          entry.output = withLintHint(name, result.status, matched.join("\n"));
      } else {
        const detail = outputDetail(result.status, verbosity, scope !== null);
        if (detail === "full") {
          entry.output = withLintHint(name, result.status, result.output.trimEnd());
        } else if (detail === "tail") {
          if (lines.length > DEFAULT_OUTPUT_TAIL_LINES) {
            const tail = lines.slice(-DEFAULT_OUTPUT_TAIL_LINES).join("\n");
            entry.output = withLintHint(name, result.status, tail);
            entry.totalLines = lines.length;
            entry.truncated = true;
          } else {
            entry.output = withLintHint(name, result.status, result.output.trimEnd());
          }
        }
        // detail === "none" → status only
      }
    }
    tasks.push(entry);
  }
  return {
    event: "result",
    schemaVersion: SCHEMA_VERSION,
    ok: !tasks.some((t) => t.status === "failed"),
    tasks,
  };
}

/** Fatal arg error (currently only an invalid --grep regex), emitted to stdout in --json mode. */
export function buildErrorReport(message: string): PreflightErrorReport {
  return { event: "error", schemaVersion: SCHEMA_VERSION, message };
}

// ANSI escape sequences (color, cursor control). Children can emit them even
// when piped — e.g. vite's clear-line progress — and a leaked cursor-control
// code would break the plain line-per-event contract of the non-TTY fallback,
// so display lines are stripped (buffered failure output stays raw).
const ANSI_ESCAPES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

/**
 * Env for a nested `mise run <task>`: the parent env minus the `usage_*` flag
 * vars, with `extra` merged on top (extra wins; undefined parent values drop).
 *
 * mise injects `usage_json` / `usage_grep` / `usage_verbose` / `usage_task` for
 * THIS preflight's own flags and leaves them in the environment of any nested
 * `mise run` it spawns (verified). Those vars describe preflight, not the child,
 * and they are load-bearing: `resolveJsonArgs` treats `usage_json==="true"` as
 * "flags arrived via mise env" and then ignores argv. So a child chain
 * `mise run test` → `bun test` → preflight.test.ts's `preflight --grep [`
 * subprocess would inherit `usage_json=true`, ignore its `--grep [` argv, skip
 * the invalid-grep `exit(2)`, and recursively run the whole task graph — a fork
 * bomb. Stripping the vars at every nested boundary closes that at the source.
 */
export function withoutMiseUsageVars(
  parent: Record<string, string | undefined>,
  extra?: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) {
    if (v !== undefined && !k.startsWith("usage_")) out[k] = v;
  }
  return extra ? { ...out, ...extra } : out;
}

// Real spawner: runs `mise run <task>` with merged env, buffering combined
// stdout+stderr and reporting the last non-empty line for the live display.
async function spawnMiseTask(
  name: string,
  env: Record<string, string> | undefined,
  onLine: (line: string) => void,
): Promise<SpawnOutcome> {
  const proc = Bun.spawn(["mise", "run", name], {
    env: withoutMiseUsageVars(process.env, env),
    stdout: "pipe",
    stderr: "pipe",
  });
  const chunks: string[] = [];
  const pump = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true });
      chunks.push(text);
      const last = text
        .split("\n")
        .map((line) => line.replace(ANSI_ESCAPES, "").trim())
        .filter(Boolean)
        .at(-1);
      if (last) onLine(last);
    }
    const tail = decoder.decode(); // flush a partial multibyte sequence, if any
    if (tail) chunks.push(tail);
  };
  const [exitCode] = await Promise.all([proc.exited, pump(proc.stdout), pump(proc.stderr)]);
  return { exitCode, output: chunks.join("") };
}

// --json (EXC-471): suppress the human display and emit machine-readable
// documents on stdout instead. parseJsonArgs matches whether mise forwards the
// flags as `... --json` or `... -- --json`.
async function runCli(argv: string[], env: Record<string, string | undefined>): Promise<void> {
  const args = resolveJsonArgs(argv, env);

  if (!args.json) {
    if (args.verbosity > 0 || args.grep !== undefined || args.tasks.length > 0) {
      process.stderr.write(
        "preflight: -v / --grep / --task only apply with --json; ignoring them.\n",
      );
    }
    const { exitCode, summary } = await runPreflight({
      spawnTask: spawnMiseTask,
      renderer: "default",
    });
    process.stdout.write(`\n${summary}\n`);
    process.exitCode = exitCode;
    return;
  }

  let grep: RegExp | undefined;
  if (args.grep !== undefined) {
    try {
      grep = new RegExp(args.grep);
    } catch {
      process.stdout.write(
        `${JSON.stringify(buildErrorReport(`invalid --grep pattern: ${args.grep}`))}\n`,
      );
      process.exitCode = 2;
      return;
    }
  }

  process.stdout.write(`${JSON.stringify(buildStartReport(args))}\n`);
  const { results, exitCode } = await runPreflight({
    spawnTask: spawnMiseTask,
    renderer: "silent",
  });
  process.stdout.write(
    `${JSON.stringify(buildResultReport(results, { verbosity: args.verbosity, grep, tasks: args.tasks }))}\n`,
  );
  // exitCode (not process.exit) so stdout drains: a piped consumer — CI, the
  // release gate's .quiet() — would otherwise see output truncated at the pipe
  // buffer (verified: exit() after a 1MB write delivers only 64KB).
  process.exitCode = exitCode;
}

if (import.meta.main) {
  await runCli(process.argv, process.env);
}
