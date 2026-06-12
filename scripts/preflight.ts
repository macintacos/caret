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

// --json reports (EXC-471): the two documents an LLM/agent consumer reads
// instead of the human display — one before the run (planned tasks), one after
// (per-task results). Failed tasks embed their output; passing tasks carry
// status alone to keep the success payload small.
export interface PreflightStartReport {
  event: "start";
  schemaVersion: number;
  tasks: string[];
}

export interface PreflightTaskReport {
  name: string;
  status: TaskStatus;
  /** Present only for failed tasks: their captured output, for the consumer to act on. */
  output?: string;
}

export interface PreflightResultReport {
  event: "result";
  schemaVersion: number;
  ok: boolean;
  tasks: PreflightTaskReport[];
}

const IMMEDIATE = ["lint", "test", "build-ui"] as const;
const DEPENDENT = ["test-e2e", "build-bin"] as const;
const TASK_ORDER = [...IMMEDIATE, ...DEPENDENT];

// Bumpable integer so machine consumers detect a breaking shape change,
// mirroring scripts/release/contract.ts.
const SCHEMA_VERSION = 1;

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
    if (name === "lint") lines.push("hint: run `mise run format` to fix formatting failures");
  }
  return lines.join("\n");
}

/** Planned task set, emitted to stdout before the run in --json mode. */
export function buildStartReport(): PreflightStartReport {
  return { event: "start", schemaVersion: SCHEMA_VERSION, tasks: [...TASK_ORDER] };
}

/** Per-task results, emitted to stdout after the run in --json mode. */
export function buildResultReport(results: Map<string, TaskResult>): PreflightResultReport {
  const tasks: PreflightTaskReport[] = [];
  for (const name of TASK_ORDER) {
    const result = results.get(name);
    if (!result) continue;
    const entry: PreflightTaskReport = { name, status: result.status };
    if (result.status === "failed") {
      let output = result.output.trimEnd();
      // Same actionable hint buildSummary appends, folded into the lint output.
      if (name === "lint") output += "\nhint: run `mise run format` to fix formatting failures";
      entry.output = output;
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

// ANSI escape sequences (color, cursor control). Children can emit them even
// when piped — e.g. vite's clear-line progress — and a leaked cursor-control
// code would break the plain line-per-event contract of the non-TTY fallback,
// so display lines are stripped (buffered failure output stays raw).
const ANSI_ESCAPES = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*[A-Za-z]`, "g");

// Real spawner: runs `mise run <task>` with merged env, buffering combined
// stdout+stderr and reporting the last non-empty line for the live display.
async function spawnMiseTask(
  name: string,
  env: Record<string, string> | undefined,
  onLine: (line: string) => void,
): Promise<SpawnOutcome> {
  const proc = Bun.spawn(["mise", "run", name], {
    env: { ...process.env, ...env },
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

if (import.meta.main) {
  // --json (EXC-471): suppress the human display and emit two machine-readable
  // documents on stdout instead. The check matches whether mise forwards the
  // flag as `... --json` or `... -- --json`.
  const json = process.argv.includes("--json");
  if (json) process.stdout.write(`${JSON.stringify(buildStartReport())}\n`);
  const { results, exitCode, summary } = await runPreflight({
    spawnTask: spawnMiseTask,
    renderer: json ? "silent" : "default",
  });
  if (json) {
    process.stdout.write(`${JSON.stringify(buildResultReport(results))}\n`);
  } else {
    process.stdout.write(`\n${summary}\n`);
  }
  // exitCode (not process.exit) so stdout drains: a piped consumer — CI, the
  // release gate's .quiet() — would otherwise see the summary truncated at the
  // pipe buffer (verified: exit() after a 1MB write delivers only 64KB).
  process.exitCode = exitCode;
}
