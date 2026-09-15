// The bridge from an agent's plan-review tool to `caret review`, shared by the OpenCode
// plugin and `caret mcp`: build caret's review envelope, spawn the review, and turn the
// flat decision it prints into the tool's result text. It sits in opencode/ because that
// directory ships as unbundled source the plugin can reach only by relative import, and
// it imports node builtins only, so bundling it into the CLI pulls in no plugin SDK.

import { spawn } from "node:child_process";

export type CaretDecision =
  | { behavior: "allow"; feedback?: string }
  | { behavior: "deny"; feedback: string };

/** The first markdown heading in the plan, used as the review title — or
 * undefined when the plan has no `# ` heading. */
export function planTitle(plan: string): string | undefined {
  for (const line of plan.split("\n")) {
    const m = line.match(/^#\s+(.+?)\s*$/);
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** Build the caret review envelope `caret review` parses.
 * Mirrors the snake_case session/cwd shape the opencode adapter's parseHookInput
 * reads — both ends are caret-owned. */
export function buildEnvelope(
  plan: string,
  ctx: { sessionID?: string; directory?: string; planFilePath?: string },
): string {
  return JSON.stringify({
    session_id: ctx.sessionID,
    cwd: ctx.directory,
    tool_input: { plan, title: planTitle(plan), planFilePath: ctx.planFilePath },
  });
}

/** Parse the single decision JSON line `caret review` prints on stdout. Fail-safe:
 * anything unrecognized or unparseable becomes a deny — shipping an unreviewed
 * plan is the one outcome caret never allows. */
export function parseDecision(stdout: string): CaretDecision {
  const line =
    stdout
      .trim()
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .at(-1) ?? "";
  try {
    const parsed = JSON.parse(line) as { behavior?: unknown; feedback?: unknown };
    if (parsed.behavior === "allow") {
      // Reviewer notes (EXC-791) ride the allow; surface them to the agent below.
      const notes = typeof parsed.feedback === "string" ? parsed.feedback.trim() : "";
      return notes ? { behavior: "allow", feedback: notes } : { behavior: "allow" };
    }
    if (parsed.behavior === "deny") {
      return {
        behavior: "deny",
        feedback: typeof parsed.feedback === "string" ? parsed.feedback : "Plan changes requested.",
      };
    }
    return failsafeDeny("caret: unrecognized review decision — denying to fail safe.");
  } catch {
    return failsafeDeny("caret: could not parse the review decision — denying to fail safe.");
  }
}

function failsafeDeny(feedback: string): CaretDecision {
  return { behavior: "deny", feedback };
}

/** Tool result returned to the agent on approval. Optional reviewer notes
 * (EXC-791) ride along — the plan is already approved, so no re-planning round. Without
 * `planFilePath` the agent holds the plan only in its own tool args, so this tool result
 * is the notes' sole delivery channel; with one, `caret review` has already appended any
 * notes to that file (best-effort). */
export function approvedMessage(notes?: string, planFilePath?: string): string {
  const trimmed = notes?.trim();
  if (!trimmed) {
    const base = "caret: the user APPROVED this plan. Proceed with the implementation as planned.";
    const saved = planFilePath
      ? [`The approved plan is already saved at ${planFilePath}, so do not write it again.`]
      : [];
    return [base, ...saved].join("\n");
  }
  const saved = planFilePath
    ? [
        `The approved plan, with these notes appended, is already saved at ${planFilePath}, so do not write it again.`,
      ]
    : [];
  return [
    "caret: the user APPROVED this plan.",
    "",
    "They added notes to fold into your work — incorporate them as you implement; no need to re-plan:",
    "",
    "## Notes from the user",
    "",
    trimmed,
    "",
    "Proceed with the implementation.",
    ...saved,
  ].join("\n");
}

/** Tool result returned to the agent on a change request: the reviewer feedback
 * and a resubmit instruction. The plan itself is NOT echoed — the agent already has
 * it in the args of its own call to `tool`, or in the file at `planFilePath`. A feedback
 * line reference indexes the plan version caret stored, and the abbreviated quote paired
 * with it is what the agent matches against its own text. That stored version is
 * rumdl-reflowed to 90 columns at ingest (src/plan/markdown.ts). With a plan file, caret
 * mirrors that canonical text onto it, so once the agent re-reads the file the numbers
 * usually line up (the write-back is best-effort); without one, they need not line up with
 * the agent's own copy at all.
 * (Pinned across its three surfaces by
 * test/structure/line-anchor-claim.test.ts.) */
export function deniedMessage(feedback: string, tool: string, planFilePath?: string): string {
  const revise = planFilePath
    ? [
        `Re-read the plan file at ${planFilePath} before editing it: caret may have rewritten it in its reformatted shape, so line breaks may have moved, and its line numbers should now match the feedback above.`,
        `Revise it with targeted edits rather than rewriting the whole plan, then call \`${tool}\` again with the same file.`,
      ]
    : [`Revise the plan accordingly, then call \`${tool}\` again with the updated plan.`];
  return [
    "caret: the user requested CHANGES to this plan.",
    "",
    "Feedback:",
    feedback,
    "",
    ...revise,
    `Do not implement the plan until a call to \`${tool}\` returns an approval.`,
  ].join("\n");
}

/** The tool result an agent reads for `decision`; `tool` is the name to call again on a
 * change request. */
export function decisionText(decision: CaretDecision, tool: string, planFilePath?: string): string {
  return decision.behavior === "allow"
    ? approvedMessage(decision.feedback, planFilePath)
    : deniedMessage(decision.feedback, tool, planFilePath);
}

/** Extract caret's review URL from the child's stderr text. Core writes
 * `caret: review this plan at <url>\n` (src/review/orchestrate.ts); both ends are caret-owned,
 * so this regex is coupled to that one line by design. The trailing `\s` match
 * means a stderr chunk cut off mid-URL (before the newline) yields nothing rather
 * than a truncated URL — the match only fires once the whole line has arrived. */
export function parseReviewUrl(stderr: string): string | undefined {
  return stderr.match(/caret: review this plan at (\S+)\s/)?.[1];
}

/** Runs `command` (a `caret review` argv), returning its captured stdout. Injected so
 * the review tool is unit-testable without spawning a real process. `onStderr` streams
 * the child's stderr chunks as they arrive, so the caller can surface the review URL
 * the core prints there while the review is still pending. An aborted `signal` must
 * terminate the child and settle (reject) promptly: `caret mcp` refuses a new call until
 * the aborted one settles. */
export type SpawnRunner = (
  command: string[],
  env: Record<string, string | undefined>,
  stdin: string,
  onStderr?: (chunk: string) => void,
  signal?: AbortSignal,
) => Promise<{ stdout: string; exitCode: number }>;

/** Spawn `command` with the review envelope on stdin and CARET_AGENT set to `agent`,
 * then parse its decision line. Any spawn failure fails safe to a deny. `onUrl`, if
 * given, fires once with the review URL the moment core prints it on stderr, so a caller
 * can surface it while the review is pending. */
export async function runReviewViaCaret(
  envelope: string,
  opts: {
    command: string[];
    agent: string;
    run: SpawnRunner;
    onUrl?: (url: string) => void;
    signal?: AbortSignal;
  },
): Promise<CaretDecision> {
  try {
    // Accumulate stderr and report the URL once — the line may arrive split
    // across chunks, and only the first occurrence matters.
    const { onUrl } = opts;
    let stderrBuf = "";
    let urlSent = false;
    const onStderr = onUrl
      ? (chunk: string) => {
          if (urlSent) return;
          stderrBuf += chunk;
          const url = parseReviewUrl(stderrBuf);
          if (url) {
            urlSent = true;
            // Best-effort: surfacing the URL must never crash or fail-safe-deny
            // the review. This fires on the stderr `data` event while we're
            // suspended at `await opts.run(...)`, so a throw here would escape the
            // try/catch below as an uncaughtException rather than a deny.
            try {
              onUrl(url);
            } catch {
              // swallow — the review decision is what matters.
            }
          }
        }
      : undefined;
    const { stdout } = await opts.run(
      opts.command,
      { ...process.env, CARET_AGENT: opts.agent },
      envelope,
      onStderr,
      opts.signal,
    );
    return parseDecision(stdout);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return failsafeDeny(`caret: review failed to run (${message}) — denying to fail safe.`);
  }
}

/** Production runner: spawn `command[0]` with the rest of the argv. stderr is
 * PIPED (not inherited) and streamed to `onStderr`: in OpenCode, inheriting it leaked
 * core's "review this plan at <url>" line straight into the TUI scrollback, where the
 * renderer never owns it and it lingered after the decision (EXC-691). The child logs
 * diagnostics to caret.log, so dropping the rest of stderr loses nothing. An aborted
 * `signal` SIGTERMs the child, which `caret review` answers by expiring its review; the
 * returned promise rejects with an AbortError. */
export const nodeSpawnRunner: SpawnRunner = (command, env, stdin, onStderr, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn(command[0] as string, command.slice(1), {
      env,
      signal,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => onStderr?.(chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, exitCode: code ?? 0 }));
    // A child killed before reading stdin EPIPEs the write; unhandled, that crashes the
    // host. The 'error'/'close' handlers above already settle.
    child.stdin.on("error", () => {});
    child.stdin.write(stdin);
    child.stdin.end();
  });
