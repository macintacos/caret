// Standing gate for `/caret`. Claude Code and OpenCode discover the command by file
// path (pi registers it in code), so a dropped or renamed file, or a `files` entry that
// stops shipping it, fails silently at the user's terminal and never in CI. Nothing but
// this suite catches it.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REVIEW_TOOL } from "@oc/caret.core.ts";
import { installPlanning, type PlanningApi, planningSteer } from "@piext/plan.ts";
import { createReviewStore } from "@piext/state.ts";
import pkg from "@root/package.json" with { type: "json" };
import { MARKDOWN_READ_BY_TESTS } from "@scripts/preflight.ts";

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const CLAUDE_SKILL = "skills/caret/SKILL.md";
const CLAUDE_REFERENCES = "skills/caret/references";
const OPENCODE_COMMAND = "opencode/commands/plan.md";

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");
const unshipped = (paths: readonly string[]) =>
  paths.filter(
    (rel) => !pkg.files.some((f) => rel === f || (f.endsWith("/") && rel.startsWith(f))),
  );

/** The `router` fence's lines, without the fence markers. */
function routerLines(markdown: string): string[] {
  const fence = markdown.match(/^```router\n([\s\S]*?)^```$/m);
  return fence?.[1]?.split("\n").filter(Boolean) ?? [];
}

const STOPS = ["usage", "doctor", "demo", "plan"];

/** The stops a router names, and whether its `argument` node carries every dispatch exit. */
function expectDispatchRouter(markdown: string) {
  const lines = routerLines(markdown);
  const stops = lines.flatMap((l) => l.match(/^([\w-]+)!:/)?.[1] ?? []);
  expect(stops.toSorted()).toEqual(STOPS.toSorted());
  const exits = lines.slice(lines.indexOf("argument?: What is the whole argument?") + 1);
  expect(exits.slice(0, 5)).toEqual([
    "  empty, or exactly `plan` > usage",
    "  exactly `doctor` > doctor",
    "  exactly `demo` > demo",
    "  `plan` followed by a description > plan",
    "  anything else, including a description that merely starts with `doctor` or `demo` > plan",
  ]);
}

const claudeReferences = STOPS.filter((s) => s !== "usage").map(
  (s) => `${CLAUDE_REFERENCES}/${s}.md`,
);

test(`${CLAUDE_SKILL} exists and ships`, () => {
  expect(existsSync(join(REPO_ROOT, CLAUDE_SKILL))).toBe(true);
  expect(unshipped([CLAUDE_SKILL])).toEqual([]);
});

test(`${CLAUDE_SKILL} routes every argument to one of its stops`, () => {
  expectDispatchRouter(read(CLAUDE_SKILL));
});

test("each reference a Claude Code stop loads exists and ships", () => {
  expect(claudeReferences.filter((rel) => !existsSync(join(REPO_ROOT, rel)))).toEqual([]);
  expect(unshipped(claudeReferences)).toEqual([]);
});

test(`${CLAUDE_SKILL} leaves the command bodies to its references`, () => {
  const skill = read(CLAUDE_SKILL);
  expect(skill.includes("ExitPlanMode")).toBe(false);
  expect(skill.includes("doctor --json")).toBe(false);
});

test(`${CLAUDE_REFERENCES}/plan.md routes through ExitPlanMode, the call caret's hook intercepts`, () => {
  expect(read(`${CLAUDE_REFERENCES}/plan.md`)).toContain("ExitPlanMode");
});

test("Claude Code finds caret's commands only as the caret skill", () => {
  expect(existsSync(join(REPO_ROOT, "commands"))).toBe(false);
});

test(`${OPENCODE_COMMAND} calls the plugin's review tool by its current name`, () => {
  expect(read(OPENCODE_COMMAND)).toContain(REVIEW_TOOL);
});

test("pi's planning mode registers caret:plan and steers to the review tool", () => {
  const commands: string[] = [];
  installPlanning(
    {
      registerCommand: (name: string) => commands.push(name),
      on: () => {},
    } as unknown as PlanningApi,
    { store: createReviewStore(), plansDir: "/p", warm: () => {} },
  );
  expect(commands).toEqual(["caret:plan"]);
  expect(planningSteer("/p", "s")).toContain(REVIEW_TOOL);
});

test("preflight runs this suite when only the Markdown it reads changed", () => {
  const markdown = [CLAUDE_SKILL, `${CLAUDE_REFERENCES}/plan.md`, OPENCODE_COMMAND];
  expect(markdown.filter((rel) => !MARKDOWN_READ_BY_TESTS.includes(rel))).toEqual([]);
});
