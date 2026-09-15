import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPrefsWriter, readUpdatesCheck } from "@/config/prefs.ts";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-prefs-"));
  file = join(dir, "prefs.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// ---- the update-check opt-out (EXC-1205) ----
//
// `updates.check` is a kill switch, so only an explicit `false` turns the daemon's
// daily check off. Every other reading — no file, no key, junk — leaves it on, which
// is what keeps a corrupt prefs.json from silently disabling the feature.

test("an absent prefs file leaves the update check on", async () => {
  expect(await readUpdatesCheck(file)).toBe(true);
});

test("a prefs file without an updates key leaves the update check on", async () => {
  await Bun.write(file, JSON.stringify({ approveMode: "default" }));
  expect(await readUpdatesCheck(file)).toBe(true);
});

test("only an explicit false turns the update check off", async () => {
  await Bun.write(file, JSON.stringify({ updates: { check: false } }));
  expect(await readUpdatesCheck(file)).toBe(false);
});

test("an explicit true leaves the update check on", async () => {
  await Bun.write(file, JSON.stringify({ updates: { check: true } }));
  expect(await readUpdatesCheck(file)).toBe(true);
});

test("a junk updates value leaves the update check on rather than off", async () => {
  for (const updates of [{ check: "no" }, { check: 0 }, "off", null, []]) {
    await Bun.write(file, JSON.stringify({ updates }));
    expect(await readUpdatesCheck(file)).toBe(true);
  }
  await Bun.write(file, "{ not valid json");
  expect(await readUpdatesCheck(file)).toBe(true);
});

// ---- serialized writes (EXC-1206) ----
//
// The read-modify-write is serialized through one PrefsWriter rather than raced.
// These cases are what the chain buys: remove it and each merge reads the pre-write
// file, so the later write drops the earlier one's key.

const readPrefs = async (at: string): Promise<unknown> => JSON.parse(await readFile(at, "utf-8"));

test("merges issued together over one writer all land", async () => {
  const writer = createPrefsWriter(file);
  // Deliberately not awaited in turn: the second merge is issued while the first
  // is still in flight, which is the interleave a bare read-modify-write loses.
  await Promise.all([writer.merge({ updates: { check: false } }), writer.merge({ theme: "dark" })]);
  expect(await readPrefs(file)).toEqual({ updates: { check: false }, theme: "dark" });
});

test("a failed merge rejects to its caller and leaves the writer usable", async () => {
  // prefs.json nested under a regular FILE, so ensureStateDir's mkdir throws.
  const blocker = join(dir, "blocked");
  await Bun.write(blocker, "i am a file, not a directory");
  const nested = join(blocker, "prefs.json");
  const writer = createPrefsWriter(nested);
  await expect(writer.merge({ theme: "dark" })).rejects.toThrow();
  // Clear the blocker: the next merge on the SAME writer must still run, which it
  // only does if the stored tail was caught rather than left rejected.
  await rm(blocker);
  await writer.merge({ theme: "dark" });
  expect(await readPrefs(nested)).toEqual({ theme: "dark" });
});
