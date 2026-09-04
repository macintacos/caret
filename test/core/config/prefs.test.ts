import { afterEach, beforeEach, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type RecordedEmit, recordingLog } from "@test/support/recording-log.ts";
import {
  type ApproveModeSet,
  createPrefsWriter,
  readApproveMode,
  readUpdatesCheck,
  writeApproveMode,
} from "@/config/prefs.ts";

let dir: string;
let file: string;

// A multi-variant recognized set (the daemon derives one of this shape from the
// active adapter's declared variants). The default falls back to the first id.
const SET: ApproveModeSet = {
  valid: ["default", "acceptEdits", "auto"],
  fallback: "default",
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-prefs-"));
  file = join(dir, "prefs.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("write then read round-trips each recognized approve variant", async () => {
  for (const mode of ["default", "acceptEdits", "auto"] as const) {
    await writeApproveMode(mode, createPrefsWriter(file), undefined, SET);
    expect(await readApproveMode(file, undefined, SET)).toBe(mode);
  }
});

test("read of a missing file falls back to the set default", async () => {
  expect(await readApproveMode(file, undefined, SET)).toBe("default");
});

test("read of a corrupt file falls back to the set default", async () => {
  await Bun.write(file, "{ not valid json");
  expect(await readApproveMode(file, undefined, SET)).toBe("default");
});

test("read of an id outside the declared set falls back to the default", async () => {
  await Bun.write(file, JSON.stringify({ approveMode: "turbo" }));
  expect(await readApproveMode(file, undefined, SET)).toBe("default");
});

test("writing an id outside the declared set is a no-op (no file created)", async () => {
  await writeApproveMode("bogus", createPrefsWriter(file), undefined, SET);
  expect(await readApproveMode(file, undefined, SET)).toBe("default");
  // The guard short-circuits before any write, so the file never appears.
  await expect(readFile(file, "utf-8")).rejects.toThrow();
});

test("a written prefs file and its dir carry private modes (0600 / 0700)", async () => {
  // EXC-539: prefs.json shares the state dir with plan bodies; both stay private.
  await writeApproveMode("acceptEdits", createPrefsWriter(file), undefined, SET);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(statSync(dir).mode & 0o777).toBe(0o700);
});

test("defaults to a lone 'default' set when no recognized set is supplied", async () => {
  // With no set, only "default" is recognized and is the fallback — the bare
  // posture a daemon takes when its adapter declares no variants.
  await writeApproveMode("default", createPrefsWriter(file));
  expect(await readApproveMode(file)).toBe("default");
  await writeApproveMode("acceptEdits", createPrefsWriter(file));
  expect(await readApproveMode(file)).toBe("default");
});

// ---- instrumentation (EXC-444) ----

/** Asserts a `recordingLog()` capture holds exactly one calm debug "prefs"
 * event — the stable contract every readApproveMode degrade-and-log path
 * shares; the human-readable prose is free to be reworded. */
function expectCalmDebugPrefsLog(recs: RecordedEmit[]): void {
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ level: "debug", step: "prefs" });
}

test("a missing prefs file logs the normal-first-run message at debug", async () => {
  // ENOENT is the expected state before any approve has been remembered (and
  // on every `mise run dev`, which wipes the state dir) — the record must not
  // read like a failure.
  const { recs, log } = recordingLog();
  await readApproveMode(file, log);
  expectCalmDebugPrefsLog(recs);
});

test("a corrupt prefs file logs the unreadable message at debug", async () => {
  await Bun.write(file, "{ not valid json");
  const { recs, log } = recordingLog();
  await readApproveMode(file, log);
  expectCalmDebugPrefsLog(recs);
});

test("an unrecognized stored value is logged at debug", async () => {
  await Bun.write(file, JSON.stringify({ approveMode: "turbo" }));
  const { recs, log } = recordingLog();
  await readApproveMode(file, log);
  expectCalmDebugPrefsLog(recs);
});

test("writing an invalid mode is logged at warn", async () => {
  const { recs, log } = recordingLog();
  await writeApproveMode("bogus", createPrefsWriter(file), log);
  // Stable contract: an invalid write is a warn-level "prefs" event — the
  // level (warn, not debug) is the behavior under test, not the exact prose.
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ level: "warn", step: "prefs" });
});

test("a successful write is logged at debug with the mode", async () => {
  const { recs, log } = recordingLog();
  await writeApproveMode("acceptEdits", createPrefsWriter(file), log, SET);
  // Stable contract: a debug-level "prefs" record naming the saved mode. The
  // mode (acceptEdits) is the load-bearing datum; match the prose loosely.
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ level: "debug", step: "prefs" });
  expect(recs[0]?.msg).toContain("acceptEdits");
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

test("saving an approve mode preserves the update-check opt-out", async () => {
  // The README tells users to hand-edit `updates.check` into this file, so a
  // whole-file write here would silently re-enable the daily check on their next
  // approval.
  await Bun.write(file, JSON.stringify({ updates: { check: false } }));
  await writeApproveMode("acceptEdits", createPrefsWriter(file), undefined, SET);
  expect(await readApproveMode(file, undefined, SET)).toBe("acceptEdits");
  expect(await readUpdatesCheck(file)).toBe(false);
});

// ---- serialized writes (EXC-1206) ----
//
// Two writers reach prefs.json — the resolve path's approve mode and the UI's
// POST /api/prefs — so the read-modify-write is serialized through one PrefsWriter
// rather than raced. These cases are what the chain buys: remove it and each merge
// reads the pre-write file, so the later write drops the earlier one's key.

test("merges issued together over one writer all land", async () => {
  const writer = createPrefsWriter(file);
  // Deliberately not awaited in turn: the second merge is issued while the first
  // is still in flight, which is the interleave a bare read-modify-write loses.
  await Promise.all([writer.merge({ approveMode: "auto" }), writer.merge({ theme: "dark" })]);
  expect(JSON.parse(await readFile(file, "utf-8"))).toEqual({
    approveMode: "auto",
    theme: "dark",
  });
});

test("an approve-mode save and an updates merge fired together both land", async () => {
  // The two real writers, racing over the shared writer the daemon builds once.
  const writer = createPrefsWriter(file);
  await Promise.all([
    writeApproveMode("auto", writer, undefined, SET),
    writer.merge({ updates: { check: false } }),
  ]);
  expect(await readApproveMode(file, undefined, SET)).toBe("auto");
  expect(await readUpdatesCheck(file)).toBe(false);
});

test("a failed merge rejects to its caller and leaves the writer usable", async () => {
  // prefs.json nested under a regular FILE, so ensureStateDir's mkdir throws.
  const blocker = join(dir, "blocked");
  await Bun.write(blocker, "i am a file, not a directory");
  const nested = join(blocker, "prefs.json");
  const writer = createPrefsWriter(nested);
  await expect(writer.merge({ approveMode: "auto" })).rejects.toThrow();
  // Clear the blocker: the next merge on the SAME writer must still run, which it
  // only does if the stored tail was caught rather than left rejected.
  await rm(blocker);
  await writer.merge({ approveMode: "auto" });
  expect(await readApproveMode(nested, undefined, SET)).toBe("auto");
});
