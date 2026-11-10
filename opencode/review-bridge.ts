// The bridge from an agent's plan-review tool to `caret review`, shared by the OpenCode
// plugin, `caret mcp` and pi's extension: resolve the plan and the caret binary, build
// caret's review envelope, warm the daemon, spawn the review, and turn the flat decision
// it prints into the tool's result text. It stays in opencode/ because that directory
// already ships as unbundled source each host reaches by relative import; moving it would
// churn OpenCode's packaging for no gain. It imports node builtins only, so bundling it
// into the CLI pulls in no plugin SDK. It also holds PLAN_TITLE_INSTRUCTION, since this is
// the one module the hosts, `caret mcp` and `caret steer` can all import.

import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** `failsafe` is set only on a deny caret made itself because the review could not run,
 * never on a reviewer's. */
export type CaretDecision =
  | { behavior: "allow"; feedback?: string; acceptMode?: string }
  | { behavior: "deny"; feedback: string; failsafe?: true };

/** The plan-review tool the agent calls. */
export const REVIEW_TOOL = "caret_review_plan";

// The review tool's model-facing text, shared so the hosts' registrations stay
// word-for-word identical (plugin-v2.test.ts and test/pi/tool.test.ts pin it per host).
export const REVIEW_TOOL_DESCRIPTION =
  "Submit the current plan to caret for human review in a local browser UI. For plans only: caret presents what it receives as a plan, so do not use it for other documents or questions. Pass exactly one of `path` (preferred: a markdown file you write once and revise with edits) or `plan` (the plan inline). Blocks until the user approves or requests changes. On a change request, follow the result's instructions and call this tool again. Do not implement the plan until a call returns an approval.";

export const PLAN_ARG_DESCRIPTION =
  "The complete plan, as markdown, to present for human review. The inline alternative to `path`.";

/** The caret binary a host spawns. The `overrideVar` env override wins; else
 * `../bin/caret` beside the calling module's `importMetaUrl`. */
export function resolveCaretBin(opts: {
  env: Record<string, string | undefined>;
  importMetaUrl: string;
  overrideVar: string;
}): string {
  const override = opts.env[opts.overrideVar]?.trim();
  if (override) return override;
  return fileURLToPath(new URL("../bin/caret", opts.importMetaUrl));
}

/** Semver triple `[major, minor, patch]`, or null when `v` is not `X.Y.Z` (an
 * optional leading `v` is stripped; trailing prerelease/build metadata ignored). */
