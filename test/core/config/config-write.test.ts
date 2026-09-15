import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createConfigWriter, withUpdatesCheck } from "@/config/config-write.ts";

// EXC-1354. The Settings → Updates toggle edits one line of the user's config.toml,
// so the edit is a text rewrite rather than a parse-and-stringify: smol-toml's
// stringify would drop their comments and formatting. What keeps that safe is the
// parse-verified net — a rewrite that would change anything but `updates.check`
// refuses, leaving the file untouched, and the toggle tells the user to edit by hand.

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-config-write-"));
  file = join(dir, "config.toml");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("withUpdatesCheck", () => {
  test("writes the table into empty text with no leading blank line", () => {
    expect(withUpdatesCheck("", false)).toBe("[updates]\ncheck = false\n");
  });

  test("appends the table to a file that has none, keeping the original bytes as a prefix", () => {
    const original = '# my config\n[logging]\nlevel = "debug"\n';
    const out = withUpdatesCheck(original, false);
    expect(out?.startsWith(original)).toBe(true);
    expect(out).toContain("[updates]\ncheck = false\n");
  });

  test("swaps the value in place and keeps the trailing comment", () => {
    const out = withUpdatesCheck("[updates]\ncheck = true  # why\n", false);
    expect(out).toBe("[updates]\ncheck = false  # why\n");
  });

  test("inserts the key right after a header that lacks it", () => {
    const out = withUpdatesCheck('[updates]\n[logging]\nlevel = "warn"\n', false);
    expect(out).toBe('[updates]\ncheck = false\n[logging]\nlevel = "warn"\n');
  });

  test("keeps a CRLF file readable", () => {
    const out = withUpdatesCheck("[updates]\r\ncheck = true\r\n", false);
    expect(out).toContain("check = false");
    expect(withUpdatesCheck(out as string, false)).toBe(out);
  });

  test("returns the text unchanged when the value is already set", () => {
    const original = "[updates]\ncheck = false\n";
    expect(withUpdatesCheck(original, false)).toBe(original);
  });

  test("refuses a dotted key rather than leaving two spellings behind", () => {
    expect(withUpdatesCheck("updates.check = true\n", false)).toBeNull();
  });

  test("refuses an inline table", () => {
    expect(withUpdatesCheck("updates = { check = true }\n", false)).toBeNull();
  });

  test("refuses text that does not parse as TOML", () => {
    expect(withUpdatesCheck("[updates\ncheck = ", false)).toBeNull();
  });

  test("refuses when a look-alike line sits inside a multi-line string", () => {
    // Rewriting the line inside the string would corrupt someone's value while the
    // real setting stayed put.
    const original = '[opencode]\nplans_dir = """\n[updates]\ncheck = true\n"""\n';
    expect(withUpdatesCheck(original, false)).toBeNull();
  });
});

describe("the config writer", () => {
  const read = (at: string) => readFile(at, "utf-8");

  test("creates an absent file and its parent directory", async () => {
    const nested = join(dir, "deeper", "config.toml");
    expect(await createConfigWriter(nested).setUpdatesCheck(false)).toBe(true);
    expect(await read(nested)).toBe("[updates]\ncheck = false\n");
  });

  test("keeps an existing file's mode", async () => {
    await writeFile(file, '[logging]\nlevel = "warn"\n', { mode: 0o600 });
    chmodSync(file, 0o640);
    expect(await createConfigWriter(file).setUpdatesCheck(false)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o640);
  });

  test("a refused edit answers false and leaves the file byte-identical", async () => {
    const original = "updates.check = true\n";
    await writeFile(file, original);
    expect(await createConfigWriter(file).setUpdatesCheck(false)).toBe(false);
    expect(await read(file)).toBe(original);
  });

  test("queued writes land in order, so the last one wins", async () => {
    const writer = createConfigWriter(file);
    // Issued together rather than awaited in turn: a bare read-modify-write would let
    // the second read the pre-write file.
    await Promise.all([writer.setUpdatesCheck(false), writer.setUpdatesCheck(true)]);
    expect(await read(file)).toBe("[updates]\ncheck = true\n");
  });
});
