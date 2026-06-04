import { afterEach, beforeEach, expect, test } from "bun:test";
import { unlinkSync, utimesSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSettings,
  DEFAULT_PORT,
  DEFAULTS,
  getPort,
  heartbeatMs,
  idleMs,
  invalidEnvVars,
  loadSettings,
  reviewTimeoutMs,
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
  expect(loadSettings(file)).toEqual({ ...DEFAULTS, logging: { level: "warn", redact: true } });
});

test("an absent file yields all defaults with no error", () => {
  expect(loadSettings(file)).toEqual(DEFAULTS);
  expect(DEFAULTS).toEqual({
    logging: { level: "info", redact: false },
    daemon: { port: 42718, idle_ms: 60_000, heartbeat_ms: 8_000 },
    review: { timeout_s: 3600 },
  });
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
  expect(loadSettings(file)).toEqual({ ...DEFAULTS, logging: { level: "debug", redact: false } });
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

test("DEFAULTS is frozen, nested tables included", () => {
  expect(Object.isFrozen(DEFAULTS)).toBe(true);
  expect(Object.isFrozen(DEFAULTS.logging)).toBe(true);
  expect(Object.isFrozen(DEFAULTS.daemon)).toBe(true);
  expect(Object.isFrozen(DEFAULTS.review)).toBe(true);
});

test("a parsed file result is frozen, nested tables included", async () => {
  await Bun.write(file, '[logging]\nlevel = "warn"\n');
  const s = loadSettings(file);
  expect(Object.isFrozen(s)).toBe(true);
  expect(Object.isFrozen(s.logging)).toBe(true);
  expect(Object.isFrozen(s.daemon)).toBe(true);
  expect(Object.isFrozen(s.review)).toBe(true);
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

// --- EXC-430: env-var tunables under the config schema ---

/** Run `fn` with the given CARET_* values (undefined deletes), restoring after. */
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

/** Baseline for accessor tests: no CARET_* var set, whatever the host machine exports. */
const NO_CARET: Record<string, string | undefined> = {
  CARET_PORT: undefined,
  CARET_TIMEOUT: undefined,
  CARET_IDLE_MS: undefined,
  CARET_HEARTBEAT_MS: undefined,
};

test("a config file sets all four tunables (file > default)", async () => {
  await Bun.write(
    file,
    "[daemon]\nport = 5000\nidle_ms = 0\nheartbeat_ms = 250\n\n[review]\ntimeout_s = 120\n",
  );
  const s = loadSettings(file);
  withEnv(NO_CARET, () => {
    expect(getPort(s)).toBe(5000);
    expect(idleMs(s)).toBe(0);
    expect(heartbeatMs(s)).toBe(250);
    expect(reviewTimeoutMs(s)).toBe(120_000); // file seconds → ms, converted once
  });
});

test("accessors yield the schema defaults with no env and no file", () => {
  withEnv(NO_CARET, () => {
    expect(getPort(DEFAULTS)).toBe(DEFAULT_PORT);
    expect(idleMs(DEFAULTS)).toBe(60_000);
    expect(heartbeatMs(DEFAULTS)).toBe(8_000);
    expect(reviewTimeoutMs(DEFAULTS)).toBe(3_600_000);
  });
});

test("an env var shadows a config-file value (env > file)", async () => {
  await Bun.write(
    file,
    "[daemon]\nport = 5000\nidle_ms = 1111\nheartbeat_ms = 250\n\n[review]\ntimeout_s = 120\n",
  );
  const s = loadSettings(file);
  withEnv(
    {
      CARET_PORT: "6000",
      CARET_TIMEOUT: "0.5",
      CARET_IDLE_MS: "2222",
      CARET_HEARTBEAT_MS: "333",
    },
    () => {
      expect(getPort(s)).toBe(6000);
      expect(reviewTimeoutMs(s)).toBe(500); // env seconds → ms, same single conversion
      expect(idleMs(s)).toBe(2222);
      expect(heartbeatMs(s)).toBe(333);
    },
  );
});

test("a malformed env var falls through to the file value, then the default", async () => {
  await Bun.write(
    file,
    "[daemon]\nport = 5000\nidle_ms = 1111\nheartbeat_ms = 250\n\n[review]\ntimeout_s = 120\n",
  );
  const s = loadSettings(file);
  // One unusable value per var, including the newly-bounded timeout.
  withEnv(
    { CARET_PORT: "nope", CARET_TIMEOUT: "3900", CARET_IDLE_MS: "1.5", CARET_HEARTBEAT_MS: "0" },
    () => {
      expect(getPort(s)).toBe(5000); // → file
      expect(reviewTimeoutMs(s)).toBe(120_000);
      expect(idleMs(s)).toBe(1111);
      expect(heartbeatMs(s)).toBe(250);
      expect(getPort(DEFAULTS)).toBe(DEFAULT_PORT); // → default when the file has no value
      expect(reviewTimeoutMs(DEFAULTS)).toBe(3_600_000);
      expect(idleMs(DEFAULTS)).toBe(60_000);
      expect(heartbeatMs(DEFAULTS)).toBe(8_000);
    },
  );
});

test("an empty or whitespace env var counts as unset, never as 0", async () => {
  await Bun.write(file, "[daemon]\nidle_ms = 1234\n");
  const s = loadSettings(file);
  for (const blank of ["", "   "]) {
    withEnv(
      { CARET_PORT: blank, CARET_TIMEOUT: blank, CARET_IDLE_MS: blank, CARET_HEARTBEAT_MS: blank },
      () => {
        expect(idleMs(s)).toBe(1234);
        expect(idleMs(DEFAULTS)).toBe(60_000);
        expect(getPort(DEFAULTS)).toBe(DEFAULT_PORT);
        expect(reviewTimeoutMs(DEFAULTS)).toBe(3_600_000);
        expect(heartbeatMs(DEFAULTS)).toBe(8_000);
      },
    );
  }
});

test("a file timeout_s at or above the 3900s hook budget reverts the whole file", async () => {
  await Bun.write(file, '[logging]\nlevel = "warn"\n\n[review]\ntimeout_s = 3900\n');
  // Whole-file granularity: the valid logging.level reverts along with the bad key.
  expect(loadSettings(file)).toEqual(DEFAULTS);
});

test("an out-of-bounds file value reverts the whole file for the other tunables too", async () => {
  await Bun.write(file, "[daemon]\nport = -1\n");
  expect(loadSettings(file)).toEqual(DEFAULTS);
});

test("invalidEnvVars flags an out-of-budget CARET_TIMEOUT (in-schema 3900s bound)", () => {
  for (const bad of ["3900", "99999"]) {
    withEnv({ ...NO_CARET, CARET_TIMEOUT: bad }, () => {
      expect(invalidEnvVars()).toEqual(["CARET_TIMEOUT"]);
    });
  }
  withEnv({ ...NO_CARET, CARET_TIMEOUT: "3899" }, () => {
    expect(invalidEnvVars()).toEqual([]);
  });
});

test("invalidEnvVars names each set-but-unusable CARET_* var, in declaration order", () => {
  withEnv(
    { CARET_PORT: "nope", CARET_TIMEOUT: "-5", CARET_IDLE_MS: "1.5", CARET_HEARTBEAT_MS: "0" },
    () => {
      expect(invalidEnvVars()).toEqual([
        "CARET_PORT",
        "CARET_TIMEOUT",
        "CARET_IDLE_MS",
        "CARET_HEARTBEAT_MS",
      ]);
    },
  );
});

test("invalidEnvVars is empty when the set values are usable", () => {
  withEnv(
    { CARET_PORT: "42718", CARET_TIMEOUT: "120", CARET_IDLE_MS: "0", CARET_HEARTBEAT_MS: "250" },
    () => {
      expect(invalidEnvVars()).toEqual([]);
    },
  );
});

test("invalidEnvVars treats empty and whitespace values as unset", () => {
  withEnv({ ...NO_CARET, CARET_PORT: "", CARET_IDLE_MS: "   " }, () => {
    expect(invalidEnvVars()).toEqual([]);
  });
});

test("watchSettings reports numeric tunable changes", async () => {
  await Bun.write(file, "[daemon]\nport = 42718\n");
  const fired: string[][] = [];
  const svc = watchSettings(createSettings(file), (changes) => fired.push(changes));
  svc.current();
  await Bun.write(file, "[daemon]\nport = 5000\n");
  svc.current();
  expect(fired).toEqual([["daemon.port: 42718 → 5000"]]);
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
