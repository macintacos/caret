// Standing gate for the fresh-clone invariant (EXC-933). Every task is a file
// task in .mise/tasks/ that ends in `exec bun scripts/tasks/cli.ts <name>`, and
// cli.ts imports its CLI framework and every task module at load time — so on a
// fresh clone the process dies during module resolution, before any task code
// runs. scripts/bootstrap.sh is the dep-free preamble that installs the missing
// tools and deps first, and it only helps a task that actually sources it.
//
// mise.toml states that in prose ("each sources scripts/bootstrap.sh first").
// This suite is what makes it falsifiable: a task added without the preamble —
// or one that sources it below its own `exec` line, where it can never run —
// fails `bun test` on the push that adds it rather than surfacing later as a
// `Cannot find package` for the next person to clone the repo.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The suite sits at test/structure/, two levels below the repo root; resolving
// against import.meta.dir reads the real tree regardless of the runner's cwd.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const TASKS_DIR = ".mise/tasks";

// The path the forwarders name, relative to the repo root.
const BOOTSTRAP = "scripts/bootstrap.sh";

// Every file in the directory is a forwarder; the count is deliberately not
// pinned, because the invariant is "no forwarder misses the preamble", not
// "there are exactly N tasks" — a new task must inherit the rule silently.
const forwarders = [...new Bun.Glob("*").scanSync({ cwd: join(REPO_ROOT, TASKS_DIR) })];

test("every .mise/tasks forwarder sources the bootstrap preamble before it execs", () => {
  const violations: string[] = [];

  for (const name of forwarders) {
    const lines = readFileSync(join(REPO_ROOT, TASKS_DIR, name), "utf-8").split("\n");
    // `startsWith("source ")` rather than a bare substring match: the preamble's
    // own comment names the same path, and a comment is not a source.
    const sourced = lines.findIndex(
      (line) => line.trimStart().startsWith("source ") && line.includes(BOOTSTRAP),
    );
    const execed = lines.findIndex((line) => line.startsWith("exec "));

    if (sourced === -1) violations.push(`${TASKS_DIR}/${name}: never sources ${BOOTSTRAP}`);
    else if (execed !== -1 && sourced > execed) {
      violations.push(`${TASKS_DIR}/${name}: sources ${BOOTSTRAP} below its exec line`);
    }
  }

  expect(violations).toEqual([]);
});

test("the walk found forwarders, and the file they all source exists", () => {
  // A glob that silently matched nothing would make the gate above vacuous.
  expect(forwarders.length).toBeGreaterThan(0);
  expect(existsSync(join(REPO_ROOT, BOOTSTRAP))).toBe(true);
});
