import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { themeFileText } from "@test/support/theme.ts";
import { collectThemes, loadCustomThemes, MAX_THEME_FILE_BYTES } from "@/theme/load.ts";
import { parseThemeFile } from "@/theme/schema.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "caret-themes-"));
  temps.push(dir);
  return dir;
}

function themesDir(files: Record<string, string>): string {
  const dir = tempDir();
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const theme = (id: string) => {
  const parsed = parseThemeFile(themeFileText(id));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.file;
};

const BAD_INK = JSON.stringify({
  ...JSON.parse(themeFileText("bad")),
  palette: { ...JSON.parse(themeFileText("bad")).palette, ink: "red" },
});

describe("loadCustomThemes", () => {
  test("a missing folder yields no themes and no errors", async () => {
    expect(await loadCustomThemes(join(tempDir(), "themes"))).toEqual({ themes: [], errors: [] });
  });

  test("an empty folder yields no themes and no errors", async () => {
    expect(await loadCustomThemes(tempDir())).toEqual({ themes: [], errors: [] });
  });

  test("loads valid files in file-name order", async () => {
    const dir = themesDir({ "b.json": themeFileText("zeta"), "a.json": themeFileText("alpha") });
    expect(await loadCustomThemes(dir)).toEqual({
      themes: [theme("alpha"), theme("zeta")],
      errors: [],
    });
  });

  test("ignores non-json names, dotfiles, folders, and dangling links", async () => {
    const dir = themesDir({
      "notes.txt": "x",
      "README.md": "x",
      ".hidden.json": "x",
      "ok.json": themeFileText("ok"),
    });
    mkdirSync(join(dir, "sub"));
    mkdirSync(join(dir, "dir.json"));
    symlinkSync(join(dir, "missing"), join(dir, "gone.json"));
    expect(await loadCustomThemes(dir)).toEqual({ themes: [theme("ok")], errors: [] });
  });

  test("follows a symlink to a file outside the folder", async () => {
    const outside = themesDir({ "real.json": themeFileText("linked") });
    const dir = tempDir();
    symlinkSync(join(outside, "real.json"), join(dir, "linked.json"));
    expect(await loadCustomThemes(dir)).toEqual({ themes: [theme("linked")], errors: [] });
  });

  test("loads a file that starts with a UTF-8 BOM", async () => {
    const dir = themesDir({ "bom.json": `﻿${themeFileText("bom")}` });
    expect(await loadCustomThemes(dir)).toEqual({ themes: [theme("bom")], errors: [] });
  });

  test("rejects a file over the size cap without blocking its siblings", async () => {
    const text = themeFileText("big");
    const dir = themesDir({
      "big.json": text.padEnd(MAX_THEME_FILE_BYTES + 1, " "),
      "ok.json": themeFileText("ok"),
    });
    expect(await loadCustomThemes(dir)).toEqual({
      themes: [theme("ok")],
      errors: [{ file: "big.json", messages: ["theme file: is larger than 64 KiB"] }],
    });
  });

  test("reports invalid JSON and schema failures beside a valid sibling", async () => {
    const dir = themesDir({
      "broken.json": "{",
      "ink.json": BAD_INK,
      "ok.json": themeFileText("ok"),
    });
    const result = await loadCustomThemes(dir);
    expect(result.themes).toEqual([theme("ok")]);
    expect(result.errors).toEqual([
      {
        file: "broken.json",
        messages: [expect.stringMatching(/^theme file: is not valid JSON \(.+\)$/)],
      },
      { file: "ink.json", messages: ["palette.ink: must be a hex color like #1a2b3c"] },
    ]);
  });

  test("rejects a built-in theme's id", async () => {
    const dir = themesDir({ "d.json": themeFileText("dracula") });
    expect(await loadCustomThemes(dir)).toEqual({
      themes: [],
      errors: [{ file: "d.json", messages: ['id: "dracula" is a built-in theme'] }],
    });
  });

  test("rejects every file that declares a shared id", async () => {
    const dir = themesDir({
      "a.json": themeFileText("dup"),
      "b.json": themeFileText("dup"),
      "c.json": themeFileText("solo"),
    });
    const message = 'id: "dup" is declared by more than one file: a.json, b.json';
    expect(await loadCustomThemes(dir)).toEqual({
      themes: [theme("solo")],
      errors: [
        { file: "a.json", messages: [message] },
        { file: "b.json", messages: [message] },
      ],
    });
  });

  test("reports a folder that cannot be listed by its base name", async () => {
    const path = join(tempDir(), "themes");
    writeFileSync(path, "not a folder");
    expect(await loadCustomThemes(path)).toEqual({
      themes: [],
      errors: [{ file: basename(path), messages: ["theme folder: could not be read"] }],
    });
  });

  test("never reveals the folder's absolute path", async () => {
    const dir = themesDir({
      "big.json": " ".repeat(MAX_THEME_FILE_BYTES + 1),
      "broken.json": "{",
      "ink.json": BAD_INK,
      "d.json": themeFileText("dracula"),
      "a.json": themeFileText("dup"),
      "b.json": themeFileText("dup"),
    });
    const notFolder = join(dir, "big.json");
    const json = JSON.stringify([await loadCustomThemes(dir), await loadCustomThemes(notFolder)]);
    expect(json.includes(dir)).toBe(false);
  });
});

describe("collectThemes", () => {
  test("rejects the ids in the built-in list it is given", () => {
    const sources = [
      { file: "x.json", text: themeFileText("builtin-x") },
      { file: "y.json", text: themeFileText("dracula") },
    ];
    expect(collectThemes(sources, ["builtin-x"])).toEqual({
      themes: [theme("dracula")],
      errors: [{ file: "x.json", messages: ['id: "builtin-x" is a built-in theme'] }],
    });
  });
});
