import { afterEach, beforeEach, expect, test } from "bun:test";
import { unlinkSync, utimesSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSettings,
  DEFAULTS,
  loadSettings,
  type Settings,
  settings,
  watchSettings,
} from "../src/settings.ts";

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
  // `debug` is no longer a known key (EXC-400): zod strips it, proving unknown-key handling.
  await Bun.write(file, '[logging]\nlevel = "warn"\ndebug = true\nredact = true\n');
  expect(loadSettings(file)).toEqual({ logging: { level: "warn", redact: true } });
});

test("an absent file yields all defaults with no error", () => {
  expect(loadSettings(file)).toEqual(DEFAULTS);
  expect(DEFAULTS).toEqual({ logging: { level: "info", redact: false } });
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
  expect(loadSettings(file)).toEqual({ logging: { level: "debug", redact: false } });
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

test("DEFAULTS is frozen, nested logging included", () => {
  expect(Object.isFrozen(DEFAULTS)).toBe(true);
  expect(Object.isFrozen(DEFAULTS.logging)).toBe(true);
});

test("a parsed file result is frozen, nested logging included", async () => {
  await Bun.write(file, '[logging]\nlevel = "warn"\n');
  const s = loadSettings(file);
  expect(Object.isFrozen(s)).toBe(true);
  expect(Object.isFrozen(s.logging)).toBe(true);
});

test("current() yields a frozen result", async () => {
  await Bun.write(file, '[logging]\nlevel = "warn"\n');
  const s = createSettings(file).current();
  expect(Object.isFrozen(s)).toBe(true);
  expect(Object.isFrozen(s.logging)).toBe(true);
});

test("mutating a frozen result throws (strict mode)", async () => {
  await Bun.write(file, '[logging]\nlevel = "warn"\n');
  const s = loadSettings(file);
  expect(() => {
    (s.logging as { level: string }).level = "debug";
  }).toThrow(TypeError);
});

// --- watchSettings (EXC-399: hot-reload change records) ---

test("watchSettings reports each changed key with old and new values", async () => {
  await Bun.write(file, '[logging]\nlevel = "info"\n');
  const fired: Array<{ changes: string[]; next: Settings }> = [];
  const svc = watchSettings(createSettings(file), (changes, next) =>
    fired.push({ changes, next }),
  );
  svc.current(); // first read seeds the baseline — must not fire
  await Bun.write(file, '[logging]\nlevel = "debug"\nredact = true\n');
  const next = svc.current();
  expect(fired.length).toBe(1);
  expect(fired[0].changes).toEqual([
    "logging.level: info → debug",
    "logging.redact: false → true",
  ]);
  expect(fired[0].next).toBe(next);
});

test("watchSettings does not fire when a rewrite leaves values unchanged", async () => {
  await Bun.write(file, '[logging]\nlevel = "warn"\n');
  let fires = 0;
  const svc = watchSettings(createSettings(file), () => fires++);
  svc.current();
  // Re-write the same content: new mtime, new parsed object, equal values.
  await Bun.write(file, '[logging]\nlevel = "warn"\n');
  svc.current();
  expect(fires).toBe(0);
});

test("watchSettings does not fire when an invalid rewrite keeps last-known-good", async () => {
  await Bun.write(file, '[logging]\nlevel = "debug"\n');
  let fires = 0;
  const svc = watchSettings(createSettings(file), () => fires++);
  svc.current();
  await Bun.write(file, "[logging\nlevel ="); // malformed: lastGood retained
  expect(svc.current().logging.level).toBe("debug");
  expect(fires).toBe(0);
});

test("watchSettings tolerates a re-entrant current() from inside onChange", async () => {
  await Bun.write(file, '[logging]\nredact = false\n');
  let fires = 0;
  const svc: { current(): Settings } = watchSettings(createSettings(file), () => {
    fires++;
    svc.current(); // a logging callback re-enters (emit → level thunk → current)
  });
  svc.current();
  await Bun.write(file, '[logging]\nredact = true\n');
  svc.current();
  expect(fires).toBe(1); // the re-entrant read sees no further change
});
