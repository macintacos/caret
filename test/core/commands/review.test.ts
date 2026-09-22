import { expect, test } from "bun:test";

import { parseReviewUrl } from "@opencode/review-bridge.ts";
import { claudeAdapter } from "@/adapters/claude/index.ts";
import { browserOpenCmd, reviewHookStdin, reviewUrlLine } from "@/commands/review.ts";
import type { PlanInput } from "@/lib/types.ts";
import type { ReviewDeps } from "@/review/orchestrate.ts";

// browserOpenCmd is the pure platform→argv selection extracted from openBrowser
// so the branch choice is testable without spawning (the spawn-and-swallow stays
// at the call site). The non-darwin branches ship but are exercised primarily on
// macOS — these assertions pin each branch's exact argv.

const URL = "http://caret.localhost:4242/?review=rid";

test("darwin uses `open`", () => {
  expect(browserOpenCmd("darwin", URL)).toEqual(["open", URL]);
});

test("win32 uses `cmd /c start`", () => {
  expect(browserOpenCmd("win32", URL)).toEqual(["cmd", "/c", "start", "", URL]);
});

test("linux uses `xdg-open`", () => {
  expect(browserOpenCmd("linux", URL)).toEqual(["xdg-open", URL]);
});

test("any other platform falls back to `xdg-open`", () => {
  expect(browserOpenCmd("freebsd", URL)).toEqual(["xdg-open", URL]);
});

// The review URL crosses to the OpenCode plugin as text on stderr, so the two ends
// are only in contract as long as the producer's wording still parses. Nothing else
// compares them.
test("the announced line is the one the OpenCode plugin parses back", () => {
  expect(parseReviewUrl(reviewUrlLine(URL))).toBe(URL);
});

// Claude Code can fill tool_input.plan before the agent's write to the plan file
// lands, so the payload lags the file. The file's text is what gets reviewed and
// echoed back on approval.

function recordingDeps(posted: PlanInput[]): ReviewDeps {
  return {
    parseHookInput: claudeAdapter.parseHookInput,
    ensureDaemon: async () => "http://x",
    postReview: async (_baseUrl, input) => {
      posted.push(input);
      return { id: "rid" };
    },
    longPoll: async () => ({ behavior: "allow", decidedAt: 1 }),
    openBrowser: () => {},
    announceUrl: () => {},
    timeoutMs: 1000,
    expire: async () => {},
  };
}

function hookStdin(plan: string): string {
  return JSON.stringify({
    session_id: "s",
    tool_input: { plan, planFilePath: "/plans/x.md" },
  });
}

test("reviews and echoes the plan file's text over a stale payload plan", async () => {
  const posted: PlanInput[] = [];
  const reads: string[] = [];
  const readPlan = (path: string) => {
    reads.push(path);
    return "# New";
  };
  const { decision, input } = await reviewHookStdin(
    hookStdin("# Old"),
    claudeAdapter.parseHookInput,
    recordingDeps(posted),
    readPlan,
  );
  expect(posted.map((p) => p.plan)).toEqual(["# New"]);
  const wire = JSON.parse(claudeAdapter.emitDecision(decision, input));
  expect(wire.hookSpecificOutput.decision.updatedInput.plan).toBe("# New");
  expect(reads).toEqual(["/plans/x.md"]);
});

test("an empty payload plan is reviewed from a non-empty plan file", async () => {
  const posted: PlanInput[] = [];
  const { decision } = await reviewHookStdin(
    hookStdin(""),
    claudeAdapter.parseHookInput,
    recordingDeps(posted),
    () => "# New",
  );
  expect(decision.behavior).toBe("allow");
  expect(posted.map((p) => p.plan)).toEqual(["# New"]);
});
