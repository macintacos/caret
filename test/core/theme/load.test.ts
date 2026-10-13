import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

import { fakeDistDir } from "@test/support/fs-tree.ts";
import { themeFileText } from "@test/support/theme.ts";
import { BUILTIN_THEME_IDS } from "@/theme/builtin-ids.ts";
import { collectThemes, loadCustomThemes, MAX_THEME_FILE_BYTES } from "@/theme/load.ts";
import { parseThemeFile } from "@/theme/schema.ts";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const asRoot = process.getuid?.() === 0;

function tempDir(files: Record<string, string> = {}): string {
  const dir = fakeDistDir("caret-themes-", files);
  temps.push(dir);
  return dir;
}

const theme = (id: string) => {
  const parsed = parseThemeFile(themeFileText(id));
  if (!parsed.ok) throw new Error(parsed.errors.join("\n"));
  return parsed.file;
};

const BAD = JSON.parse(themeFileText("bad"));
const BAD_INK = JSON.stringify({ ...BAD, palette: { ...BAD.palette, ink: "red" } });

function lockedFile(dir: string): void {
  writeFileSync(join(dir, "locked.json"), themeFileText("locked"));
  chmodSync(join(dir, "locked.json"), 0o000);
}

describe("loadCustomThemes", () => {
  test("a missing folder yields no themes and no errors", async () => {
    expect(await loadCustomThemes(join(tempDir(), "themes"))).toEqual({ themes: [], errors: [] });
  });

  test("an empty folder yields no themes and no errors", async () => {
    expect(await loadCustomThemes(tempDir())).toEqual({ themes: [], errors: [] });
  });

  test("loads valid files in file-name order", async () => {
    const dir = tempDir({ "b.json": themeFileText("zeta"), "a.json": themeFileText("alpha") });
    expect(await loadCustomThemes(dir)).toEqual({
      themes: [theme("alpha"), theme("zeta")],
      errors: [],
    });
  });

  test("ignores non-json names, dotfiles, folders, and dangling links", async () => {
    const dir = tempDir({
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
    const outside = tempDir({ "real.json": themeFileText("linked") });
    const dir = tempDir();
    symlinkSync(join(outside, "real.json"), join(dir, "linked.json"));
    expect(await loadCustomThemes(dir)).toEqual({ themes: [theme("linked")], errors: [] });
  });

  test("loads a file that starts with a UTF-8 BOM", async () => {
    const dir = tempDir({ "bom.json": `\uFEFF${themeFileText("bom")}` });
    expect(await loadCustomThemes(dir)).toEqual({ themes: [theme("bom")], errors: [] });
  });

  test("rejects a file over the size cap without blocking its siblings", async () => {
    const text = themeFileText("big");
    const dir = tempDir({
      "big.json": text.padEnd(MAX_THEME_FILE_BYTES + 1, " "),
      "ok.json": themeFileText("ok"),
    });
    expect(await loadCustomThemes(dir)).toEqual({
      themes: [theme("ok")],
      errors: [{ file: "big.json", messages: ["theme file: is larger than 64 KiB"] }],
    });
  });

  test("reports invalid JSON and schema failures beside a valid sibling", async () => {
    const dir = tempDir({
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
    const dir = tempDir({ "d.json": themeFileText("dracula") });
    expect(await loadCustomThemes(dir)).toEqual({
      themes: [],
      errors: [{ file: "d.json", messages: ['id: "dracula" is a built-in theme'] }],
    });
  });

  test("rejects every file that declares a shared id", async () => {
    const dir = tempDir({
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

  test.skipIf(asRoot)("reports a file that cannot be read", async () => {
    const dir = tempDir();
    lockedFile(dir);
    expect(await loadCustomThemes(dir)).toEqual({
      themes: [],
      errors: [{ file: "locked.json", messages: ["theme file: could not be read"] }],
    });
  });

  test("reports a symlink loop as unreadable", async () => {
    const dir = tempDir();
    symlinkSync("loop.json", join(dir, "loop.json"));
    expect(await loadCustomThemes(dir)).toEqual({
      themes: [],
      errors: [{ file: "loop.json", messages: ["theme file: could not be read"] }],
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
    const dir = tempDir({
      "big.json": " ".repeat(MAX_THEME_FILE_BYTES + 1),
      "broken.json": "{",
      "ink.json": BAD_INK,
      "d.json": themeFileText("dracula"),
      "a.json": themeFileText("dup"),
      "b.json": themeFileText("dup"),
    });
    if (!asRoot) lockedFile(dir);
    symlinkSync("loop.json", join(dir, "loop.json"));
    const notFolder = join(dir, "big.json");
    const json = JSON.stringify([await loadCustomThemes(dir), await loadCustomThemes(notFolder)]);
    expect(json).not.toContain(dir);
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

test("doc/CONFIGURING.md names every built-in theme id", () => {
  const doc = readFileSync(join(REPO_ROOT, "doc/CONFIGURING.md"), "utf8");
  const section = doc.split("\n### Where caret finds theme files\n")[1]?.split("\n### ")[0] ?? "";
  const named = [...section.matchAll(/`([a-z0-9-]+)`/g)].map((m) => m[1]);
  for (const id of BUILTIN_THEME_IDS) expect(named).toContain(id);
});
