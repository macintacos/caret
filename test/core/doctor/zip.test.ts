// caret hand-writes the zip container, so the checks that matter are whether a real
// unzip reads it and whether the file is owner-only from the moment it exists. `unzip`
// is the independent oracle on purpose: a parser written here from the same spec as the
// writer would share any misreading of it.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeZip } from "@/doctor/zip.ts";

const NOW = new Date("2026-06-04T12:34:56.000Z");

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "caret-zip-"));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function unzip(args: string[]): { exitCode: number | null; stdout: string; stderr: string } {
  const r = Bun.spawnSync(["unzip", ...args]);
  return { exitCode: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const bytes = (s: string) => new TextEncoder().encode(s);

test("a written archive passes unzip's integrity check and yields each entry back", () => {
  const path = join(tmp, "out.zip");
  // Repetitive so deflate has something to do; the round-trip is what proves the
  // compressed sizes and CRCs in both headers agree with the payload.
  const log = "x".repeat(5000);
  writeZip(
    path,
    [
      { name: "logs/caret.log", data: bytes(log) },
      { name: "reviews/abc.json", data: bytes('{"id":"abc"}') },
    ],
    NOW,
  );

  expect(unzip(["-t", path]).exitCode).toBe(0);
  expect(unzip(["-p", path, "logs/caret.log"]).stdout).toBe(log);
  expect(unzip(["-p", path, "reviews/abc.json"]).stdout).toBe('{"id":"abc"}');
  expect(unzip(["-l", path]).stdout).toContain("2 files");
});

test("an archive with no members reads as empty rather than as corrupt", () => {
  // A state dir with no logs and no reviews is a normal first run, so the bundle has to
  // be a well-formed archive that happens to hold nothing — unzip says "empty", not
  // "cannot find zipfile directory".
  const path = join(tmp, "empty.zip");
  writeZip(path, [], NOW);
  const { stdout, stderr } = unzip(["-l", path]);
  expect(`${stdout}${stderr}`).toContain("zipfile is empty");
});

test("the archive is owner-only from the moment it exists", () => {
  const path = join(tmp, "mode.zip");
  writeZip(path, [{ name: "a.txt", data: bytes("a") }], NOW);
  expect(statSync(path).mode & 0o777).toBe(0o600);
});

test("an existing path is a refusal, never an overwrite", () => {
  const path = join(tmp, "once.zip");
  writeZip(path, [{ name: "a.txt", data: bytes("first") }], NOW);
  expect(() => writeZip(path, [{ name: "a.txt", data: bytes("second") }], NOW)).toThrow();
  expect(unzip(["-p", path, "a.txt"]).stdout).toBe("first");
});
