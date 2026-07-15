import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deployFiles, removeFiles, renderPlugin } from "@/adapters/opencode/deploy.ts";

test("renderPlugin substitutes the version and bin markers (all occurrences)", () => {
  const out = renderPlugin(`v="__CARET_VERSION__"; bin="__CARET_BIN__"; again="__CARET_BIN__"`, {
    version: "1.2.3",
    binPath: "/x/bin/caret",
  });
  expect(out).toBe(`v="1.2.3"; bin="/x/bin/caret"; again="/x/bin/caret"`);
});

test("renderPlugin substitutes values literally even when they contain $-sequences", () => {
  // A filesystem path may legally contain `$&`, `$$`, `$\``; a plain string
  // replacement would reinterpret those as String.replace substitution patterns
  // and corrupt the deployed binary path in a command file.
  const out = renderPlugin(`bin="__CARET_BIN__"; v="__CARET_VERSION__"`, {
    version: "1.0$$beta",
    binPath: "/home/a$&b/bin/caret",
  });
  expect(out).toBe(`bin="/home/a$&b/bin/caret"; v="1.0$$beta"`);
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-deploy-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("deployFiles writes files, creating parent dirs, and is idempotent", () => {
  const path = join(dir, "commands", "caret:demo.md");
  const r1 = deployFiles([{ path, contents: "A" }], { dryRun: false });
  expect(r1.paths).toEqual([path]);
  expect(readFileSync(path, "utf-8")).toBe("A");
  // Re-deploy overwrites in place — no duplicate, no error.
  deployFiles([{ path, contents: "B" }], { dryRun: false });
  expect(readFileSync(path, "utf-8")).toBe("B");
});

test("deployFiles in dry-run reports paths but writes nothing", () => {
  const path = join(dir, "commands", "caret:demo.md");
  const r = deployFiles([{ path, contents: "A" }], { dryRun: true });
  expect(r.dryRun).toBe(true);
  expect(r.paths).toEqual([path]);
  expect(existsSync(path)).toBe(false);
});

test("removeFiles removes/reports only files that exist; dry-run leaves them", async () => {
  const path = join(dir, "commands", "caret:demo.md");
  await mkdir(join(dir, "commands"), { recursive: true });
  await writeFile(path, "A");
  const dry = removeFiles([path], { dryRun: true });
  expect(dry.paths).toEqual([path]); // existing file previewed
  expect(existsSync(path)).toBe(true); // dry-run leaves it
  const real = removeFiles([path], { dryRun: false });
  expect(real.paths).toEqual([path]); // actually removed
  expect(existsSync(path)).toBe(false);
  // A target that was never installed is reported as removed-nothing, not a lie.
  const missing = removeFiles([join(dir, "nope")], { dryRun: false });
  expect(missing.paths).toEqual([]);
});
