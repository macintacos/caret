import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { decisionText, REVIEW_TOOL_DESCRIPTION, type SpawnRunner } from "@bridge/review-bridge.ts";
import { createReviewStore, type ReviewStore } from "@piext/state.ts";
import { type PiToolResult, reviewTool } from "@piext/tool.ts";
import { rejectingRunner, streamingRunner, stubRunner } from "@test/support/spawn-runner.ts";

let dir: string;
let store: ReviewStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "caret-pi-tool-"));
  store = createReviewStore();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const ctx = () => ({ cwd: dir, sessionManager: { getSessionId: () => "s1" } });

function run(
  runner: SpawnRunner,
  params: { plan?: string; path?: string },
  opts: { signal?: AbortSignal; onUpdate?: (u: PiToolResult) => void } = {},
): Promise<PiToolResult> {
  return reviewTool({ bin: "/fake/caret", run: runner, store }).execute(
    "call-1",
    params,
    opts.signal,
    opts.onUpdate,
    ctx(),
  );
}

const text = (r: PiToolResult) => r.content.map((c) => c.text).join("");

describe("a decided review", () => {
  test("an approval spawns caret review as pi and returns the approval text", async () => {
    let captured: Parameters<SpawnRunner> | undefined;
    const r = await run(
      stubRunner('{"behavior":"allow"}', (...a) => {
        captured = a;
      }),
      { plan: "# P" },
    );
    expect(text(r)).toBe(decisionText({ behavior: "allow" }, "caret_review_plan"));
    expect(r.details).toEqual({ state: "approved" });
    expect(captured?.[0]).toEqual(["/fake/caret", "review"]);
    expect(captured?.[1].CARET_AGENT).toBe("pi");
    const envelope = JSON.parse(captured?.[2] ?? "{}");
    expect(envelope.session_id).toBe("s1");
    expect(envelope.cwd).toBe(dir);
  });

  test("an approval with notes carries them", async () => {
    const r = await run(stubRunner('{"behavior":"allow","feedback":"add a test"}'), {
      plan: "# P",
    });
    expect(text(r)).toContain("add a test");
    expect(r.details).toEqual({ state: "approved" });
  });

  test("a change request returns the deny text", async () => {
    const r = await run(stubRunner('{"behavior":"deny","feedback":"split it"}'), { plan: "# P" });
    expect(text(r)).toBe(
      decisionText({ behavior: "deny", feedback: "split it" }, "caret_review_plan"),
    );
    expect(r.details).toEqual({ state: "changes" });
  });

  test.each(["plan.md", "@plan.md"])("a path %s submits the file", async (path) => {
    writeFileSync(join(dir, "plan.md"), "# From file\n");
    let stdin = "";
    const r = await run(
      stubRunner('{"behavior":"allow"}', (_c, _e, s) => {
        stdin = s;
      }),
      { path },
    );
    const planFilePath = join(dir, "plan.md");
    expect(JSON.parse(stdin).tool_input.planFilePath).toBe(planFilePath);
    expect(text(r)).toContain(planFilePath);
  });
});

describe("bad arguments", () => {
  test.each([{}, { plan: "# P", path: "plan.md" }, { path: "plan.txt" }])(
    "%p fails without spawning",
    async (params) => {
      let called = false;
      const r = await run(
        stubRunner('{"behavior":"allow"}', () => {
          called = true;
        }),
        params,
      );
      expect(text(r)).toStartWith("caret: caret_review_plan ");
      expect(r.details).toEqual({ state: "failed" });
      expect(r.isError).toBe(true);
      expect(called).toBe(false);
      expect(store.get("s1")).toEqual({ planning: false });
    },
  );
});

describe("a review that never decided", () => {
  test.each([
    ["the runner rejects", rejectingRunner(new DOMException("aborted", "AbortError"))],
    ["the runner resolves a deny", stubRunner('{"behavior":"deny","feedback":"x"}')],
  ])("an abort is a cancel when %s", async (_name, runner) => {
    const controller = new AbortController();
    controller.abort();
    const r = await run(runner, { plan: "# P" }, { signal: controller.signal });
    expect(r.details).toEqual({ state: "cancelled" });
    expect(text(r)).toContain("Do not implement");
    expect(text(r)).not.toContain("requested CHANGES");
  });

  test.each([
    ["a spawn error", rejectingRunner(new Error("spawn /fake/caret ENOENT"))],
    ["empty stdout", stubRunner("")],
    [
      "a fail-safe deny",
      stubRunner('{"behavior":"deny","feedback":"caret: daemon down","failsafe":true}'),
    ],
  ])("%s is a failure", async (_name, runner) => {
    const r = await run(runner, { plan: "# P" });
    expect(r.details).toEqual({ state: "failed" });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("Tell the user");
    expect(text(r)).toContain("Do not implement");
    expect(text(r)).not.toContain("requested CHANGES");
    // A fail-safe deny also covers a timeout on a plan the user did see.
    expect(text(r)).not.toContain("has not seen");
  });
});

test.each([
  ["an approval", '{"behavior":"allow"}'],
  ["a change request", '{"behavior":"deny","feedback":"x"}'],
])("%s is not a tool error", async (_name, stdout) => {
  const r = await run(stubRunner(stdout), { plan: "# P" });
  expect(r.isError).toBeUndefined();
});

test("a throwing store subscriber cannot replace the reviewer's decision", async () => {
  store.subscribe(() => {
    throw new Error("footer broke");
  });
  const r = await run(stubRunner('{"behavior":"allow"}'), { plan: "# P" });
  expect(r.details).toEqual({ state: "approved" });
});

test("a waiting review reports its URL and marks the session pending", async () => {
  const updates: PiToolResult[] = [];
  let pendingWhileWaiting: string | undefined;
  const r = await run(
    streamingRunner('{"behavior":"allow"}', [
      "caret: review this plan at http://127.0.0.1:1/r/1\n",
    ]),
    { plan: "# P" },
    {
      onUpdate: (u) => {
        updates.push(u);
        pendingWhileWaiting = store.get("s1").pending;
      },
    },
  );
  expect(updates.map((u) => u.details)).toEqual([
    { state: "waiting", url: "http://127.0.0.1:1/r/1" },
  ]);
  expect(updates[0]?.isError).toBeUndefined();
  expect(pendingWhileWaiting).toBe("http://127.0.0.1:1/r/1");
  expect(r.details).toEqual({ state: "approved" });
  expect(store.get("s1").pending).toBeUndefined();
  expect(store.get("s1").lastOutcome).toBe("approved");
});

test("the definition registers a sequential caret_review_plan", () => {
  const tool = reviewTool({ bin: "/fake/caret", run: stubRunner(""), store });
  expect(tool.name).toBe("caret_review_plan");
  expect(tool.label).toBe("caret");
  expect(tool.executionMode).toBe("sequential");
  expect(tool.description).toBe(REVIEW_TOOL_DESCRIPTION);
  expect(tool.promptSnippet).not.toContain("\n");
  expect("promptGuidelines" in tool).toBe(false);
});
