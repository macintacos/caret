#!/usr/bin/env bun
// Preflight orchestrator (EXC-462): runs the pre-push gate's constituent mise
// tasks concurrently per their dependency DAG, rendered as a live listr2 task
// list (plain line-per-event output when not a TTY). Check-only: nothing here
// writes to the tree — `lint` (hk check) is the formatting gate, and a lint
// failure points at `mise run format`.
//
// DAG: lint, test (unit), and `build ui` start immediately; `test e2e` and
// `build bin` start once `build ui` passes. The UI-first ordering + skip
// mechanism now live in the tasks CLI (scripts/tasks/build.ts), so each
// dependent is spawned with CARET_SKIP_BUILD_UI=1 to keep the UI built at exactly
// one run per gate — two concurrent Vite builds would otherwise race on ui/dist.
// (This replaces the old MISE_TASK_SKIP=build-ui dedupe of the mise `depends`
// edge, which is gone now that build/test are single multi-target tasks.)
//
// DI mirrors scripts/tasks/release/command.ts: the spawn collaborator is injected so
// test/scripts/preflight.test.ts can drive the DAG without running real tasks.
// The tasks CLI's `preflight` subcommand (scripts/tasks/cli.ts) is the entry
// point — it parses the --json flags and calls runPreflightCli, which wires the
// real spawner (EXC-737).
//
// Interruption safety (EXC-587): the real spawner runs each task as a detached
// process group; SIGINT/SIGTERM tear every group down before exit, and the
// first failure aborts in-flight siblings, so an interrupted gate can't orphan
// the mise → bun/vite/tsc/playwright → chromium+daemon subtree.

import { type ChildProcess, type SpawnOptions, spawn } from "node:child_process";
import { once } from "node:events";
import { availableParallelism } from "node:os";
import type { Readable } from "node:stream";
import { Listr, type ListrTask } from "listr2";

export interface SpawnOutcome {
  exitCode: number;
  output: string;
  /**
   * True when this task's process group was killed by fail-fast after a sibling
   * failed (EXC-587). Such a task is recorded `skipped`, not `failed`, so a
   * genuine failure isn't drowned out by the siblings it tore down.
   */
  aborted?: boolean;
}

/**
 * Runs one mise task to completion, reporting output lines for live display.
 * `signal` aborts when a sibling fails (EXC-587); a spawner that honors it
 * tears its process group down and resolves with `aborted: true`.
 */
