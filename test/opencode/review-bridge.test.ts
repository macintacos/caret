// Unit coverage for the review bridge an agent's plan-review tool runs through: the
// envelope it pipes to `caret review`, the fail-safe decision parse, the result text it
// hands back to the agent, and the spawn itself — through an injected runner, and through
// the production runner against a shim child.

import { afterAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  approvedMessage,
  buildEnvelope,
  decisionText,
  deniedMessage,
  nodeSpawnRunner,
  parseDecision,
  parseReviewUrl,
  runReviewViaCaret,
  type SpawnRunner,
} from "@opencode/review-bridge.ts";
import { until } from "@test/support/poll.ts";
import { streamingRunner, stubRunner } from "@test/support/spawn-runner.ts";
import { isPidAlive } from "@/daemon/lifecycle.ts";

const tmp = mkdtempSync(join(tmpdir(), "caret-bridge-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

let shims = 0;
/** An executable `/bin/sh` script with `body` as its contents, in the suite's temp dir. */
function shim(body: string): string {
  const path = join(tmp, `shim-${shims++}`);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
}

// --- buildEnvelope ---

test("buildEnvelope produces the caret review envelope the opencode adapter parses", () => {
  const env = JSON.parse(
    buildEnvelope("# Ship it\n\nbody", { sessionID: "S", directory: "/proj" }),
  );
  expect(env).toEqual({
    session_id: "S",
    cwd: "/proj",
    tool_input: { plan: "# Ship it\n\nbody" },
  });
});

test("buildEnvelope carries the plan file path in tool_input when given, and no such key otherwise", () => {
  const withPath = JSON.parse(buildEnvelope("# P", { planFilePath: "/proj/plan.md" }));
  expect(withPath.tool_input.planFilePath).toBe("/proj/plan.md");
  expect("planFilePath" in JSON.parse(buildEnvelope("# P", {})).tool_input).toBe(false);
});

// --- parseDecision (fail-safe) ---

test("parseDecision reads an allow decision", () => {
  expect(parseDecision(`{"behavior":"allow"}`)).toEqual({ behavior: "allow" });
});

test("parseDecision reads a deny decision with feedback", () => {
  expect(parseDecision(`{"behavior":"deny","feedback":"tighten scope"}`)).toEqual({
    behavior: "deny",
    feedback: "tighten scope",
  });
});

test("parseDecision uses the LAST json line (ignores stray earlier output)", () => {
  expect(parseDecision(`some noise\n{"behavior":"allow"}\n`)).toEqual({ behavior: "allow" });
});

test("parseDecision preserves reviewer notes on an allow (EXC-791)", () => {
  expect(parseDecision(`{"behavior":"allow","feedback":"use the retry helper"}`)).toEqual({
    behavior: "allow",
    feedback: "use the retry helper",
  });
});

test("parseDecision drops a blank note on an allow", () => {
  expect(parseDecision(`{"behavior":"allow","feedback":"  "}`)).toEqual({ behavior: "allow" });
});

test("parseDecision fails safe to a deny on unparseable output", () => {
  const d = parseDecision("not json at all");
  expect(d.behavior).toBe("deny");
  expect(d.feedback).toBeTruthy();
});

test("parseDecision fails safe to a deny on empty output", () => {
  expect(parseDecision("   \n").behavior).toBe("deny");
});

// --- messages ---

test("approvedMessage tells the agent to proceed", () => {
  expect(approvedMessage().toLowerCase()).toContain("approv");
});

test("approvedMessage folds reviewer notes into the proceed message (EXC-791)", () => {
  const msg = approvedMessage("use the retry helper");
  expect(msg.toLowerCase()).toContain("approv");
  expect(msg).toContain("## Notes from the user");
  expect(msg).toContain("use the retry helper");
});

test("approvedMessage without notes stays the bare proceed message", () => {
  expect(approvedMessage()).not.toContain("Notes from the user");
});

test("deniedMessage carries the feedback", () => {
  const msg = deniedMessage("narrow step 2", "submit_plan");
  expect(msg).toContain("narrow step 2");
});

test("deniedMessage names the given tool as the one to call again", () => {
  expect(deniedMessage("narrow step 2", "submit_plan")).toContain("`submit_plan`");
});

test("approvedMessage with a plan file says the plan is already saved there, with and without notes", () => {
  for (const msg of [
    approvedMessage(undefined, "/proj/plan.md"),
    approvedMessage("use the retry helper", "/proj/plan.md"),
  ]) {
    expect(msg.toLowerCase()).toContain("approv");
    expect(msg).toContain("/proj/plan.md");
    expect(msg).toContain("already saved");
  }
  expect(approvedMessage("use the retry helper", "/proj/plan.md")).toContain(
    "use the retry helper",
  );
});

test("deniedMessage with a plan file names it and asks for a re-read rather than an updated plan", () => {
  const msg = deniedMessage("narrow step 2", "caret_review_plan", "/proj/plan.md");
  expect(msg).toContain("narrow step 2");
  expect(msg).toContain("/proj/plan.md");
  expect(msg.toLowerCase()).toContain("re-read");
  expect(msg).not.toContain("updated plan");
  expect(msg).toContain("Do not implement");
});

test("decisionText threads the plan file path into both messages", () => {
  const path = "/proj/plan.md";
  expect(decisionText({ behavior: "allow" }, "caret_review_plan", path)).toContain(path);
  expect(decisionText({ behavior: "deny", feedback: "x" }, "caret_review_plan", path)).toContain(
    path,
  );
});

test("decisionText returns the approved message, notes included, for an allow", () => {
  expect(decisionText({ behavior: "allow", feedback: "use the retry helper" }, "submit_plan")).toBe(
    approvedMessage("use the retry helper"),
  );
});

test("decisionText returns the change request naming the tool for a deny", () => {
  expect(decisionText({ behavior: "deny", feedback: "narrow step 2" }, "submit_plan")).toBe(
    deniedMessage("narrow step 2", "submit_plan"),
  );
});

// --- parseReviewUrl (review-link surfacing, EXC-691) ---

test("parseReviewUrl extracts the review URL from caret's stderr line", () => {
  const url = "http://caret.localhost:42718/?review=abc123";
  expect(parseReviewUrl(`caret: review this plan at ${url}\n`)).toBe(url);
});

test("parseReviewUrl returns undefined when the line is absent", () => {
  expect(parseReviewUrl("some unrelated stderr\n")).toBeUndefined();
  expect(parseReviewUrl("")).toBeUndefined();
});

test("parseReviewUrl waits for the whole line — a URL not yet newline-terminated does not match", () => {
  // A mid-stream stderr chunk cut off before the trailing newline must not yield a
  // truncated URL; the match requires the whitespace core always writes after it.
  expect(parseReviewUrl("caret: review this plan at http://caret.localhost:4271")).toBeUndefined();
});

// --- runReviewViaCaret (the spawn bridge) ---

/** The argv and agent every runReviewViaCaret call below shares. */
const REVIEW = { command: ["caret", "review"], agent: "opencode" };

test("runReviewViaCaret runs the given argv verbatim with the envelope on stdin", async () => {
  const seen: Array<{ command: string[]; stdin: string }> = [];
  const run = stubRunner(`{"behavior":"allow"}`, (command, _env, stdin) => {
    seen.push({ command, stdin });
  });
  const command = ["/path/to/caret", "review", "--extra"];
  const decision = await runReviewViaCaret(`{"x":1}`, { ...REVIEW, run, command });
  expect(decision).toEqual({ behavior: "allow" });
  expect(seen).toEqual([{ command: ["/path/to/caret", "review", "--extra"], stdin: `{"x":1}` }]);
});

test("runReviewViaCaret sets the child's CARET_AGENT to the given agent", async () => {
  const agents: Array<string | undefined> = [];
  const run = stubRunner(`{"behavior":"allow"}`, (_command, env) => {
    agents.push(env.CARET_AGENT);
  });
  await runReviewViaCaret("{}", { ...REVIEW, run, agent: "claude-mcp" });
  expect(agents).toEqual(["claude-mcp"]);
});

test("runReviewViaCaret hands its abort signal to the runner", async () => {
  const signals: Array<AbortSignal | undefined> = [];
  const run = stubRunner(`{"behavior":"allow"}`, (_command, _env, _stdin, _onStderr, signal) => {
    signals.push(signal);
  });
  const { signal } = new AbortController();
  await runReviewViaCaret("{}", { ...REVIEW, run, signal });
  expect(signals).toEqual([signal]);
});

test("runReviewViaCaret returns the deny+feedback decision", async () => {
  const decision = await runReviewViaCaret("{}", {
    ...REVIEW,
    run: stubRunner(`{"behavior":"deny","feedback":"redo"}`),
  });
  expect(decision).toEqual({ behavior: "deny", feedback: "redo" });
});

test("runReviewViaCaret fails safe to a deny when the spawn throws", async () => {
  const run: SpawnRunner = async () => {
    throw new Error("ENOENT");
  };
  const decision = await runReviewViaCaret("{}", { ...REVIEW, run });
  expect(decision.behavior).toBe("deny");
  expect(decision.feedback).toContain("ENOENT");
});

test("runReviewViaCaret surfaces the review URL via onUrl when the child streams it on stderr", async () => {
  const url = "http://caret.localhost:42718/?review=xyz";
  const seen: string[] = [];
  const decision = await runReviewViaCaret("{}", {
    ...REVIEW,
    run: streamingRunner(`{"behavior":"allow"}`, [`caret: review this plan at ${url}\n`]),
    onUrl: (u) => seen.push(u),
  });
  expect(seen).toEqual([url]);
  expect(decision).toEqual({ behavior: "allow" });
});

test("runReviewViaCaret fires onUrl once even when the URL line arrives split across chunks", async () => {
  const url = "http://caret.localhost:42718/?review=split";
  const seen: string[] = [];
  await runReviewViaCaret("{}", {
    ...REVIEW,
    run: streamingRunner(`{"behavior":"allow"}`, ["caret: review this ", `plan at ${url}\n`]),
    onUrl: (u) => seen.push(u),
  });
  expect(seen).toEqual([url]);
});

test("runReviewViaCaret never calls onUrl when no review URL appears on stderr", async () => {
  const seen: string[] = [];
  await runReviewViaCaret("{}", {
    ...REVIEW,
    run: streamingRunner(`{"behavior":"allow"}`, ["unrelated diagnostic noise\n"]),
    onUrl: (u) => seen.push(u),
  });
  expect(seen).toEqual([]);
});

test("runReviewViaCaret reassembles a URL split mid-URL across stderr chunks", async () => {
  const url = "http://caret.localhost:42718/?review=midsplit";
  const seen: string[] = [];
  await runReviewViaCaret("{}", {
    ...REVIEW,
    run: streamingRunner(`{"behavior":"allow"}`, [
      "caret: review this plan at http://caret.localhost:42718/?rev",
      "iew=midsplit\n",
    ]),
    onUrl: (u) => seen.push(u),
  });
  expect(seen).toEqual([url]);
});

test("runReviewViaCaret still returns the decision when onUrl throws (never crashes the review)", async () => {
  const decision = await runReviewViaCaret("{}", {
    ...REVIEW,
    run: streamingRunner(`{"behavior":"allow"}`, [
      "caret: review this plan at http://caret.localhost:42718/?review=boom\n",
    ]),
    onUrl: () => {
      throw new Error("toast surface blew up");
    },
  });
  expect(decision).toEqual({ behavior: "allow" });
});

// --- nodeSpawnRunner (the production runner, against a real shim child) ---

test("nodeSpawnRunner spawns the argv's first entry with the rest as its arguments", async () => {
  const bin = shim(`printf '%s|' "$@"`);
  const { stdout } = await nodeSpawnRunner([bin, "review", "--flag"], process.env, "");
  expect(stdout).toBe("review|--flag|");
});

/** Settles with "hung" if `p` has not settled within `ms` — well short of the sleep the
 * shims below would otherwise run to. */
function settlesWithin(p: Promise<unknown>, ms: number): Promise<"settled" | "hung"> {
  const settled = p.then(
    () => "settled" as const,
    () => "settled" as const,
  );
  return Promise.race([settled, Bun.sleep(ms).then(() => "hung" as const)]);
}

test("nodeSpawnRunner kills a running child when the signal aborts", async () => {
  // `exec` so the pid the shim reports is the sleeper itself, not a shell that would
  // leave it orphaned holding the pipes open.
  const pidFile = join(tmp, "pid-live");
  const bin = shim(`echo $$ > ${pidFile}\necho started >&2\nexec sleep 10`);
  const controller = new AbortController();
  const run = nodeSpawnRunner([bin], process.env, "", () => controller.abort(), controller.signal);
  expect(await settlesWithin(run, 3_000)).toBe("settled");
  const pid = Number(readFileSync(pidFile, "utf-8"));
  expect(await until(() => !isPidAlive(pid))).toBe(true);
});

test("nodeSpawnRunner kills the child at once when the signal is already aborted", async () => {
  // A non-empty stdin, as every real call pipes: the child dies before reading it.
  const pidFile = join(tmp, "pid-aborted");
  const run = nodeSpawnRunner(
    [shim(`echo $$ > ${pidFile}\nexec sleep 10`)],
    process.env,
    "{}",
    undefined,
    AbortSignal.abort(),
  );
  expect(await settlesWithin(run, 3_000)).toBe("settled");
  // Killed at spawn, the shim usually never writes its pid; once settled, any it wrote is final.
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, "utf-8"));
    expect(await until(() => !isPidAlive(pid))).toBe(true);
  }
});
