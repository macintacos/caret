// The claude-mcp adapter: Claude Code reviews submitted through caret's own MCP
// server. Its wire is the caret-owned OpenCode envelope and flat decision, driven
// here through the real parse -> runReview -> emit path over OpenCode's checked-in
// envelope fixture; everything the daemon publishes or probes stays Claude's.

import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { setupTempStateDir } from "@test/support/env.ts";
import { emitWire as emitWireVia } from "@test/support/wire-contract.ts";
import { APPROVE_VARIANTS } from "@/adapters/claude/approve.ts";
import { claudeAdapter } from "@/adapters/claude/index.ts";
import { CLAUDE_MCP_AGENT, fatalDeny, selectAdapter } from "@/adapters/index.ts";
import type { Decision } from "@/lib/types.ts";

const FIXTURE = join(import.meta.dir, "..", "opencode", "fixtures", "review-request-stdin.json");
const stdin = readFileSync(FIXTURE, "utf-8");

setupTempStateDir("caret-claude-mcp-wire-contract-");

const ORIGINAL = process.env.CARET_AGENT;
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.CARET_AGENT;
  else process.env.CARET_AGENT = ORIGINAL;
});

function emitWire(decision: Decision): Promise<unknown> {
  return emitWireVia(stdin, decision, selectAdapter(CLAUDE_MCP_AGENT));
}

test("plain approve over the envelope emits a flat allow", async () => {
  expect(await emitWire({ behavior: "allow", decidedAt: 1 })).toEqual({ behavior: "allow" });
});

test("an accept-edits approve emits a bare allow, since a tool result cannot change the permission mode", async () => {
  expect(await emitWire({ behavior: "allow", acceptMode: "acceptEdits", decidedAt: 1 })).toEqual({
    behavior: "allow",
  });
});

test("reviewer notes on an approve ride the allow as feedback", async () => {
  expect(
    await emitWire({ behavior: "allow", feedback: "keep the route small", decidedAt: 1 }),
  ).toEqual({
    behavior: "allow",
    feedback: "keep the route small",
  });
});

test("a deny over the envelope carries the reviewer feedback", async () => {
  expect(
    await emitWire({ behavior: "deny", feedback: "narrow step 2 to one route", decidedAt: 1 }),
  ).toEqual({ behavior: "deny", feedback: "narrow step 2 to one route" });
});

test("offers Claude's approve variants", () => {
  expect(selectAdapter(CLAUDE_MCP_AGENT).approveVariants).toBe(APPROVE_VARIANTS);
});

test("lists skills, reads skill descriptions and probes the install as Claude does", () => {
  const mcp = selectAdapter(CLAUDE_MCP_AGENT);
  expect(mcp.listSkills).toBe(claudeAdapter.listSkills);
  expect(mcp.readSkillDescription).toBe(claudeAdapter.readSkillDescription);
  expect(mcp.readInstallState).toBe(claudeAdapter.readInstallState);
});

test("fatalDeny under CARET_AGENT=claude-mcp ships a flat deny line", () => {
  process.env.CARET_AGENT = CLAUDE_MCP_AGENT;
  expect(JSON.parse(fatalDeny("boom"))).toEqual({ behavior: "deny", feedback: "boom" });
});