export type SpawnTask = (
  name: string,
  env: Record<string, string> | undefined,
  onLine: (line: string) => void,
  signal: AbortSignal,
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

/** The --json-mode flags (parsed by the tasks CLI's commander tree). All are
 * inert without --json. */
export interface JsonArgs {
  json: boolean;
  verbosity: number;
  grep?: string;
  tasks: string[];
}

// Task identifiers are the multi-word `mise run` invocations (EXC-738/739): the
// spawner splits each on spaces into `mise run <words…>` (mise task names never
// contain spaces, so the split is exact). They double as the map keys and the
// display titles.
const IMMEDIATE = ["lint", "test", "build ui"] as const;
const DEPENDENT = ["test e2e", "build bin"] as const;
const TASK_ORDER = [...IMMEDIATE, ...DEPENDENT];

// Bumpable integer so machine consumers detect a breaking shape change,
// mirroring scripts/tasks/release/contract.ts.
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
  /** Max tasks in flight (EXC-587); defaults to the host's CPU count. */
  concurrency?: number;
}): Promise<PreflightOutcome> {
  const results = new Map<string, TaskResult>();
  const { promise: buildUiDone, resolve: releaseBuildUi } = Promise.withResolvers<boolean>();
  // EXC-587: the first task to fail aborts every in-flight sibling. A spawner
  // that honors the signal tears its process group down and resolves
  // `aborted` — recorded `skipped` so the doomed gate stops burning CPU on
  // work it will discard, while the real failure stays the only `failed` row.
  const failFast = new AbortController();

  // Spawn one task and record its result. A spawn rejection (e.g. the binary
  // failing to start) counts as a failure; a fail-fast abort counts as skipped.
  const runTask = async (
    name: string,
    env: Record<string, string> | undefined,
    onLine: (line: string) => void,
  ): Promise<TaskStatus> => {
    let outcome: SpawnOutcome;
    try {
      outcome = await deps.spawnTask(name, env, onLine, failFast.signal);
    } catch (err) {
      outcome = { exitCode: 1, output: String(err) };
    }
    if (outcome.aborted) {
      results.set(name, { status: "skipped", output: outcome.output });
      return "skipped";
    }
    const status: TaskStatus = outcome.exitCode === 0 ? "passed" : "failed";
    results.set(name, { status, output: outcome.output });
    if (status === "failed") failFast.abort();
    return status;
  };

  const immediate = (name: string): ListrTask => ({
    title: name,
    task: async (_ctx, task) => {
      const status = await runTask(name, undefined, (line) => {
        task.output = line;
      });
      if (name === "build ui") releaseBuildUi(status === "passed");
      if (status === "skipped") return task.skip(`${name} (aborted: a sibling failed)`);
      if (status === "failed") throw new Error(`${name} failed`);
    },
  });

  const dependent = (name: string): ListrTask => ({
    title: name,
    task: async (_ctx, task) => {
      task.output = "waiting for build ui";
      if (!(await buildUiDone)) {
        results.set(name, { status: "skipped", output: "" });
        return task.skip(`${name} (skipped: build ui failed)`);
      }
      const status = await runTask(name, { CARET_SKIP_BUILD_UI: "1" }, (line) => {
        task.output = line;
      });
      if (status === "skipped") return task.skip(`${name} (aborted: a sibling failed)`);
      if (status === "failed") throw new Error(`${name} failed`);
    },
  });

  const listr = new Listr([...IMMEDIATE.map(immediate), ...DEPENDENT.map(dependent)], {
    // EXC-587: a finite cap (host CPU count by default) instead of the prior
    // `true` (→ Infinity), so a constrained or stacked host can't oversubscribe;
    // CARET_PREFLIGHT_JOBS lowers it further. ≥ the 5-task count is a no-op, so
    // the default preserves today's effective parallelism on real hosts.
    concurrent: deps.concurrency ?? availableParallelism(),
    exitOnError: false,
    // EXC-587: listr2's own SIGINT handler calls process.exit(127)
    // synchronously, which would beat our async SIGINT teardown and orphan the
    // task groups — the exact failure this work prevents. Disable it so our
    // installSignalHandlers is the sole authority on interruption.
    registerSignalListeners: false,
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
    lines.push(`  ${icons[result.status]} ${name.padEnd(10)} ${result.status}`);
  }
  for (const name of TASK_ORDER) {
    const result = results.get(name);
    if (result?.status !== "failed") continue;
    lines.push("", `--- ${name} output ---`, result.output.trimEnd());
    if (name === "lint") lines.push(LINT_FORMAT_HINT);
  }
  return lines.join("\n");
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

/** A registry of detached child process groups, killable as whole subtrees. */
export interface ProcessGroupController {
  /** Spawn `cmd` as its own process-group leader and track it. */
  spawn(cmd: string, args: string[], opts: SpawnOptions): ChildProcess;
  /** Tear down one child's group: SIGTERM, then SIGKILL after the grace. */
  reap(child: ChildProcess): Promise<void>;
  /** Tear down every still-live child group (signal-handler path). */
  killAll(): Promise<void>;
  /** Count of children that have not yet exited. */
  readonly size: number;
}

/**
 * A registry of detached child process groups (EXC-587). Each child is spawned
 * with `detached: true`, so it leads its own process group and the whole
 * `mise → bash → bun/vite/tsc/playwright → chromium+daemon` subtree shares that
 * group — killable in one shot via `process.kill(-pid, …)`. (`Bun.spawn` keeps
 * children in the orchestrator's own group, so node's `spawn` is used here
 * specifically for the per-child group isolation `Bun.spawn` can't give.)
 *
 * `reap`/`killAll` escalate SIGTERM → SIGKILL after a grace, mirroring the
 * daemon reap in test/e2e/support/fixtures.ts. This reaps only on a CATCHABLE
 * death — the SIGINT/SIGTERM handlers, or a fail-fast abort. A SIGKILL of the
 * orchestrator runs no handler, and an orphaned process group is NOT
 * auto-reaped by the OS; bounding the fan-out (CARET_PREFLIGHT_JOBS, plus the
 * Playwright `workers` cap + `globalTimeout`) is what keeps that case from
 * arising rather than relying on a teardown that can't run.
 */
export function createProcessGroupController(graceMs = 2000): ProcessGroupController {
  const live = new Set<ChildProcess>();
  const killGroup = (child: ChildProcess, sig: NodeJS.Signals) => {
    try {
      if (child.pid) process.kill(-child.pid, sig);
    } catch {
      // ESRCH: the group already exited between the liveness check and the
      // signal — nothing left to kill.
    }
  };
  const reap = async (child: ChildProcess): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    // `once` rejects if an 'error' (e.g. a failed spawn) precedes 'close'; we
    // only need to wait for the child to be gone, so swallow that — reap must
    // never reject (it's awaited via fire-and-forget on the abort path).
    const exited = once(child, "close").catch(() => {});
    killGroup(child, "SIGTERM");
    const escalate = setTimeout(() => killGroup(child, "SIGKILL"), graceMs);
    await exited;
    clearTimeout(escalate);
  };
  return {
    spawn(cmd, args, opts) {
      const child = spawn(cmd, args, { ...opts, detached: true });
      live.add(child);
      // A failed spawn emits 'error' asynchronously; with no listener node
      // rethrows it as an uncaught exception. Absorb it here so the controller
      // can't crash the process regardless of caller — callers still attach
      // their own 'error'/'close' for the task outcome. 'close' fires after
      // 'error', so the registry self-cleans either way.
      child.on("error", () => {});
      child.once("close", () => live.delete(child));
      return child;
    },
    reap,
    async killAll() {
      await Promise.all([...live].map((child) => reap(child)));
    },
    get size() {
      return live.size;
    },
  };
}

// Real spawner: runs `mise run <task>` as a tracked process group, buffering
// combined stdout+stderr and reporting the last non-empty line for the live
// display. On a fail-fast `signal` abort it reaps its own group and resolves
// `aborted` so runPreflight records it `skipped`, not `failed` (EXC-587).
function makeSpawnMiseTask(controller: ProcessGroupController): SpawnTask {
  return (name, env, onLine, signal) =>
    new Promise<SpawnOutcome>((resolve) => {
      // A multi-word name (`build ui`, `test e2e`, `build bin`) splits into
      // `mise run build ui` — mise routes the trailing words to the task's
      // positional target (EXC-738); a single-word name is unchanged.
      const child = controller.spawn("mise", ["run", ...name.split(" ")], {
        // Node's spawn accepts `undefined` env values (it drops them), so the
        // parent env passes through as-is with `extra` (e.g. CARET_SKIP_BUILD_UI)
        // merged on top.
        env: env ? { ...process.env, ...env } : process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let aborted = false;
      const onAbort = () => {
        // Only a task still running was actually torn down by fail-fast; one
        // that already finished keeps its real pass/fail outcome rather than
        // being relabeled `skipped` (EXC-587).
        if (child.exitCode !== null || child.signalCode !== null) return;
        aborted = true;
        void controller.reap(child);
      };
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });

      const chunks: string[] = [];
      const pump = (stream: Readable | null) => {
        if (!stream) return;
        const decoder = new TextDecoder();
        stream.on("data", (chunk: Buffer) => {
          const text = decoder.decode(chunk, { stream: true });
          chunks.push(text);
          const last = text
            .split("\n")
            .map((line) => line.replace(ANSI_ESCAPES, "").trim())
            .filter(Boolean)
            .at(-1);
          if (last) onLine(last);
        });
        stream.on("end", () => {
          const tail = decoder.decode(); // flush a partial multibyte sequence, if any
          if (tail) chunks.push(tail);
        });
      };
      pump(child.stdout);
      pump(child.stderr);

      const settle = (outcome: SpawnOutcome) => {
        signal.removeEventListener("abort", onAbort);
        resolve(outcome); // idempotent: first of 'error'/'close' wins
      };
      // A failed spawn (mise off PATH, EMFILE under the fan-out this gate
      // bounds) surfaces as an async 'error' event, not a throw — without this
      // listener node rethrows it as an uncaught exception and crashes the
      // orchestrator. Record it as a failed task instead (EXC-587).
      child.once("error", (err) => settle({ exitCode: 1, output: String(err), aborted }));
      child.once("close", (code, sig) =>
        settle({ exitCode: code ?? (sig ? 1 : 0), output: chunks.join(""), aborted }),
      );
    });
}

/**
 * Parse CARET_PREFLIGHT_JOBS into a positive-int concurrency cap (EXC-587).
 * Missing or invalid → undefined, so runPreflight falls back to its host
 * default rather than throttling on a typo.
 */
function parseJobs(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/**
 * On a catchable signal, tear every live task's process group down (SIGTERM →
 * SIGKILL grace) before exiting, so no mise/bun/vite/playwright/chromium/daemon
 * descendant is orphaned (EXC-587). A SIGKILL of THIS process can't run a
 * handler — see createProcessGroupController for why that case is bounded by
 * the fan-out caps rather than caught here.
 */
function installSignalHandlers(controller: ProcessGroupController): void {
  let tearingDown = false;
  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, () => {
      if (tearingDown) return;
      tearingDown = true;
      const code = sig === "SIGINT" ? 130 : 143;
      void controller.killAll().finally(() => process.exit(code));
    });
  }
}

