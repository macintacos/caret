import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readJsonFile, readJsonFileSync } from "../../src/lib/json-file.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-json-file-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("readJsonFileSync parses a valid JSON file", async () => {
  const path = join(dir, "ok.json");
  await writeFile(path, JSON.stringify({ a: 1, b: ["x"] }));
  expect(readJsonFileSync(path)).toEqual({ a: 1, b: ["x"] });
});

test("readJsonFileSync returns null for an absent file", () => {
  expect(readJsonFileSync(join(dir, "missing.json"))).toBeNull();
});

test("readJsonFileSync returns null for malformed JSON", async () => {
  const path = join(dir, "bad.json");
  await writeFile(path, "{ not json");
  expect(readJsonFileSync(path)).toBeNull();
});

test("readJsonFile parses a valid JSON file", async () => {
  const path = join(dir, "ok.json");
  await writeFile(path, JSON.stringify({ ok: true }));
  expect(await readJsonFile(path)).toEqual({ ok: true });
});

test("readJsonFile returns null for an absent file", async () => {
  expect(await readJsonFile(join(dir, "missing.json"))).toBeNull();
});

test("readJsonFile returns null for malformed JSON", async () => {
  const path = join(dir, "bad.json");
  await writeFile(path, "}{");
  expect(await readJsonFile(path)).toBeNull();
});
