import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recordingLog } from "@test/support/recording-log.ts";
import { createConfigWriter } from "@/config/config-write.ts";
import { migratePrefsFile } from "@/config/prefs.ts";

// EXC-1354. prefs.json is retired: `updates.check` lives in config.toml and the
// remembered approve mode lives in the browser. All that is left of the old file is
// this one-time migration, so a reviewer who turned the daily update check off does
// not silently get it turned back on.

let dir: string;
let prefs: string;
let config: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-prefs-"));
  prefs = join(dir, "prefs.json");
  config = join(dir, "config.toml");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const migrate = (log = recordingLog().log) =>
  migratePrefsFile({ prefs, config, writer: createConfigWriter(config), log });

test("an absent prefs file is a no-op", async () => {
  await migrate();
  expect(existsSync(config)).toBe(false);
});

test("an opt-out moves into config.toml and the prefs file goes", async () => {
  await writeFile(prefs, JSON.stringify({ updates: { check: false } }));
  const { recs, log } = recordingLog();
  await migrate(log);
  expect(await readFile(config, "utf-8")).toContain("check = false");
  expect(existsSync(prefs)).toBe(false);
  // The watcher's baseline predates the write, so without this record the only trace is
  // a `settings changed` line that reads as the reviewer's own edit.
  expect(recs).toContainEqual(expect.objectContaining({ level: "info", step: "settings" }));
});

test("a prefs file carrying only the approve mode is dropped, writing no config", async () => {
  // The remembered variant is a browser pref now, and a daemon cannot write browser
  // storage — so it resets once rather than migrating.
  await writeFile(prefs, JSON.stringify({ approveMode: "yolo" }));
  const { recs, log } = recordingLog();
  await migrate(log);
  expect(existsSync(prefs)).toBe(false);
  expect(existsSync(config)).toBe(false);
  // Nothing was written, so nothing belongs on the timeline.
  expect(recs).toEqual([]);
});

test("a prefs file that cannot be read is kept, so the next boot retries", async () => {
  // A directory in its place is the cheap stand-in for any non-ENOENT read failure: it
  // may still be hiding an opt-out, so deleting it would delete the answer.
  await mkdir(prefs);
  const { recs, log } = recordingLog();
  await migrate(log);
  expect(existsSync(prefs)).toBe(true);
  expect(existsSync(config)).toBe(false);
  expect(recs).toContainEqual(expect.objectContaining({ level: "warn", step: "settings" }));
});

test("a corrupt prefs file is dropped", async () => {
  await writeFile(prefs, "{ not valid json");
  await migrate();
  expect(existsSync(prefs)).toBe(false);
});

test("a refused config edit keeps the prefs file so the next boot retries", async () => {
  await writeFile(prefs, JSON.stringify({ updates: { check: false } }));
  // A dotted key is one of the shapes the config rewrite refuses.
  await writeFile(config, "updates.check = true\n");
  const { recs, log } = recordingLog();
  await migrate(log);
  expect(existsSync(prefs)).toBe(true);
  expect(await readFile(config, "utf-8")).toBe("updates.check = true\n");
  // daemon.log is the only channel this failure has, so the record must carry the file
  // to edit, the spelling that would land, and why the rewrite was refused.
  expect(recs).toContainEqual(
    expect.objectContaining({
      level: "warn",
      step: "settings",
      extra: expect.objectContaining({
        config,
        reason: "unverifiable",
        fix: expect.stringContaining("[updates]"),
      }),
    }),
  );
});
