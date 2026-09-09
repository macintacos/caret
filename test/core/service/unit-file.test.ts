import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { unitUnchanged } from "@/service/unit-file.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "caret-unit-file-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const UNIT = "[Service]\nExecStart=/bin/caret\n";

function unit(text: string): string {
  const path = join(dir, "caret.service");
  writeFileSync(path, text);
  return path;
}

test("a unit holding exactly the generated text is unchanged", () => {
  expect(unitUnchanged(unit(UNIT), UNIT)).toBe(true);
});

test("a unit missing only its trailing newline is changed", () => {
  expect(unitUnchanged(unit(UNIT), UNIT.trimEnd())).toBe(false);
});

test("a unit that was never written is changed, so the install writes it", () => {
  expect(unitUnchanged(join(dir, "absent.service"), UNIT)).toBe(false);
});

test("a path that cannot be read is changed, so the install writes it", () => {
  // EISDIR rather than ENOENT — the branch that lets both managers skip an existsSync.
  expect(unitUnchanged(dir, UNIT)).toBe(false);
});
