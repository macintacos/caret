import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { themeFileText } from "@test/support/theme.ts";
import { loadCustomThemes } from "@/theme/load.ts";
import { createThemeWriter, planThemeWrite } from "@/theme/save.ts";
import { parseThemeFile } from "@/theme/schema.ts";

describe("planThemeWrite", () => {
  test("an empty folder removes nothing", () => {
    expect(planThemeWrite("twin", [])).toEqual({ remove: [] });
  });

  test("removes every other file declaring the id, whatever its case", () => {
    const plan = planThemeWrite("twin", [
      { file: "a.json", text: themeFileText("twin") },
      { file: "Twin.json", text: themeFileText("twin") },
      { file: "other.json", text: themeFileText("other") },
    ]);
    expect(plan).toEqual({ remove: ["a.json", "Twin.json"] });
  });

  test("keeps <id>.json when it declares the same id", () => {
    expect(planThemeWrite("twin", [{ file: "twin.json", text: themeFileText("twin") }])).toEqual({
      remove: [],
    });
  });

  test.each(["nightly.json", "NIGHTLY.json"])(
    "%s declaring another id is a conflict naming both",
    (file) => {
      const plan = planThemeWrite("nightly", [{ file, text: themeFileText("foo") }]);
      expect(plan).toEqual({
        conflict: `${file} already holds the theme "foo"; rename or delete it, then upload again`,
      });
    },
  );

  test("leaves invalid files and error sources alone", () => {
    const plan = planThemeWrite("twin", [
      { file: "bad.json", text: "{ not json" },
      { file: "big.json", error: "theme file: could not be read" },
    ]);
    expect(plan).toEqual({ remove: [] });
  });
});

