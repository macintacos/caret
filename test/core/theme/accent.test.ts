import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAccentStore } from "@/theme/accent.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-accent-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("reads back the accents it wrote", async () => {
  const store = createAccentStore(join(dir, "accent.json"));
  await store.write({ light: "#336699", dark: "#88aacc" });
  expect(store.read()).toEqual({ light: "#336699", dark: "#88aacc" });
});

test("reads a corrupt file as no report", async () => {
  await writeFile(join(dir, "accent.json"), '{"light": "#3366');
  expect(createAccentStore(join(dir, "accent.json")).read()).toBeUndefined();
});

test("reads a file of another shape as no report", async () => {
  await writeFile(join(dir, "accent.json"), JSON.stringify({ light: "#336699" }));
  expect(createAccentStore(join(dir, "accent.json")).read()).toBeUndefined();
});
