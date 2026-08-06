#!/usr/bin/env bun
// Preflight orchestrator (EXC-462): runs the pre-push gate's constituent mise
// tasks concurrently per their dependency DAG, rendered as a live listr2 task
// list (plain line-per-event output when not a TTY). The gate BUILDS: it leaves
// ui/dist, bin/, and dist/ behind, and `smoke bundle` removes the generated
// src/ui-manifest.generated.ts (gitignored, and the next `build bin` rewrites
// it). `lint`'s `hk check` step is the read-only one — it is the formatting
// gate, and a lint failure points at `mise run format`.
//
// DAG: lint, test (unit), and `build ui` start immediately; `test e2e` and
// `build bin` start once `build ui` passes; `smoke` starts once `build bin`
// passes (EXC-914). The build-first ordering + skip mechanism live in the tasks
// CLI (scripts/tasks/build.ts), so each dependent is spawned with the skips that
// let it reuse its gate's artifact: CARET_SKIP_BUILD_UI keeps the UI built at
// exactly one run per gate (two concurrent Vite builds would otherwise race on
// ui/dist), and CARET_SKIP_BUILD_BIN keeps smoke from paying a second compile.
// (This replaces the old MISE_TASK_SKIP=build-ui dedupe of the mise `depends`
// edge, which is gone now that build/test are single multi-target tasks.)
//
// smoke is here because it is the only task that exercises the artifacts users
// receive rather than the source tree: preflight proves the source works, smoke
// proves the binary and the npm bundle do.
//
// Which of those tasks run is scoped to the diff (EXC-1042): a change confined
// to Markdown runs `lint` alone, plus `test` when it touches Markdown a test
// reads from disk. Everything else runs all six, as does a diff that cannot be
// read at all. See § Diff-scoped task selection below — including why the
// narrowing never extends to the file list a task is handed.
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
import { $ } from "bun";

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
  /** The tasks this run will spawn — a subset of the six when `selection.narrowed`. */
  tasks: string[];
  /**
   * Why this task set (EXC-1042). A scoped run must never read as a full green
   * run, so the narrowing and its cause are stated rather than left implicit in
   * a shorter `tasks` array.
   */
  selection: { narrowed: boolean; reason: string };
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

/** The preflight flags, parsed by the tasks CLI's commander tree. All are inert
 * without --json EXCEPT `full`, which selects the task set for both output
 * modes — the human path narrows too, so it needs the same escape hatch. */
export interface JsonArgs {
  json: boolean;
  verbosity: number;
  /** Run every task regardless of the diff (EXC-1042). */
  full: boolean;
  grep?: string;
  tasks: string[];
}

// Task identifiers are the multi-word `mise run` invocations (EXC-738/739): the
// spawner splits each on spaces into `mise run <words…>` (mise task names never
// contain spaces, so the split is exact). They double as the map keys and the
// display titles.

/** A task that waits on `after` to pass, then spawns with `env` merged over the
 * parent environment — the skips that let it reuse `after`'s artifact. */
interface Dependent {
  readonly name: string;
  readonly after: string;
  readonly env: Record<string, string>;
}

const SKIP_UI = { CARET_SKIP_BUILD_UI: "1" } as const;

const IMMEDIATE = ["lint", "test", "build ui"] as const;
// ORDER IS LOAD-BEARING: listr2 fills its concurrency slots in array order, so a
// task can only start once every task before it has started. `smoke` therefore
// stays LAST — a gate capped below the task count (CARET_PREFLIGHT_JOBS=1) would
// otherwise park it in a slot while `build bin`, the gate it awaits, is still
// queued behind it, and the run would deadlock rather than fail.
const DEPENDENT: readonly Dependent[] = [
  { name: "test e2e", after: "build ui", env: SKIP_UI },
  { name: "build bin", after: "build ui", env: SKIP_UI },
  { name: "smoke", after: "build bin", env: { ...SKIP_UI, CARET_SKIP_BUILD_BIN: "1" } },
];
const TASK_ORDER = [...IMMEDIATE, ...DEPENDENT.map((d) => d.name)];

// Bumpable integer so machine consumers detect a breaking shape change,
// mirroring scripts/tasks/release/contract.ts. 2 (EXC-1042): the gate can now
// run a subset, so `ok` means "every task that RAN passed" rather than "all six
// passed" — a real semantic change for anything keying off the result document.
const SCHEMA_VERSION = 2;

// Diff-scoped task selection (EXC-1042) --------------------------------------
//
// A change that touches only Markdown cannot be observed by `build ui`,
// `build bin`, `test e2e`, or `smoke`, so the gate runs only the tasks that
// could actually fail on it.
//
// The narrowing applies to WHICH TASKS RUN, never to which files a task sees:
// every task is still spawned as a bare `mise run <task>`. That distinction is
// load-bearing for `lint`. rumdl resolves an MD051 cross-file link fragment only
// when the file it points into is in the same scan, so a lint handed just the
// changed files would silently stop checking every cross-file anchor whose
// target is unchanged — and doc/ is held together almost entirely by those.

