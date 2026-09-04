// Standing gate for the fresh-clone invariant (EXC-933). Every task is a file
// task in .mise/tasks/ that ends in `exec bun scripts/tasks/cli.ts <name>`, and
// cli.ts imports its CLI framework and every task module at load time — so on a
// fresh clone the process dies during module resolution, before any task code
// runs. scripts/bootstrap.sh is the dep-free preamble that installs the missing
// tools and deps first, and it only helps a task that actually sources it.
//
// mise.toml states that in prose ("Each one sources `scripts/bootstrap.sh`
// first"). This suite is what makes it falsifiable: a task added without the
// preamble — or one that sources it below its own `exec` line, where it can
// never run — fails `bun test` on the push that adds it rather than surfacing
// later as a `Cannot find package` for the next person to clone the repo.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// From import.meta.dir, not cwd, so the suite reads the real tree wherever it runs.
const REPO_ROOT = join(import.meta.dir, "..", "..");

const TASKS_DIR = ".mise/tasks";

// The path the forwarders name, relative to the repo root.
const BOOTSTRAP = "scripts/bootstrap.sh";

// Every file under the directory is a forwarder; the count is deliberately not
// pinned, because the invariant is "no forwarder misses the preamble", not
// "there are exactly N tasks" — a new task must inherit the rule silently. The
// walk recurses because mise namespaces a task in a subdirectory rather than
// ignoring it (`.mise/tasks/db/migrate` runs as `db:migrate`), so a shallow
// glob would let exactly the kind of task this gate exists for slip past.
const forwarders = [...new Bun.Glob("**/*").scanSync({ cwd: join(REPO_ROOT, TASKS_DIR) })];

test("every .mise/tasks forwarder sources the bootstrap preamble before it execs", () => {
  const violations: string[] = [];

  for (const name of forwarders) {
    const lines = readFileSync(join(REPO_ROOT, TASKS_DIR, name), "utf-8").split("\n");
    // Anchored at both ends, which pins the whole caller contract rather than
    // just the path: `|| exit 1` is what turns a failed cold install into its
    // real error instead of the `Cannot find package` the guard exists to
    // prevent (scripts/bootstrap.sh documents it). Unindented on purpose — an
    // indented `source` is a conditional one, which is not the invariant.
    const sourced = lines.findIndex(
      (line) => line.startsWith("source ") && line.endsWith(`${BOOTSTRAP}" || exit 1`),
    );
    // `trimStart` here but not above: an `exec` nested in an `if`/`case` is
    // still an exec, and missing it would silently disable the ordering check.
    const execed = lines.findIndex((line) => line.trimStart().startsWith("exec "));

    // Names the whole line, not just the path: the common failure is a
    // forwarder that sources the guard but drops the `|| exit 1`.
    if (sourced === -1)
      violations.push(`${TASKS_DIR}/${name}: no \`source … ${BOOTSTRAP}" || exit 1\``);
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
