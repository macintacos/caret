import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import { landsInside, resolveLikePi } from "@piext/gate.ts";

let tmp: string;
let plans: string;
let work: string;
let elsewhere: string;

beforeEach(() => {
  tmp = realpathSync.native(mkdtempSync(join(tmpdir(), "caret-gate-")));
  plans = join(tmp, "agent", "plans");
  work = join(tmp, "work");
  elsewhere = join(tmp, "elsewhere");
  for (const dir of [plans, work, elsewhere]) mkdirSync(dir, { recursive: true });
});

afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("landsInside", () => {
  test("accepts a new file inside the plans folder", () => {
    expect(landsInside(join(plans, "a.md"), work, plans)).toBe(true);
  });

  test("accepts an existing file inside the plans folder", () => {
    writeFileSync(join(plans, "a.md"), "");
    expect(landsInside(join(plans, "a.md"), work, plans)).toBe(true);
  });

  test("accepts a new file in a not-yet-existing subdirectory", () => {
    expect(landsInside(join(plans, "sub", "deep", "a.md"), work, plans)).toBe(true);
  });

  test("resolves a relative path against cwd", () => {
    expect(landsInside(relative(work, join(plans, "a.md")), work, plans)).toBe(true);
  });

  test("strips a leading @ as pi's tools do", () => {
    expect(landsInside(`@${join(plans, "a.md")}`, work, plans)).toBe(true);
  });

  test("rejects a ../ escape", () => {
    expect(landsInside(`${plans}/../outside.md`, work, plans)).toBe(false);
  });

  test("rejects a file in cwd", () => {
    expect(landsInside(join(work, "a.md"), work, plans)).toBe(false);
  });

  test("rejects a sibling sharing the folder's name as a prefix", () => {
    expect(landsInside(join(tmp, "agent", "plansX", "a.md"), work, plans)).toBe(false);
  });

  test("rejects a path through a symlink that leaves the folder", () => {
    symlinkSync(elsewhere, join(plans, "out"));
    expect(landsInside(join(plans, "out", "a.md"), work, plans)).toBe(false);
  });

  test("rejects a dangling symlink whose target lies outside", () => {
    symlinkSync(join(elsewhere, "missing", "x"), join(plans, "dangle"));
    expect(landsInside(join(plans, "dangle"), work, plans)).toBe(false);
  });

  test("rejects a path under a regular file", () => {
    writeFileSync(join(plans, "file.md"), "");
    expect(landsInside(join(plans, "file.md", "x"), work, plans)).toBe(false);
  });

  test("expands ~ to the home directory", () => {
    expect(resolve(homedir()).startsWith(plans)).toBe(false);
    expect(landsInside("~/x.md", plans, plans)).toBe(false);
  });

  test("reads Unicode spaces as plain spaces, as pi's tools write them", () => {
    symlinkSync(elsewhere, join(plans, "sp ce"));
    expect(landsInside(join(plans, "sp\u00A0ce", "a.md"), work, plans)).toBe(false);
  });

  test("rejects a file: URL, which pi's tools resolve as a local path", () => {
    expect(landsInside("@file:///etc/hosts", plans, plans)).toBe(false);
  });

  describe("on a case-insensitive filesystem", () => {
    const probe = realpathSync.native(mkdtempSync(join(tmpdir(), "caret-gate-case-")));
    mkdirSync(join(probe, "Aa"));
    const caseInsensitive = existsSync(join(probe, "aA"));
    rmSync(probe, { recursive: true, force: true });

    const upper = () => join(tmp, "AGENT", "PLANS", "new.md");

    test.skipIf(!caseInsensitive)("accepts a differently-cased path under Bun", () => {
      expect(landsInside(upper(), work, plans)).toBe(true);
    });

    test.skipIf(!caseInsensitive)("accepts a differently-cased path under Node", () => {
      const gate = Bun.resolveSync("@piext/gate.ts", import.meta.dir);
      const args = JSON.stringify([upper(), work, plans]);
      const script = `const { landsInside } = await import(${JSON.stringify(gate)}); console.log(landsInside(...${args}));`;
      const run = spawnSync("node", ["--input-type=module", "-e", script], { encoding: "utf8" });
      expect(run.status, run.stderr).toBe(0);
      expect(run.stdout.trim()).toBe("true");
    });
  });
});

const { resolveToCwd } = await import(
  Bun.resolveSync("@earendil-works/pi-coding-agent/package.json", import.meta.dir).replace(
    "package.json",
    "dist/core/tools/path-utils.js",
  )
);

describe("resolveLikePi", () => {
  test.each(["a.md", "@a.md", "~/a.md", "~", "sp\u00A0ce/a.md", "/abs/a.md"])(
    "resolves %p as pi's tools do",
    (input) => {
      expect(resolveLikePi(input, work)).toBe(resolveToCwd(input, work));
    },
  );

  // The one known divergence: pi reads a file: URL as a local path; the gate blocks it.
  test("diverges from pi on a file: URL", () => {
    expect(resolveLikePi("file:///abs/a.md", work)).not.toBe(
      resolveToCwd("file:///abs/a.md", work),
    );
  });
});