export function parseVersionTriple(v: string): [number, number, number] | null {
  const m = v
    .trim()
    .replace(/^v/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is a strictly higher semver than `current`. Inline (no semver
 * dep) so the deployed plugin stays self-contained; an unparseable version on
 * either side compares false, so the check never nags on something it can't read. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersionTriple(latest);
  const b = parseVersionTriple(current);
  if (!a || !b) return false;
  const [a0, a1, a2] = a;
  const [b0, b1, b2] = b;
  if (a0 !== b0) return a0 > b0;
  if (a1 !== b1) return a1 > b1;
  return a2 > b2;
}

type PlanSource = { plan: string; planFilePath?: string };

/** The plan the review tool submits, from exactly one of its `plan` / `path` args (an
 * empty string counts as absent). A `path` resolves against the session directory and
 * must be a readable `.md` file — mirroring the core's `isPlanFile`
 * (src/plan/canonical-file.ts), repeated here because this module cannot import src/.
 * `readFile` returns the text, or undefined when absPath is not a readable regular
 * file. */
export function resolvePlanSource(
  args: { plan?: string; path?: string },
  directory: string,
  readFile: (absPath: string) => string | undefined,
): PlanSource | { error: string } {
  const plan = args.plan || undefined;
  const path = args.path || undefined;
  const notExactlyOne = {
    error: `caret: ${REVIEW_TOOL} takes exactly one of \`plan\` or \`path\`. Pass the plan file as \`path\`, or the plan inline as \`plan\`.`,
  };
  if (path === undefined) return plan === undefined ? notExactlyOne : { plan };
  if (plan !== undefined) return notExactlyOne;
  const planFilePath = resolve(directory, path);
  if (!planFilePath.endsWith(".md")) {
    return {
      error: `caret: ${REVIEW_TOOL} needs a markdown (.md) file as \`path\`, not ${planFilePath}. Write the plan to a .md file, or pass it inline as \`plan\`.`,
    };
  }
  const text = readFile(planFilePath);
  if (text === undefined) {
    return {
      error: `caret: ${REVIEW_TOOL} could not read ${planFilePath} as a regular file. Write the plan there first, or pass it inline as \`plan\`.`,
    };
  }
  return { plan: text, planFilePath };
}

/** The file's text, or undefined when `absPath` is not a readable regular file; never
 * throws. */
export function readRegularFile(absPath: string): string | undefined {
  try {
    return statSync(absPath).isFile() ? readFileSync(absPath, "utf-8") : undefined;
  } catch {
    return undefined;
  }
}

/** Asks the model to open its plan on a `#` heading, which deriveTitle
 * (src/review/threading.ts) prefers as the review title — keep the two in sync. Sent by
 * the OpenCode planning steer, the MCP review_plan description, and `caret steer`. */
export const PLAN_TITLE_INSTRUCTION =
  "Start the plan with a single `# <title>` heading that names the change in a few words; caret shows it as the plan's title in the review UI.";

/** Build the caret review envelope `caret review` parses.
 * Mirrors the snake_case session/cwd shape the opencode adapter's parseHookInput
 * reads — both ends are caret-owned. */
export function buildEnvelope(
  plan: string,
  ctx: {
    sessionID?: string;
    directory?: string;
    planFilePath?: string;
    approveVariants?: readonly string[];
  },
): string {
  return JSON.stringify({
    session_id: ctx.sessionID,
    cwd: ctx.directory,
    tool_input: { plan, planFilePath: ctx.planFilePath },
    approve_variants: ctx.approveVariants,
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
    const parsed = JSON.parse(line) as {
      behavior?: unknown;
      feedback?: unknown;
      acceptMode?: unknown;
      failsafe?: unknown;
    };
    if (parsed.behavior === "allow") {
      // Reviewer notes (EXC-791) ride the allow; surface them to the agent below.
      const notes = typeof parsed.feedback === "string" ? parsed.feedback.trim() : "";
      const acceptMode = typeof parsed.acceptMode === "string" ? parsed.acceptMode : "";
      return {
        behavior: "allow",
        ...(notes && { feedback: notes }),
        ...(acceptMode && { acceptMode }),
      };
    }
    if (parsed.behavior === "deny") {
      return {
        behavior: "deny",
        feedback: typeof parsed.feedback === "string" ? parsed.feedback : "Plan changes requested.",
        ...(parsed.failsafe === true && { failsafe: true }),
      };
    }
    return failsafeDeny("caret: unrecognized review decision — denying to fail safe.");
  } catch {
    return failsafeDeny("caret: could not parse the review decision — denying to fail safe.");
  }
}

function failsafeDeny(feedback: string): CaretDecision {
  return { behavior: "deny", feedback, failsafe: true };
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
 * line reference indexes the plan version caret stored, and an abbreviated quote rides
 * with it only when the agent may not hold that version line for line. That stored
 * version is rumdl-reflowed to 90 columns at ingest (src/plan/markdown.ts). With a plan
 * file, caret mirrors that canonical text onto it, so once the agent re-reads the file the
 * numbers line up and no quote is sent; when there is no file, or the best-effort
 * write-back fails, they need not line up with the agent's own copy, and the quote is what
 * the agent matches against its own text.
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

/** Warms the caret daemon: `caret prewarm`, detached and unref'd so it never holds up
 * the turn. Output is discarded — the child logs to caret.log. CARET_AGENT rides along
 * because this spawn is what stands the daemon up and the daemon picks its adapter
 * from that env; the 'error' handler is mandatory because spawn emits 'error'
 * ASYNCHRONOUSLY (ENOENT on a bad bin), where a caller's synchronous try/catch
 * cannot see it and an unhandled event would take the host's whole process down. */
export function warmCaret(bin: string, agent: string): void {
  const child = spawn(bin, ["prewarm"], {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, CARET_AGENT: agent },
  });
  child.on("error", () => {});
  child.unref();
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
