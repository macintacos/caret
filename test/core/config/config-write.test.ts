import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type BooleanKey, createConfigWriter, withBoolean } from "@/config/config-write.ts";

// Each Settings toggle backed by config.toml edits one key's line of the user's file,
// so the edit is a text rewrite rather than a parse-and-stringify: smol-toml's
// stringify would drop their comments and formatting. What keeps that safe is the
// parse-verified net — a rewrite that would change anything but the key under test
// refuses, leaving the file untouched, and the toggle tells the user to edit by hand.

const UPDATES_CHECK: BooleanKey = { table: "updates", key: "check" };
const REVIEW_BAND: BooleanKey = { table: "review", key: "band" };

// root reads and writes straight through the mode bits the refusal proofs below rely on.
const asRoot = process.getuid?.() === 0;

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-config-write-"));
  file = join(dir, "config.toml");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("withBoolean", () => {
  test("writes the table into empty text with no leading blank line", () => {
    expect(withBoolean("", UPDATES_CHECK, false)).toBe("[updates]\ncheck = false\n");
  });

  test("appends the table to a file that has none, keeping the original bytes as a prefix", () => {
    const original = '# my config\n[logging]\nlevel = "debug"\n';
    const out = withBoolean(original, UPDATES_CHECK, false);
    expect(out?.startsWith(original)).toBe(true);
    expect(out).toContain("[updates]\ncheck = false\n");
  });

  test("swaps the value in place and keeps the trailing comment", () => {
    const out = withBoolean("[updates]\ncheck = true  # why\n", UPDATES_CHECK, false);
    expect(out).toBe("[updates]\ncheck = false  # why\n");
  });

  test("inserts the key right after a header that lacks it", () => {
    const out = withBoolean('[updates]\n[logging]\nlevel = "warn"\n', UPDATES_CHECK, false);
    expect(out).toBe('[updates]\ncheck = false\n[logging]\nlevel = "warn"\n');
  });

  test("keeps the CRLF endings when it swaps the value in place", () => {
    expect(withBoolean("[updates]\r\ncheck = true\r\n", UPDATES_CHECK, false)).toBe(
      "[updates]\r\ncheck = false\r\n",
    );
  });

  test("keeps the CRLF endings when it inserts the key", () => {
    expect(withBoolean("[updates]\r\nother = 1\r\n", UPDATES_CHECK, false)).toBe(
      "[updates]\r\ncheck = false\r\nother = 1\r\n",
    );
  });

  test("returns the text unchanged when the value is already set", () => {
    const original = "[updates]\ncheck = false\n";
    expect(withBoolean(original, UPDATES_CHECK, false)).toBe(original);
  });

  test("refuses a dotted key rather than leaving two spellings behind", () => {
    expect(withBoolean("updates.check = true\n", UPDATES_CHECK, false)).toBeNull();
  });

  test("refuses an inline table", () => {
    expect(withBoolean("updates = { check = true }\n", UPDATES_CHECK, false)).toBeNull();
  });

  test("refuses text that does not parse as TOML", () => {
    expect(withBoolean("[updates\ncheck = ", UPDATES_CHECK, false)).toBeNull();
  });

  test("refuses when a look-alike line sits inside a multi-line string", () => {
    // Rewriting the line inside the string would corrupt someone's value while the
    // real setting stayed put.
    const original = '[opencode]\nplans_dir = """\n[updates]\ncheck = true\n"""\n';
    expect(withBoolean(original, UPDATES_CHECK, false)).toBeNull();
  });

  test("appends a [review] table to a file that has none", () => {
    expect(withBoolean("[updates]\ncheck = true\n", REVIEW_BAND, false)).toBe(
      "[updates]\ncheck = true\n\n[review]\nband = false\n",
    );
  });

  test("inserts band under a [review] table that lacks it", () => {
    expect(withBoolean("[review]\n[updates]\n", REVIEW_BAND, false)).toBe(
      "[review]\nband = false\n[updates]\n",
    );
  });

  test("flips band in place", () => {
    expect(withBoolean("[review]\nband = true\n", REVIEW_BAND, false)).toBe(
      "[review]\nband = false\n",
    );
  });

  test("leaves a [review] timeout_s neighbour intact", () => {
    expect(withBoolean("[review]\ntimeout_s = 30\nband = true\n", REVIEW_BAND, false)).toBe(
      "[review]\ntimeout_s = 30\nband = false\n",
    );
  });
});

describe("the config writer's review band", () => {
  test("writes [review] band", async () => {
    expect(await createConfigWriter(file).setReviewBand(false)).toEqual({ ok: true });
    expect(await readFile(file, "utf-8")).toBe("[review]\nband = false\n");
  });
});

describe("the config writer", () => {
  const read = (at: string) => readFile(at, "utf-8");

  test("creates an absent file and its parent directory", async () => {
    const nested = join(dir, "deeper", "config.toml");
    expect(await createConfigWriter(nested).setUpdatesCheck(false)).toEqual({ ok: true });
    expect(await read(nested)).toBe("[updates]\ncheck = false\n");
  });

  test("keeps an existing file's mode", async () => {
    await writeFile(file, '[logging]\nlevel = "warn"\n', { mode: 0o600 });
    chmodSync(file, 0o640);
    expect(await createConfigWriter(file).setUpdatesCheck(false)).toEqual({ ok: true });
    expect(statSync(file).mode & 0o777).toBe(0o640);
  });

  test("an unverifiable edit refuses and leaves the file byte-identical", async () => {
    const original = "updates.check = true\n";
    await writeFile(file, original);
    expect(await createConfigWriter(file).setUpdatesCheck(false)).toEqual({
      ok: false,
      reason: "unverifiable",
    });
    expect(await read(file)).toBe(original);
  });

  test.skipIf(asRoot)("an unreadable file refuses rather than being overwritten", async () => {
    // The refusal net compares two parses of the file, so a read that silently
    // yielded "" would compare against nothing and replace the whole file.
    const original = '# my config\n[logging]\nlevel = "debug"\n';
    await writeFile(file, original);
    chmodSync(file, 0o000);
    try {
      expect(await createConfigWriter(file).setUpdatesCheck(false)).toEqual({
        ok: false,
        reason: "unreadable",
      });
    } finally {
      chmodSync(file, 0o600);
    }
    expect(await read(file)).toBe(original);
  });

  test.skipIf(asRoot)("a failed write refuses rather than throwing", async () => {
    // Both callers treat a refusal as recoverable; a throw escapes the boot
    // migration and takes the daemon down with it.
    const original = "[updates]\ncheck = true\n";
    await writeFile(file, original);
    chmodSync(dir, 0o500);
    try {
      expect(await createConfigWriter(file).setUpdatesCheck(false)).toEqual({
        ok: false,
        reason: "unwritable",
      });
    } finally {
      chmodSync(dir, 0o700);
    }
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
