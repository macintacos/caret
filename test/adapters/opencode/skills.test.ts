import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readOpencodeCommands } from "@/adapters/opencode/skills.ts";

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

/** Write a command file at `commands/<rel>` under the temp config dir. */
async function seedCommand(rel: string): Promise<void> {
  const path = join(tmp, "opencode", "commands", rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, "# a command\n");
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
