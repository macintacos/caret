import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  readOpencodeCommandDescription,
  readOpencodeCommands,
} from "@/adapters/opencode/skills.ts";

// OpenCode names a command by its path under `commands/` minus the `.md`, which
// is what carries caret's own `caret:` namespace through unchanged. Point
// OPENCODE_CONFIG_DIR at a throwaway temp dir so the walk never reads the real
// config dir; the prior value is restored after each test.

let tmp: string;
let savedOpencode: string | undefined;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-opencode-skills-"));
  savedOpencode = process.env.OPENCODE_CONFIG_DIR;
  process.env.OPENCODE_CONFIG_DIR = join(tmp, "opencode");
});
afterEach(async () => {
  if (savedOpencode === undefined) delete process.env.OPENCODE_CONFIG_DIR;
  else process.env.OPENCODE_CONFIG_DIR = savedOpencode;
  await rm(tmp, { recursive: true, force: true });
});

/** Write a command file at `<dir>/<rel>` under the temp config dir, defaulting to
 * the canonical plural command dir. `description`, when given, is the frontmatter
 * key the preview panel reads. */
async function seedCommand(rel: string, dir = "commands", description?: string): Promise<void> {
  const path = join(tmp, "opencode", dir, rel);
  await mkdir(dirname(path), { recursive: true });
  const front = description === undefined ? "" : `---\ndescription: ${description}\n---\n`;
  await writeFile(path, `${front}# a command\n`);
}

test("yields nothing when the command dir is absent, rather than throwing", async () => {
  expect(await readOpencodeCommands()).toEqual([]);
});

test("names a command by its file, minus the .md", async () => {
  await seedCommand("review.md");
  expect(await readOpencodeCommands()).toEqual([{ name: "review", origin: "command" }]);
});

test("keeps caret's own colon namespace verbatim", async () => {
  await seedCommand("caret:demo.md");
  expect(await readOpencodeCommands()).toEqual([{ name: "caret:demo", origin: "command" }]);
});

test("names a nested command by its path under commands/", async () => {
  await seedCommand(join("team", "deploy.md"));
  expect(await readOpencodeCommands()).toEqual([{ name: "team/deploy", origin: "command" }]);
});

test("ignores a non-markdown file", async () => {
  await seedCommand("notes.txt");
  await seedCommand("review.md");
  expect(await readOpencodeCommands()).toEqual([{ name: "review", origin: "command" }]);
});

test("sorts by name, so the list is the same on every machine", async () => {
  await seedCommand("zebra.md");
  await seedCommand("alpha.md");
  expect((await readOpencodeCommands()).map((s) => s.name)).toEqual(["alpha", "zebra"]);
});

test("offers a command from the legacy singular dir, which OpenCode still loads", async () => {
  await seedCommand("legacy.md", "command");
  expect(await readOpencodeCommands()).toEqual([{ name: "legacy", origin: "command" }]);
});

test("offers a name once when both command dirs hold it", async () => {
  await seedCommand("review.md");
  await seedCommand("review.md", "command");
  expect(await readOpencodeCommands()).toEqual([{ name: "review", origin: "command" }]);
});

// --- the description preview (EXC-1186) ---
//
// A second, on-demand route beside the enumeration above: the reviewer highlights
// one name in the `/` list and asks for that command's own description, so exactly
// one `.md` is opened. Each command dir is its own containment root, which is what
// makes a `../` inside a legitimately-nested name safe.

test("reads a command's description", async () => {
  await seedCommand("review.md", "commands", "Review the pending plan");
  expect(await readOpencodeCommandDescription("review")).toBe("Review the pending plan");
});

test("reads a nested command's description by its path", async () => {
  await seedCommand(join("team", "deploy.md"), "commands", "Ship to production");
  expect(await readOpencodeCommandDescription("team/deploy")).toBe("Ship to production");
});

test("reads a description from the legacy singular dir", async () => {
  await seedCommand("legacy.md", "command", "Still loaded by OpenCode");
  expect(await readOpencodeCommandDescription("legacy")).toBe("Still loaded by OpenCode");
});

test("prefers the canonical dir when both hold the name", async () => {
  await seedCommand("review.md", "commands", "The canonical one");
  await seedCommand("review.md", "command", "The legacy one");
  expect(await readOpencodeCommandDescription("review")).toBe("The canonical one");
});

test("stops at the canonical file even when it carries no description", async () => {
  // The canonical dir wins the NAME, so the legacy file is not the command
  // OpenCode loads — describing it here would describe the wrong file. A command
  // with no description is an ordinary answer, not a miss to retry one dir over.
  await seedCommand("review.md");
  await seedCommand("review.md", "command", "The legacy one");
  expect(await readOpencodeCommandDescription("review")).toBeNull();
});

test("yields null for a command with no frontmatter", async () => {
  await seedCommand("review.md");
  expect(await readOpencodeCommandDescription("review")).toBeNull();
});

test("yields null for a command that does not exist", async () => {
  expect(await readOpencodeCommandDescription("nope")).toBeNull();
});

test("refuses a name that climbs out of the command dirs", async () => {
  // `name` arrives from the browser, and a nested command legitimately carries a
  // `/` — so a `../` in one is ordinary input rather than a hypothetical.
  await mkdir(join(tmp, "opencode"), { recursive: true });
  await writeFile(join(tmp, "opencode", "escapee.md"), "---\ndescription: Outside\n---\n");
  expect(await readOpencodeCommandDescription("../escapee")).toBeNull();
});
