import { afterEach, beforeEach, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recordingLog } from "@test/support/recording-log.ts";
import {
  type ApproveModeSet,
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
    await writeApproveMode(mode, file, undefined, SET);
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
  await writeApproveMode("bogus", file, undefined, SET);
  expect(await readApproveMode(file, undefined, SET)).toBe("default");
  // The guard short-circuits before any write, so the file never appears.
  await expect(readFile(file, "utf-8")).rejects.toThrow();
});

test("a written prefs file and its dir carry private modes (0600 / 0700)", async () => {
  // EXC-539: prefs.json shares the state dir with plan bodies; both stay private.
  await writeApproveMode("acceptEdits", file, undefined, SET);
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(statSync(dir).mode & 0o777).toBe(0o700);
});

test("defaults to a lone 'default' set when no recognized set is supplied", async () => {
  // With no set, only "default" is recognized and is the fallback — the bare
  // posture a daemon takes when its adapter declares no variants.
  await writeApproveMode("default", file);
  expect(await readApproveMode(file)).toBe("default");
  await writeApproveMode("acceptEdits", file);
  expect(await readApproveMode(file)).toBe("default");
});

// ---- instrumentation (EXC-444) ----

test("a missing prefs file logs the normal-first-run message at debug", async () => {
  // ENOENT is the expected state before any approve has been remembered (and
  // on every `mise run dev`, which wipes the state dir) — the record must not
  // read like a failure. Stable contract: exactly one calm debug "prefs"
  // record, never a warn/error; the prose itself is free to be reworded.
  const { recs, log } = recordingLog();
  await readApproveMode(file, log);
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ level: "debug", step: "prefs" });
});

test("a corrupt prefs file logs the unreadable message at debug", async () => {
  await Bun.write(file, "{ not valid json");
  const { recs, log } = recordingLog();
  await readApproveMode(file, log);
  // Stable contract: a corrupt prefs read degrades to a calm debug "prefs"
  // event, never a warn/error.
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ level: "debug", step: "prefs" });
});

test("an unrecognized stored value is logged at debug", async () => {
  await Bun.write(file, JSON.stringify({ approveMode: "turbo" }));
  const { recs, log } = recordingLog();
  await readApproveMode(file, log);
  // Stable contract: an out-of-set stored value is a calm debug "prefs" event.
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ level: "debug", step: "prefs" });
});

test("writing an invalid mode is logged at warn", async () => {
  const { recs, log } = recordingLog();
  await writeApproveMode("bogus", file, log);
  // Stable contract: an invalid write is a warn-level "prefs" event — the
  // level (warn, not debug) is the behavior under test, not the exact prose.
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ level: "warn", step: "prefs" });
});

test("a successful write is logged at debug with the mode", async () => {
  const { recs, log } = recordingLog();
  await writeApproveMode("acceptEdits", file, log, SET);
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
