import { afterEach, beforeEach, expect, test } from "bun:test";
import { unlinkSync, utimesSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSettings, DEFAULTS, loadSettings, settings } from "../src/settings.ts";

let dir: string;
let file: string;
let savedXdgState: string | undefined;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-settings-"));
  file = join(dir, "config.toml");
  // Route logError output into the tmpdir so log assertions are per-test.
  savedXdgState = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(dir, "state");
});
afterEach(async () => {
  if (savedXdgState === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedXdgState;
  await rm(dir, { recursive: true, force: true });
});

test("a valid config.toml is parsed and validated", async () => {
  await Bun.write(file, '[logging]\nlevel = "warn"\ndebug = true\nredact = false\n');
  expect(loadSettings(file)).toEqual({ logging: { level: "warn", debug: true, redact: false } });
});

test("an absent file yields all defaults with no error", () => {
  expect(loadSettings(file)).toEqual(DEFAULTS);
  expect(DEFAULTS).toEqual({ logging: { level: "info", debug: false, redact: true } });
});

test("malformed TOML falls back to defaults without throwing", async () => {
  await Bun.write(file, "[logging\nlevel =");
  expect(loadSettings(file)).toEqual(DEFAULTS);
});

test("a partial mid-write file falls back to defaults without throwing", async () => {
  await Bun.write(file, '[logging]\nlevel = "deb');
  expect(loadSettings(file)).toEqual(DEFAULTS);
});

test("an invalid value falls back to defaults and logs the key path, never the value", async () => {
  await Bun.write(file, '[logging]\nlevel = "SENTINEL_NOT_A_LEVEL"\n');
  expect(loadSettings(file)).toEqual(DEFAULTS);
  const log = await readFile(join(dir, "state", "caret", "caret.log"), "utf-8");
  expect(log).toContain("logging.level");
  expect(log).not.toContain("SENTINEL_NOT_A_LEVEL");
});

test("unknown keys are ignored at the top level and inside tables", async () => {
  await Bun.write(file, '[telemetry]\nenabled = true\n\n[logging]\nlevel = "debug"\nfuture_flag = 3\n');
  expect(loadSettings(file)).toEqual({ logging: { level: "debug", debug: false, redact: true } });
});

test("current() yields all defaults when the file never existed", () => {
  expect(createSettings(file).current()).toEqual(DEFAULTS);
});

test("current() re-reads when the file's mtime changes", async () => {
  await Bun.write(file, '[logging]\nlevel = "warn"\n');
  utimesSync(file, new Date(1_000_000_000), new Date(1_000_000_000));
  const svc = createSettings(file);
  expect(svc.current().logging.level).toBe("warn");
  await Bun.write(file, '[logging]\nlevel = "error"\n');
  utimesSync(file, new Date(2_000_000_000), new Date(2_000_000_000));
  expect(svc.current().logging.level).toBe("error");
});

test("current() serves the cached parse while mtime and size are unchanged", async () => {
  await Bun.write(file, '[logging]\nlevel = "warn"\n');
  utimesSync(file, new Date(1_000_000_000), new Date(1_000_000_000));
  const svc = createSettings(file);
  expect(svc.current().logging.level).toBe("warn");
  // Same byte length ("info" == "warn"), same mtime reapplied: the stat gate
  // must short-circuit without re-reading.
  await Bun.write(file, '[logging]\nlevel = "info"\n');
  utimesSync(file, new Date(1_000_000_000), new Date(1_000_000_000));
  expect(svc.current().logging.level).toBe("warn");
});

test("a failed re-parse keeps serving last-known-good", async () => {
  await Bun.write(file, '[logging]\nlevel = "warn"\n');
  utimesSync(file, new Date(1_000_000_000), new Date(1_000_000_000));
  const svc = createSettings(file);
  expect(svc.current().logging.level).toBe("warn");
  await Bun.write(file, "[logging\nlevel =");
  utimesSync(file, new Date(2_000_000_000), new Date(2_000_000_000));
  expect(svc.current().logging.level).toBe("warn");
});

test("a deleted file keeps serving last-known-good", async () => {
  await Bun.write(file, '[logging]\nlevel = "warn"\n');
  const svc = createSettings(file);
  expect(svc.current().logging.level).toBe("warn");
  unlinkSync(file);
  expect(svc.current().logging.level).toBe("warn");
});

test("settings() returns the same lazy singleton", () => {
  expect(settings()).toBe(settings());
});
