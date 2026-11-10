import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { piAdapter } from "@/adapters/pi/index.ts";

const FIXTURES = join(import.meta.dir, "fixtures", "install");

let tmp: string;
let saved: string | undefined;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-pi-adapter-"));
  saved = process.env.PI_CODING_AGENT_DIR;
});
afterEach(async () => {
  if (saved === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = saved;
  await rm(tmp, { recursive: true, force: true });
});

test("the pi adapter declares its id, single approve, and reload hint", () => {
  expect(piAdapter.id).toBe("pi");
  expect(piAdapter.approveVariants).toEqual([
    { id: "default", label: "Approve", description: "Approve this plan" },
  ]);
  expect(piAdapter.approveCarriesNotes).toBe(true);
  expect(piAdapter.restartHint).toBe("Then run /reload in pi.");
});

test("readInstallState reads the agent dir PI_CODING_AGENT_DIR names", () => {
  process.env.PI_CODING_AGENT_DIR = join(FIXTURES, "npm-entry");
  expect(piAdapter.readInstallState().pluginVersion).toBe("1.8.1");
});

test("listSkills offers a user skill from the agent dir", async () => {
  const agentDir = join(tmp, "agent");
  const cwd = join(tmp, "repo");
  await mkdir(join(agentDir, "skills", "alpha"), { recursive: true });
  await writeFile(join(agentDir, "skills", "alpha", "SKILL.md"), "---\ndescription: a\n---\n");
  await mkdir(join(cwd, ".git"), { recursive: true });
  process.env.PI_CODING_AGENT_DIR = agentDir;
  expect(await piAdapter.listSkills(cwd)).toContainEqual({ name: "skill:alpha", origin: "user" });
});
