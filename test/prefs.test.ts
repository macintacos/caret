import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readApproveMode, writeApproveMode } from "../src/prefs.ts";
import { recordingLog } from "./support/recording-log.ts";

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-prefs-"));
  file = join(dir, "prefs.json");
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("write then read round-trips each approve mode", async () => {
  for (const mode of ["default", "acceptEdits", "auto"] as const) {
    await writeApproveMode(mode, file);
    expect(await readApproveMode(file)).toBe(mode);
  }
});

test("read of a missing file falls back to default", async () => {
  expect(await readApproveMode(file)).toBe("default");
});

test("read of a corrupt file falls back to default", async () => {
  await Bun.write(file, "{ not valid json");
  expect(await readApproveMode(file)).toBe("default");
});

test("read of an unrecognized stored value falls back to default", async () => {
  await Bun.write(file, JSON.stringify({ approveMode: "turbo" }));
  expect(await readApproveMode(file)).toBe("default");
});

test("writing an invalid mode is a no-op (no file created)", async () => {
  await writeApproveMode("bogus" as never, file);
  expect(await readApproveMode(file)).toBe("default");
  // The guard short-circuits before any write, so the file never appears.
  await expect(readFile(file, "utf-8")).rejects.toThrow();
});

// ---- instrumentation (EXC-444) ----

test("a missing prefs file logs the normal-first-run message at debug", async () => {
  // ENOENT is the expected state before any approve has been remembered (and
  // on every `mise run dev`, which wipes the state dir) — the record must not
  // read like a failure.
  const { recs, log } = recordingLog();
  await readApproveMode(file, log);
  expect(recs).toEqual([
    {
      level: "debug",
      step: "prefs",
      msg: "no prefs file; using default approve mode",
      extra: undefined,
    },
  ]);
});

test("a corrupt prefs file logs the unreadable message at debug", async () => {
  await Bun.write(file, "{ not valid json");
  const { recs, log } = recordingLog();
  await readApproveMode(file, log);
  expect(recs).toEqual([
    {
      level: "debug",
      step: "prefs",
      msg: "prefs unreadable; using default approve mode",
      extra: undefined,
    },
  ]);
});

test("an unrecognized stored value is logged at debug", async () => {
  await Bun.write(file, JSON.stringify({ approveMode: "turbo" }));
  const { recs, log } = recordingLog();
  await readApproveMode(file, log);
  expect(recs).toEqual([
    {
      level: "debug",
      step: "prefs",
      msg: "unrecognized approve mode; using default",
      extra: undefined,
    },
  ]);
});

test("writing an invalid mode is logged at warn", async () => {
  const { recs, log } = recordingLog();
  await writeApproveMode("bogus" as never, file, log);
  expect(recs).toEqual([
    { level: "warn", step: "prefs", msg: "ignoring invalid approve mode", extra: undefined },
  ]);
});

test("a successful write is logged at debug with the mode", async () => {
  const { recs, log } = recordingLog();
  await writeApproveMode("acceptEdits", file, log);
  expect(recs).toEqual([
    { level: "debug", step: "prefs", msg: "approve mode saved: acceptEdits", extra: undefined },
  ]);
});
