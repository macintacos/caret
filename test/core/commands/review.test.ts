import { expect, test } from "bun:test";

import { parseReviewUrl } from "@opencode/review-bridge.ts";
import { fakeReviewDeps } from "@test/support/wire-contract.ts";
import { browserOpenCmd, reviewHookInput, reviewUrlLine } from "@/commands/review.ts";
import type { PlanInput } from "@/lib/types.ts";
import { PLAN_EMPTY_DENY_MESSAGE } from "@/plan/format.ts";
import { parseHook } from "@/review/orchestrate.ts";

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

// The hook payload's plan can lag the plan file, so the file's text is what gets
// reviewed and returned for the approval echo.

const PLAN_FILE = "/plans/x.md";

function planStdin(plan: string): string {
  return JSON.stringify({ plan, planFilePath: PLAN_FILE });
}

function fakeParseHookInput(stdin: string): PlanInput {
  return JSON.parse(stdin) as PlanInput;
}

function recordingReview(fromFile: string | undefined) {
  const posted: PlanInput[] = [];
  const reads: string[] = [];
  const deps = fakeReviewDeps({
    postReview: async (_baseUrl, input) => {
      posted.push(input);
      return { id: "rid" };
    },
  });
  const readPlan = (path: string) => {
    reads.push(path);
    return fromFile;
  };
  return {
    posted,
    reads,
    run: (stdin: string) => reviewHookInput(parseHook(fakeParseHookInput, stdin), deps, readPlan),
  };
}

test("reviews and returns the plan file's text over a stale payload plan", async () => {
  const r = recordingReview("# New");
  const { input } = await r.run(planStdin("# Old"));
  expect(r.posted.map((p) => p.plan)).toEqual(["# New"]);
  expect(input?.plan).toBe("# New");
  expect(r.reads).toEqual([PLAN_FILE]);
});

test("an empty payload plan is reviewed from a non-empty plan file", async () => {
  const r = recordingReview("# New");
  const { decision } = await r.run(planStdin(""));
  expect(decision.behavior).toBe("allow");
  expect(r.posted.map((p) => p.plan)).toEqual(["# New"]);
});

test("a blank plan file leaves the payload plan in place", async () => {
  const r = recordingReview("  \n");
  await r.run(planStdin("# Old"));
  expect(r.posted.map((p) => p.plan)).toEqual(["# Old"]);
});

test("an empty payload with no readable plan file is denied as an empty plan", async () => {
  const r = recordingReview(undefined);
  const { decision } = await r.run(planStdin(""));
  expect(decision).toMatchObject({ behavior: "deny", feedback: PLAN_EMPTY_DENY_MESSAGE });
  expect(r.posted).toEqual([]);
});

test("stdin that fails to parse denies without reading the plan file", async () => {
  const r = recordingReview("# New");
  const { decision, input } = await r.run("not json");
  expect(decision.behavior).toBe("deny");
  expect(input).toBeUndefined();
  expect(r.reads).toEqual([]);
});
