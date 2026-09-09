// The targeted `[daemon] resident` edit: it changes one key and leaves the rest of a
// hand-authored config.toml — comments, spacing, key order — exactly as it found it.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { setDaemonResident, writeDaemonResident } from "@/config/resident.ts";
import { loadSettings } from "@/config/settings.ts";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-resident-"));
  file = join(dir, "config.toml");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("an empty file gains the table and the key", () => {
  expect(setDaemonResident("", false)).toBe("[daemon]\nresident = false\n");
});

test("a config with no [daemon] table gains one at the end", () => {
  const text = '[logging]\nlevel = "debug"\n';

  expect(setDaemonResident(text, false)).toBe(
    '[logging]\nlevel = "debug"\n\n[daemon]\nresident = false\n',
  );
});

test("a [daemon] table without the key gains it under the header", () => {
  const text = "[daemon]\nport = 42718\n\n[review]\ntimeout_s = 3600\n";

  expect(setDaemonResident(text, false)).toBe(
    "[daemon]\nresident = false\nport = 42718\n\n[review]\ntimeout_s = 3600\n",
  );
});

test("an existing key is replaced in place, leaving its neighbours alone", () => {
  const text = "[daemon]\nport = 42718\nresident = true\nidle_ms = 60000\n";

  expect(setDaemonResident(text, false)).toBe(
    "[daemon]\nport = 42718\nresident = false\nidle_ms = 60000\n",
  );
  expect(setDaemonResident(setDaemonResident(text, false), true)).toBe(text);
});

test("a header carrying a comment is the same table, not a missing one", () => {
  const text = "[daemon] # the knobs\nport = 42718\n";

  expect(setDaemonResident(text, true)).toBe(
    "[daemon] # the knobs\nresident = true\nport = 42718\n",
  );
});

test("a `resident` key in another table is left alone", () => {
  const text = "[review]\nresident = true\n\n[daemon]\nport = 42718\n";

  expect(setDaemonResident(text, false)).toBe(
    "[review]\nresident = true\n\n[daemon]\nresident = false\nport = 42718\n",
  );
});

test("the edited config parses back to the written value with its comments intact", async () => {
  await writeFile(
    file,
    "# my caret config\n[daemon]\n# keep the port off 42718's neighbours\nport = 4200\nresident = true\n",
  );

  writeDaemonResident(false, file);

  expect(loadSettings(file).daemon).toMatchObject({ resident: false, port: 4200 });
  expect(await readFile(file, "utf8")).toContain("# keep the port off 42718's neighbours");
});

test("a config that cannot be read is left alone rather than overwritten", async () => {
  // Write-only: the read fails for a reason that is not "no config yet", while the write
  // that would clobber it still succeeds. Only distinguishing the two saves the file.
  const original = "[daemon]\nport = 4200\n";
  await writeFile(file, original);
  await chmod(file, 0o200);

  expect(() => writeDaemonResident(false, file)).toThrow();

  await chmod(file, 0o600);
  expect(await readFile(file, "utf8")).toBe(original);
});

test("writing to an absent config creates it with just the key", async () => {
  writeDaemonResident(false, file);

  expect(await readFile(file, "utf8")).toBe("[daemon]\nresident = false\n");
  expect(loadSettings(file).daemon.resident).toBe(false);
});
