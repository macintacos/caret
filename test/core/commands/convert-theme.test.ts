import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import dracula from "shiki/themes/dracula.mjs";

import { drainProcess } from "@test/support/cli-process.ts";
import { parseThemeFile } from "@/theme/schema.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-convert-theme-"));
  await writeFile(join(dir, "dracula.json"), JSON.stringify(dracula));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function convert(...args: string[]) {
  return drainProcess(
    Bun.spawn([process.execPath, "src/cli.ts", "convert-theme", ...args], {
      env: { ...process.env, XDG_CONFIG_HOME: join(dir, "config") },
      stdout: "pipe",
      stderr: "pipe",
    }),
  );
}

const themesDir = () => join(dir, "config", "caret", "themes");

test("--out writes a valid theme file, creating its directory, and notes the renamed id", async () => {
  const out = join(dir, "new-dir", "dracula.json");
  const r = await convert(join(dir, "dracula.json"), "--out", out);
  expect(r.exit).toBe(0);
  expect(r.stdout).toBe("");
  expect(parseThemeFile(await readFile(out, "utf8")).ok).toBe(true);
  expect(r.stderr).toMatch(/^caret convert-theme: .*dracula-custom/m);
  expect(existsSync(themesDir())).toBe(false);
});

test("without --out the theme file goes to stdout and nothing is written", async () => {
  const r = await convert(join(dir, "dracula.json"));
  expect(r.exit).toBe(0);
  expect(parseThemeFile(r.stdout).ok).toBe(true);
  expect(existsSync(themesDir())).toBe(false);
});

test("an input that caret refuses exits 1 and writes nothing", async () => {
  const input = join(dir, "inc.json");
  await writeFile(input, JSON.stringify({ ...dracula, include: "./base.json" }));
  const out = join(dir, "inc-out.json");
  const r = await convert(input, "--out", out);
  expect(r.exit).toBe(1);
  expect(r.stderr).toContain("include");
  expect(existsSync(out)).toBe(false);
});

test("a missing input exits 1 naming the path", async () => {
  const missing = join(dir, "nope.json");
  const r = await convert(missing);
  expect(r.exit).toBe(1);
  expect(r.stderr).toContain(missing);
});