describe("createThemeWriter", () => {
  let root: string;
  let dir: string;
  const listing = () => readdirSync(dir).sort();

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "caret-theme-save-"));
    dir = join(root, "themes");
    mkdirSync(dir);
  });
  afterEach(() => {
    expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    rmSync(root, { recursive: true, force: true });
  });

  test("writes exactly <id>.json holding the uploaded text and returns the parsed theme", async () => {
    const text = `${themeFileText("nightly")}\n`;
    const parsed = parseThemeFile(text);
    if (!parsed.ok) throw new Error("fixture must parse");
    expect(await createThemeWriter(dir).save(text)).toEqual({
      ok: true,
      theme: parsed.file,
      unremoved: [],
    });
    expect(listing()).toEqual(["nightly.json"]);
    expect(readFileSync(join(dir, "nightly.json"), "utf-8")).toBe(text);
  });

  test("creates a missing folder", async () => {
    rmSync(dir, { recursive: true });
    expect((await createThemeWriter(dir).save(themeFileText("nightly"))).ok).toBe(true);
    expect(listing()).toEqual(["nightly.json"]);
  });

  test.each(["{ not json", JSON.stringify({ id: "x" })])(
    "an invalid upload is invalid with the parser's lines and writes nothing",
    async (text) => {
      writeFileSync(join(dir, "keep.json"), themeFileText("keep"));
      const parsed = parseThemeFile(text) as { errors: string[] };
      expect(await createThemeWriter(dir).save(text)).toEqual({
        ok: false,
        reason: "invalid",
        errors: parsed.errors,
      });
      expect(listing()).toEqual(["keep.json"]);
    },
  );

  test("a built-in id is invalid", async () => {
    expect(await createThemeWriter(dir).save(themeFileText("dracula"))).toEqual({
      ok: false,
      reason: "invalid",
      errors: ['id: "dracula" is a built-in theme'],
    });
    expect(listing()).toEqual([]);
  });

  test("a duplicated id becomes one <id>.json the load serves cleanly", async () => {
    writeFileSync(join(dir, "a.json"), themeFileText("twin"));
    writeFileSync(join(dir, "b.json"), themeFileText("twin"));
    expect(
      (await createThemeWriter(dir).save(themeFileText("twin", { accent: "#123456" }))).ok,
    ).toBe(true);
    expect(listing()).toEqual(["twin.json"]);
    const loaded = await loadCustomThemes(dir);
    expect(loaded.themes.map((t) => t.id)).toEqual(["twin"]);
    expect(loaded.errors).toEqual([]);
  });

  test("a removal that fails after the write is a save naming the file left behind", async () => {
    writeFileSync(join(dir, "a.json"), themeFileText("nightly"));
    const text = themeFileText("nightly", { accent: "#123456" });
    const parsed = parseThemeFile(text);
    if (!parsed.ok) throw new Error("fixture must parse");
    const remove = () => Promise.reject(Object.assign(new Error("denied"), { code: "EPERM" }));
    const saved = await createThemeWriter(dir, remove).save(text);
    expect(saved).toEqual({
      ok: true,
      theme: parsed.file,
      unremoved: ["a.json"],
      code: "EPERM",
    });
    expect(readFileSync(join(dir, "nightly.json"), "utf-8")).toBe(text);
  });

  test("a conflict is refused and writes nothing", async () => {
    const held = themeFileText("foo");
    writeFileSync(join(dir, "nightly.json"), held);
    const saved = await createThemeWriter(dir).save(themeFileText("nightly"));
    expect(saved).toMatchObject({ ok: false, reason: "conflict" });
    expect(listing()).toEqual(["nightly.json"]);
    expect(readFileSync(join(dir, "nightly.json"), "utf-8")).toBe(held);
  });

  test("overwrites an invalid <id>.json", async () => {
    writeFileSync(join(dir, "nightly.json"), "{ not json");
    const text = themeFileText("nightly");
    expect((await createThemeWriter(dir).save(text)).ok).toBe(true);
    expect(readFileSync(join(dir, "nightly.json"), "utf-8")).toBe(text);
  });

  test("a folder path that is a file is unwritable with fixed text and the fs code", async () => {
    const file = join(dir, "not-a-dir");
    writeFileSync(file, "");
    expect(await createThemeWriter(file).save(themeFileText("nightly"))).toEqual({
      ok: false,
      reason: "unwritable",
      errors: ["theme folder: could not be written"],
      code: "EEXIST",
    });
  });

  test("a case-variant twin leaves one file holding the new text", async () => {
    writeFileSync(join(dir, "Twin.json"), themeFileText("twin"));
    const text = themeFileText("twin", { accent: "#123456" });
    expect((await createThemeWriter(dir).save(text)).ok).toBe(true);
    const files = listing();
    expect(files.map((f) => f.toLowerCase())).toEqual(["twin.json"]);
    expect(readFileSync(join(dir, files[0] ?? ""), "utf-8")).toBe(text);
  });

  test("a failed write keeps the file that declared the id", async () => {
    writeFileSync(join(dir, "nightly.json"), themeFileText("foo"));
    mkdirSync(join(dir, "foo.json"));
    expect(await createThemeWriter(dir).save(themeFileText("foo"))).toMatchObject({
      ok: false,
      reason: "unwritable",
    });
    expect(listing()).toEqual(["foo.json", "nightly.json"]);
  });

  test.each(["a/b", "../x"])("a non-slug id %s is invalid and writes nothing", async (id) => {
    expect(await createThemeWriter(dir).save(themeFileText(id))).toMatchObject({
      ok: false,
      reason: "invalid",
    });
    expect(listing()).toEqual([]);
    expect(readdirSync(root)).toEqual(["themes"]);
  });

  test("two concurrent saves of one id both resolve and leave one file", async () => {
    const writer = createThemeWriter(dir);
    const results = await Promise.all([
      writer.save(themeFileText("twin", { accent: "#111111" })),
      writer.save(themeFileText("twin", { accent: "#222222" })),
    ]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(listing()).toEqual(["twin.json"]);
  });
});