/**
 * Run the preflight gate (EXC-471). Invoked by the tasks CLI's `preflight`
 * subcommand with commander-parsed `args`. Without `--json` it renders the live
 * human display; with `--json` it suppresses that display and emits the
 * machine-readable start/result (or error) documents on stdout instead.
 */
export async function runPreflightCli(args: JsonArgs): Promise<void> {
  // EXC-587: own a killable process group for every task, and tear it down on a
  // catchable signal, so an interrupted gate can't orphan its descendants.
  const controller = createProcessGroupController();
  installSignalHandlers(controller);
  const spawnTask = makeSpawnMiseTask(controller);
  const concurrency = parseJobs(process.env.CARET_PREFLIGHT_JOBS);

  if (!args.json) {
    if (args.verbosity > 0 || args.grep !== undefined || args.tasks.length > 0) {
      process.stderr.write(
        "preflight: -v / --grep / --task only apply with --json; ignoring them.\n",
      );
    }
    const { exitCode, summary } = await runPreflight({
      spawnTask,
      renderer: "default",
      concurrency,
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
    spawnTask,
    renderer: "silent",
    concurrency,
  });
  process.stdout.write(
    `${JSON.stringify(buildResultReport(results, { verbosity: args.verbosity, grep, tasks: args.tasks }))}\n`,
  );
  // exitCode (not process.exit) so stdout drains: a piped consumer — CI, the
  // release gate's .quiet() — would otherwise see output truncated at the pipe
  // buffer (verified: exit() after a 1MB write delivers only 64KB).
  process.exitCode = exitCode;
}
