import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { piSkillRoots, readPiSkillDescription, readPiSkills } from "@/adapters/pi/skills.ts";

let tmp: string;
const extra: string[] = [];

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-pi-skills-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
  for (const dir of extra.splice(0)) await rm(dir, { recursive: true, force: true });
});

/** Write `<dir>/SKILL.md` — the file that makes a directory a skill. */
async function seedSkill(dir: string, description?: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  const front = description === undefined ? "" : `description: ${description}\n`;
  await writeFile(join(dir, "SKILL.md"), `---\nname: x\n${front}---\n`);
}

const agent = () => join(tmp, "agent");
const home = () => join(tmp, "home");
const repo = () => join(tmp, "repo");
const cwd = () => join(repo(), "sub");

async function rootsForRepo() {
  await mkdir(join(repo(), ".git"), { recursive: true });
  await mkdir(cwd(), { recursive: true });
  return piSkillRoots(cwd(), { agentDir: agent(), home: home() });
}

test("lists every root's skills in root order, then name order", async () => {
  await seedSkill(join(agent(), "skills", "alpha"));
  await seedSkill(join(home(), ".agents", "skills", "beta"));
  await seedSkill(join(cwd(), ".pi", "skills", "gamma"));
  await seedSkill(join(cwd(), ".agents", "skills", "delta"));
  await seedSkill(join(repo(), ".agents", "skills", "epsilon"));
  await seedSkill(join(tmp, ".agents", "skills", "zeta"));
  expect(await readPiSkills(await rootsForRepo())).toEqual([
    { name: "skill:alpha", origin: "user" },
    { name: "skill:beta", origin: "user-agents" },
    { name: "skill:gamma", origin: "project" },
    { name: "skill:delta", origin: "project-agents" },
    { name: "skill:epsilon", origin: "project-agents" },
  ]);
});

test("finds nested skills without descending into a skill", async () => {
  const skills = join(agent(), "skills");
  await seedSkill(join(skills, "group", "nested"));
  await seedSkill(join(skills, "alpha"));
  await seedSkill(join(skills, "alpha", "inner"));
  expect((await readPiSkills(await rootsForRepo())).map((s) => s.name)).toEqual([
    "skill:alpha",
    "skill:nested",
  ]);
});

test("skips hidden and node_modules directories", async () => {
  const skills = join(agent(), "skills");
  await seedSkill(join(skills, ".hidden", "x"));
  await seedSkill(join(skills, "node_modules", "y"));
  expect(await readPiSkills(await rootsForRepo())).toEqual([]);
});

test("walks at most MAX_DEPTH directories below a root", async () => {
  const skills = join(agent(), "skills");
  await seedSkill(join(skills, "a", "b", "c", "d"));
  await seedSkill(join(skills, "a", "b", "c", "d2", "e"));
  expect((await readPiSkills(await rootsForRepo())).map((s) => s.name)).toEqual(["skill:d"]);
});

test("lists a name once per origin when two skills share a directory name", async () => {
  await seedSkill(join(agent(), "skills", "a", "deploy"));
  await seedSkill(join(agent(), "skills", "b", "deploy"));
  await seedSkill(join(cwd(), ".agents", "skills", "ship"));
  await seedSkill(join(repo(), ".agents", "skills", "ship"));
  expect(await readPiSkills(await rootsForRepo())).toEqual([
    { name: "skill:deploy", origin: "user" },
    { name: "skill:ship", origin: "project-agents" },
  ]);
});

test("returns nothing when no root exists", async () => {
  expect(await readPiSkills(await rootsForRepo())).toEqual([]);
});

test("terminates on a symlink loop", async () => {
  const skills = join(agent(), "skills");
  await seedSkill(join(skills, "alpha"));
  await symlink(skills, join(skills, "loop"));
  expect((await readPiSkills(await rootsForRepo())).map((s) => s.name)).toEqual(["skill:alpha"]);
});

test("lists a symlinked skill but never descends a symlinked directory", async () => {
  const skills = join(agent(), "skills");
  await seedSkill(join(tmp, "elsewhere", "linked"));
  await seedSkill(join(tmp, "elsewhere", "group", "deep"));
  await mkdir(skills, { recursive: true });
  await symlink(join(tmp, "elsewhere", "linked"), join(skills, "linked"));
  await symlink(join(tmp, "elsewhere", "group"), join(skills, "group"));
  expect((await readPiSkills(await rootsForRepo())).map((s) => s.name)).toEqual(["skill:linked"]);
});

test("a directory reached as two roots lists its skills once, under the first", async () => {
  const tmp2 = await mkdtemp(join(tmpdir(), "caret-pi-skills-"));
  extra.push(tmp2);
  await seedSkill(join(tmp2, ".agents", "skills", "shared"));
  await mkdir(join(tmp2, "proj"), { recursive: true });
  const roots = piSkillRoots(join(tmp2, "proj"), { agentDir: join(tmp2, "agent"), home: tmp2 });
  expect(await readPiSkills(roots)).toEqual([{ name: "skill:shared", origin: "user-agents" }]);
});

test("reads a skill's description from the root its origin names", async () => {
  await seedSkill(join(agent(), "skills", "group", "nested"), "Nested things");
  const roots = await rootsForRepo();
  expect(await readPiSkillDescription(roots, { name: "skill:nested", origin: "user" })).toBe(
    "Nested things",
  );
  expect(await readPiSkillDescription(roots, { name: "skill:nope", origin: "user" })).toBeNull();
  expect(
    await readPiSkillDescription(roots, { name: "skill:nested", origin: "project" }),
  ).toBeNull();
});
