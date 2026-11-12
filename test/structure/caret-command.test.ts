// Standing gate for `/caret`. Claude Code and OpenCode discover the command by file
// path (pi registers it in code), so a dropped or renamed file, or a `files` entry that
// stops shipping it, fails silently at the user's terminal and never in CI. Nothing but
// this suite catches it.
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REVIEW_TOOL } from "@oc/caret.core.ts";
import { installCaret, type PiApi } from "@piext/caret.ts";
import { planningSteer } from "@piext/plan.ts";
import pkg from "@root/package.json" with { type: "json" };
import { MARKDOWN_READ_BY_TESTS } from "@scripts/preflight.ts";

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const CLAUDE_SKILL = "skills/caret/SKILL.md";
const CLAUDE_REFERENCES = "skills/caret/references";
const OPENCODE_COMMAND = "opencode/commands/caret.md";
const OPENCODE_REFERENCES = "opencode/references";

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

/** Asserts the router names exactly `STOPS` and its `argument` node carries the five dispatch exits, in order. */
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
const opencodeReferences = STOPS.filter((s) => s !== "usage").map(
  (s) => `${OPENCODE_REFERENCES}/${s}.md`,
);

test(`${CLAUDE_SKILL} exists and ships`, () => {
  expect(existsSync(join(REPO_ROOT, CLAUDE_SKILL))).toBe(true);
  expect(unshipped([CLAUDE_SKILL])).toEqual([]);
});

test(`${CLAUDE_SKILL} routes every argument to one of its stops`, () => {
  expectDispatchRouter(read(CLAUDE_SKILL));
});

test(`${CLAUDE_SKILL}'s argument hint names every form /caret takes`, () => {
  const frontmatter = read(CLAUDE_SKILL).match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
  const hint = frontmatter.match(/^argument-hint: (.*)$/m)?.[1] ?? "";
  expect(hint).toContain("what you want done");
  expect(hint).toContain("doctor");
  expect(hint).toContain("demo");
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

test(`${CLAUDE_SKILL} names the plugin root its references read as <plugin root>`, () => {
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's variable, written literally
  expect(read(CLAUDE_SKILL)).toContain("`${CLAUDE_PLUGIN_ROOT}`");
  expect(read(CLAUDE_SKILL)).toContain("`<plugin root>`");
});

test(`${CLAUDE_REFERENCES} carry no harness variable, since Claude Code reads them raw`, () => {
  expect(claudeReferences.filter((rel) => read(rel).includes("${CLAUDE_"))).toEqual([]);
});

test(`${CLAUDE_REFERENCES}/plan.md routes through ExitPlanMode, the call caret's hook intercepts`, () => {
  expect(read(`${CLAUDE_REFERENCES}/plan.md`)).toContain("ExitPlanMode");
});

test("Claude Code finds caret's commands only as the caret skill", () => {
  expect(existsSync(join(REPO_ROOT, "commands"))).toBe(false);
});

test("opencode/commands/ ships /caret as its only command", () => {
  expect(readdirSync(join(REPO_ROOT, "opencode", "commands"))).toEqual(["caret.md"]);
  expect(unshipped([OPENCODE_COMMAND])).toEqual([]);
});

test(`${OPENCODE_COMMAND} runs on the plan agent and routes every argument to one of its stops`, () => {
  const command = read(OPENCODE_COMMAND);
  expect(command).toMatch(/^---\n(?:.*\n)*?agent: plan\n(?:.*\n)*?---\n/);
  expectDispatchRouter(command);
  expect(command).toContain("`__CARET_REFERENCES__/`");
});

test("each reference an OpenCode stop loads exists and ships", () => {
  expect(opencodeReferences.filter((rel) => !existsSync(join(REPO_ROOT, rel)))).toEqual([]);
  expect(unshipped(opencodeReferences)).toEqual([]);
});

test(`${OPENCODE_COMMAND} leaves the review tool to ${OPENCODE_REFERENCES}/plan.md`, () => {
  expect(read(OPENCODE_COMMAND).includes(REVIEW_TOOL)).toBe(false);
  expect(read(`${OPENCODE_REFERENCES}/plan.md`)).toContain(REVIEW_TOOL);
});

test(`${OPENCODE_COMMAND}'s usage hint names the open-review keybinding`, () => {
  expect(read(OPENCODE_COMMAND).split("## Usage hint")[1]).toContain("<leader>p");
});

test("pi's extension registers /caret as its only command and steers to the review tool", () => {
  const commands: string[] = [];
  installCaret(
    {
      registerCommand: (name: string) => commands.push(name),
      registerTool: () => {},
      registerShortcut: () => {},
      registerEntryRenderer: () => {},
      on: () => {},
    } as unknown as PiApi,
    {
      version: "9.9.9",
      entryUrl: "file:///pkg/pi/caret.ts",
      holder: {},
      env: {},
      run: async () => ({ stdout: "", exitCode: 0 }),
      agentDir: "/agent",
      warm: () => {},
      spawn: () => {},
      stdout: () => {},
    },
  );
  expect(commands).toEqual(["caret"]);
  expect(planningSteer("/p", "s")).toContain(REVIEW_TOOL);
});

test("preflight runs this suite when only the Markdown it reads changed", () => {
  const markdown = [
    CLAUDE_SKILL,
    `${CLAUDE_REFERENCES}/plan.md`,
    `${CLAUDE_REFERENCES}/doctor.md`,
    OPENCODE_COMMAND,
    `${OPENCODE_REFERENCES}/plan.md`,
    `${OPENCODE_REFERENCES}/doctor.md`,
  ];
  expect(markdown.filter((rel) => !MARKDOWN_READ_BY_TESTS.includes(rel))).toEqual([]);
});