/** Which tasks this run will spawn, and why that set. */
export interface TaskSelection {
  /** The tasks to run, a subset of TASK_ORDER. */
  readonly tasks: readonly string[];
  /** True when the diff narrowed the set below the full gate. */
  readonly narrowed: boolean;
  /** Why this set — surfaced in the start document and the human summary. */
  readonly reason: string;
}

/**
 * Markdown files a unit test READS FROM DISK. A diff confined to Markdown still
 * has to run `test` when it touches one of these, because `test` can observe the
 * change. Add an entry whenever a test starts reading a Markdown file at run
 * time — the suite guards that every path listed here still exists, but nothing
 * can guard an omission.
 */
export const MARKDOWN_READ_BY_TESTS: readonly string[] = [
  "scripts/tasks/dev/fake-plan.md", // test/scripts/dev-driver.test.ts reads it and asserts on its content
  "doc/ARCHITECTURE.md", // test/adapters/opencode/docs-cache-path.test.ts checks the `rm -rf` path it prints
  "THIRD_PARTY_LICENSES.md", // ui/src/lib/icons.test.ts checks its table against the icon registry
  "doc/DEVELOPMENT.md", // no test reads it yet — pre-listed for EXC-1045's guard over fake-plan.md's line citations
];

function fullGate(reason: string): TaskSelection {
  return { tasks: TASK_ORDER, narrowed: false, reason };
}

/** The default when no selection is supplied: everything. */
const FULL_GATE = fullGate("the full gate");

/**
 * The task set for a run, given the paths its diff touched — `null` when the
 * diff could not be read at all. Conservative by construction: anything other
 * than a non-empty, entirely-Markdown list runs the whole gate.
 */
export function selectTasks(changed: readonly string[] | null): TaskSelection {
  if (changed === null) {
    return fullGate("the changed-file set could not be read — running the full gate");
  }
  // An empty list satisfies "every changed path is Markdown" vacuously, which
  // would narrow a run whose diff we merely failed to see. Treat it as unknown.
  if (changed.length === 0) return fullGate("no changed files detected — running the full gate");

  const nonMarkdown = changed.filter((path) => !path.endsWith(".md"));
  if (nonMarkdown.length > 0) {
    return fullGate(
      `${nonMarkdown.length} of ${changed.length} changed paths are not Markdown — running the full gate`,
    );
  }

  const readByTests = changed.filter((path) => MARKDOWN_READ_BY_TESTS.includes(path));
  const also = readByTests.length > 0 ? `, and \`test\` reads ${readByTests.join(", ")}` : "";
  return {
    tasks: readByTests.length > 0 ? ["lint", "test"] : ["lint"],
    narrowed: true,
    reason: `all ${changed.length} changed paths are Markdown${also}; \`lint\` still scans the whole tree`,
  };
}

/**
 * Paths this working tree changes relative to its merge base with the default
 * branch: the committed, staged and unstaged diff, plus untracked files — a new
 * source file is a change well before it is added. Returns null on any failure
 * (no `origin/HEAD`, a shallow clone, git off PATH), so the caller falls back to
 * the full gate rather than narrowing on a diff it could not see.
 */
export async function changedPaths(): Promise<string[] | null> {
  const merged = await $`git merge-base HEAD origin/HEAD`.nothrow().quiet();
  const base = merged.text().trim();
  if (merged.exitCode !== 0 || base === "") return null;
  // `git diff <commit>` compares the WORKING TREE to that commit, so one call
  // covers committed, staged and unstaged changes alike. `--no-renames` is
  // load-bearing: rename detection is on by default and reports only the
  // destination, so renaming a MARKDOWN_READ_BY_TESTS entry would hide the old
  // path and skip the very `test` run that would catch the break.
  const diff = await $`git diff --no-renames --name-only ${base}`.nothrow().quiet();
  const untracked = await $`git ls-files --others --exclude-standard`.nothrow().quiet();
  if (diff.exitCode !== 0 || untracked.exitCode !== 0) return null;
  const lines = `${diff.text()}\n${untracked.text()}`.split("\n").map((line) => line.trim());
  return [...new Set(lines.filter((line) => line !== ""))];
}

/**
 * The selection for one CLI run. `--full` short-circuits the git read entirely,
 * so the override holds even where the diff could not have been computed.
 * `readChanged` is injected so the override's short-circuit is observable.
 */
