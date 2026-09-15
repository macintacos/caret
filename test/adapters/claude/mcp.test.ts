// `caret mcp`: the review_plan tool Claude Code reaches through the plugin's MCP server.
// The handler is driven through an injected SpawnRunner, the server over the SDK's
// in-memory transport, and the entry point over real stdio with the SDK's own client, so
// the tool listing is what Claude Code would see.

import { expect, test } from "bun:test";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { approvedMessage, deniedMessage, type SpawnRunner } from "@opencode/review-bridge.ts";
import { setupTempConfigFile, setupTempStateDir } from "@test/support/env.ts";
import { until } from "@test/support/poll.ts";
import { stubRunner } from "@test/support/spawn-runner.ts";
import { CLAUDE_MCP_AGENT } from "@/adapters/index.ts";
import { createCaretMcpServer, createReviewPlanHandler, REVIEW_PLAN_TOOL } from "@/commands/mcp.ts";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");

const stateDir = setupTempStateDir("caret-mcp-");
setupTempConfigFile(stateDir);

function handlerWith(run: SpawnRunner) {
  return createReviewPlanHandler({
    sessionId: "mcp-S",
    cwd: "/proj",
    command: ["/bin/caret", "review"],
    run,
  });
}

function text(result: CallToolResult): string {
  const first = result.content[0];
  return first?.type === "text" ? first.text : "";
}

const signal = () => new AbortController().signal;

test("an approval returns the approved message", async () => {
  const review = handlerWith(stubRunner(`{"behavior":"allow"}`));
  expect(text(await review("# Plan", signal()))).toBe(approvedMessage());
});

test("an approval with reviewer notes carries them in the approved message", async () => {
  const review = handlerWith(stubRunner(`{"behavior":"allow","feedback":"mind the cache"}`));
  expect(text(await review("# Plan", signal()))).toBe(approvedMessage("mind the cache"));
});

test("a change request returns the denied message naming review_plan", async () => {
  const review = handlerWith(stubRunner(`{"behavior":"deny","feedback":"split step 2"}`));
  const result = await review("# Plan", signal());
  expect(text(result)).toBe(deniedMessage("split step 2", REVIEW_PLAN_TOOL));
});

test("the review runs this caret's review command under the claude-mcp adapter", async () => {
  let seen: Parameters<SpawnRunner> | undefined;
  const review = handlerWith(stubRunner(`{"behavior":"allow"}`, (...args) => (seen = args)));
  await review("# Add rate limiting\n\nsteps", signal());
  const [command, env, stdin] = seen ?? [];
  expect(command).toEqual(["/bin/caret", "review"]);
  expect(env?.CARET_AGENT).toBe(CLAUDE_MCP_AGENT);
  expect(JSON.parse(stdin ?? "")).toEqual({
    session_id: "mcp-S",
    cwd: "/proj",
    tool_input: { plan: "# Add rate limiting\n\nsteps" },
  });
});

test("the call's abort signal reaches the runner", async () => {
  let seen: AbortSignal | undefined;
  const review = handlerWith(stubRunner(`{"behavior":"allow"}`, (...args) => (seen = args[4])));
  const abort = new AbortController();
  await review("# Plan", abort.signal);
  expect(seen).toBe(abort.signal);
});

test("a second call while a review is pending is refused without spawning", async () => {
  let spawns = 0;
  let decide: (stdout: string) => void = () => {};
  const run: SpawnRunner = () => {
    spawns++;
    return new Promise((resolve) => {
      decide = (stdout) => resolve({ stdout, exitCode: 0 });
    });
  };
  const review = handlerWith(run);

  const first = review("# One", signal());
  const second = await review("# Two", signal());
  expect(second.isError).toBe(true);
  expect(spawns).toBe(1);

  decide(`{"behavior":"allow"}`);
  await first;
  const third = review("# Three", signal());
  expect(spawns).toBe(2);
  decide(`{"behavior":"allow"}`);
  expect((await third).isError).toBeFalsy();
});

/** A runner whose review never decides: it settles only once its signal aborts. */
function undecidedRunner(onSpawn: (signal: AbortSignal | undefined) => void): SpawnRunner {
  return (_command, _env, _stdin, _onStderr, signal) => {
    onSpawn(signal);
    return new Promise((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason));
    });
  };
}

async function connectedClient(run: SpawnRunner): Promise<Client> {
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createCaretMcpServer(handlerWith(run)).connect(serverSide);
  const client = new Client({ name: "caret-test", version: "0" });
  await client.connect(clientSide);
  return client;
}

const planCall = { name: REVIEW_PLAN_TOOL, arguments: { plan: "# Plan" } };

test("closing the connection aborts the in-flight review", async () => {
  let reviewSignal: AbortSignal | undefined;
  const client = await connectedClient(undecidedRunner((s) => (reviewSignal = s)));
  const call = client.callTool(planCall).catch(() => {});
  expect(await until(() => reviewSignal !== undefined)).toBe(true);

  await client.close();
  expect(await until(() => reviewSignal?.aborted === true, 1000)).toBe(true);
  await call;
});

test("the client cancelling its call aborts the in-flight review", async () => {
  let reviewSignal: AbortSignal | undefined;
  const client = await connectedClient(undecidedRunner((s) => (reviewSignal = s)));
  const abort = new AbortController();
  const call = client.callTool(planCall, undefined, { signal: abort.signal }).catch(() => {});
  expect(await until(() => reviewSignal !== undefined)).toBe(true);

  abort.abort();
  expect(await until(() => reviewSignal?.aborted === true, 1000)).toBe(true);
  await call;
  await client.close();
});

test("the MCP server lists exactly the review_plan tool, taking a plan", async () => {
  const client = new Client({ name: "caret-test", version: "0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["src/cli.ts", "mcp"],
      cwd: REPO_ROOT,
      env: process.env as Record<string, string>,
      stderr: "ignore",
    }),
  );
  try {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([REVIEW_PLAN_TOOL]);
    const [tool] = tools;
    expect(tool?.description).toMatch(/plans? only|only for .*plans?/i);
    expect(tool?.description).toMatch(/background/i);
    expect(tool?.inputSchema.required).toEqual(["plan"]);
  } finally {
    await client.close();
  }
});