export async function resolveSelection(
  full: boolean,
  readChanged: () => Promise<readonly string[] | null> = changedPaths,
): Promise<TaskSelection> {
  if (full) return fullGate("--full: the full gate was requested explicitly");
  return selectTasks(await readChanged());
}

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
  /** Which tasks to run (EXC-1042); defaults to the full gate. */
  selection?: TaskSelection;
}): Promise<PreflightOutcome> {
  const selection = deps.selection ?? FULL_GATE;
  const selected = new Set(selection.tasks);
  const immediateTasks = IMMEDIATE.filter((name) => selected.has(name));
  // A dependent runs only if its gate SURVIVES INTO THE RUN — not merely if the
  // gate is in `selection`. Testing membership instead would keep `smoke` for a
  // selection holding `smoke` and `build bin` but not `build ui`: `build bin` is
  // dropped, yet its gate is still created and nobody ever resolves it, so
  // `smoke` awaits forever and the run HANGS rather than fails. DEPENDENT is
  // ordered gate-before-dependent, so one pass over it reaches the fixpoint.
  const running = new Set<string>(immediateTasks);
  const dependentTasks = DEPENDENT.filter((d) => {
    if (!selected.has(d.name) || !running.has(d.after)) return false;
    running.add(d.name);
    return true;
  });

  const results = new Map<string, TaskResult>();
  // One gate per task something waits on, each resolving "did it pass?". EVERY
  // EXIT PATH OF A GATING TASK MUST RESOLVE ITS GATE — `build bin` is a gate and
  // a dependent at once, so it resolves when it passes, fails, is aborted by
  // fail-fast, AND when it is itself skipped because `build ui` failed. Miss one
  // and `smoke` awaits a promise nobody settles: the gate hangs instead of
  // failing.
  const gates = new Map<string, PromiseWithResolvers<boolean>>();
  for (const { after } of dependentTasks) {
    if (!gates.has(after)) gates.set(after, Promise.withResolvers<boolean>());
  }
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
      gates.get(name)?.resolve(status === "passed");
      if (status === "skipped") return task.skip(`${name} (aborted: a sibling failed)`);
      if (status === "failed") throw new Error(`${name} failed`);
    },
  });

  const dependent = ({ name, after, env }: Dependent): ListrTask => {
    // Both lookups happen HERE, in the factory, which runs synchronously before
    // listr.run(). A missing gate then throws straight out of runPreflight; the
    // same throw from inside the task body would abandon a gating task before it
    // resolves its own gate, turning a wiring bug into the hang above.
    const upstream = gates.get(after);
    if (!upstream) throw new Error(`preflight: no gate for ${after}`);
    const own = gates.get(name);
    return {
      title: name,
      task: async (_ctx, task) => {
        task.output = `waiting for ${after}`;
        if (!(await upstream.promise)) {
          results.set(name, { status: "skipped", output: "" });
          own?.resolve(false);
          return task.skip(`${name} (skipped: ${after} failed)`);
        }
        const status = await runTask(name, env, (line) => {
          task.output = line;
        });
        own?.resolve(status === "passed");
        if (status === "skipped") return task.skip(`${name} (aborted: a sibling failed)`);
        if (status === "failed") throw new Error(`${name} failed`);
      },
    };
  };

  const listr = new Listr([...immediateTasks.map(immediate), ...dependentTasks.map(dependent)], {
    // EXC-587: a finite cap (host CPU count by default) instead of the prior
    // `true` (→ Infinity), so a constrained or stacked host can't oversubscribe;
    // CARET_PREFLIGHT_JOBS lowers it further. ≥ the task count is a no-op, so
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
  return { results, exitCode, summary: buildSummary(results, selection) };
}

function buildSummary(results: Map<string, TaskResult>, selection: TaskSelection): string {
  const icons: Record<TaskStatus, string> = { passed: "✔", failed: "✘", skipped: "○" };
  const lines = ["preflight summary:"];
  // A narrowed run prints why, so a short green summary is never mistaken for
  // the whole gate having passed (the human twin of the start doc's `selection`).
  if (selection.narrowed) lines.push(`  scope: ${selection.reason}`);
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

/** Planned task set, why it is that set, and the filters in effect — emitted to
 * stdout before the run in --json mode. */
export function buildStartReport(
  args: JsonArgs = { json: true, verbosity: 0, full: false, tasks: [] },
  selection: TaskSelection = FULL_GATE,
): PreflightStartReport {
  return {
    event: "start",
    schemaVersion: SCHEMA_VERSION,
    tasks: [...selection.tasks],
    selection: { narrowed: selection.narrowed, reason: selection.reason },
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
  // Resolved once, ahead of either output mode, so the human summary and the
  // --json start document always describe the same run (EXC-1042).
  const selection = await resolveSelection(args.full);

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
      selection,
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

  process.stdout.write(`${JSON.stringify(buildStartReport(args, selection))}\n`);
  const { results, exitCode } = await runPreflight({
    spawnTask,
    renderer: "silent",
    concurrency,
    selection,
  });
  process.stdout.write(
    `${JSON.stringify(buildResultReport(results, { verbosity: args.verbosity, grep, tasks: args.tasks }))}\n`,
  );
  // exitCode (not process.exit) so stdout drains: a piped consumer — CI, the
  // release gate's .quiet() — would otherwise see output truncated at the pipe
  // buffer (verified: exit() after a 1MB write delivers only 64KB).
  process.exitCode = exitCode;
}
