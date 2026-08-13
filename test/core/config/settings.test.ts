import { afterEach, beforeEach, expect, test } from "bun:test";
import { unlinkSync, utimesSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withEnv } from "@test/support/env.ts";
import {
  DEFAULT_LOG_KEEP,
  DEFAULT_LOG_MAX_SIZE,
  MAX_HEARTBEAT_MS,
  MIN_LOG_MAX_SIZE,
} from "@/config/constants.ts";
import {
  createSettings,
  DEFAULT_PORT,
  DEFAULTS,
  devPort,
  devSeeder,
  devStateDir,
  envOverrides,
  getPort,
  heartbeatMs,
  idleMs,
  invalidEnvVars,
  loadSettings,
  logKeep,
  logMaxSize,
  reviewTimeoutMs,
  type Settings,
  settings,
  watchSettings,
} from "@/config/settings.ts";

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
  expect(loadSettings(file)).toEqual({
    ...DEFAULTS,
    logging: { ...DEFAULTS.logging, level: "warn", redact: true },
  });
});

test("an absent file yields all defaults with no error", () => {
  expect(loadSettings(file)).toEqual(DEFAULTS);
  expect(DEFAULTS).toEqual({
    logging: {
      level: "info",
      redact: false,
      max_size: DEFAULT_LOG_MAX_SIZE,
      keep: DEFAULT_LOG_KEEP,
    },
    daemon: { port: 42718, idle_ms: 60_000, heartbeat_ms: 8_000 },
    review: { timeout_s: 3600 },
    dev: { notify: { enabled: false, interval_ms: 15_000, max_pending: 3 } },
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
  const log = await readFile(join(dir, "state", "caret", "logs", "caret.log"), "utf-8");
  expect(log).toContain("logging.level");
  expect(log).not.toContain("SENTINEL_NOT_A_LEVEL");
});

test("unknown keys are ignored at the top level and inside tables", async () => {
  await Bun.write(
    file,
    '[telemetry]\nenabled = true\n\n[logging]\nlevel = "debug"\nfuture_flag = 3\n',
  );
  expect(loadSettings(file)).toEqual({
    ...DEFAULTS,
    logging: { ...DEFAULTS.logging, level: "debug" },
  });
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
  const svc = watchSettings(createSettings(file), (changes, next) => fired.push({ changes, next }));
  svc.current(); // first read seeds the baseline — must not fire
  await Bun.write(file, '[logging]\nlevel = "debug"\nredact = true\n');
  const next = svc.current();
  expect(fired.length).toBe(1);
  expect(fired[0]!.changes).toEqual([
    "logging.level: info → debug",
    "logging.redact: false → true",
  ]);
  expect(fired[0]!.next).toBe(next);
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

/** Baseline for accessor tests: no CARET_* var set, whatever the host machine exports. */
const NO_CARET: Record<string, string | undefined> = {
  CARET_PORT: undefined,
  CARET_TIMEOUT: undefined,
  CARET_IDLE_MS: undefined,
  CARET_HEARTBEAT_MS: undefined,
  CARET_LOG_MAX_SIZE: undefined,
  CARET_LOG_KEEP: undefined,
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

// --- EXC-1068: log-rotation knobs ([logging].max_size / .keep) ---

test("the rotation knobs resolve to their schema defaults with no env and no file", () => {
  withEnv(NO_CARET, () => {
    expect(logMaxSize(DEFAULTS)).toBe(DEFAULT_LOG_MAX_SIZE);
    expect(logKeep(DEFAULTS)).toBe(DEFAULT_LOG_KEEP);
  });
});

test("a config file sets the rotation knobs (file > default)", async () => {
  await Bun.write(file, `[logging]\nmax_size = ${MIN_LOG_MAX_SIZE}\nkeep = 0\n`);
  const s = loadSettings(file);
  withEnv(NO_CARET, () => {
    expect(logMaxSize(s)).toBe(MIN_LOG_MAX_SIZE);
    expect(logKeep(s)).toBe(0); // keep = 0 legitimately means "archive nothing"
  });
});

test("CARET_LOG_MAX_SIZE / CARET_LOG_KEEP shadow the file values (env > file)", async () => {
  await Bun.write(file, "[logging]\nmax_size = 1048576\nkeep = 3\n");
  const s = loadSettings(file);
  withEnv({ CARET_LOG_MAX_SIZE: "2097152", CARET_LOG_KEEP: "7" }, () => {
    expect(logMaxSize(s)).toBe(2_097_152);
    expect(logKeep(s)).toBe(7);
  });
});

test("an unusable rotation env var falls through to the file value, then the default", async () => {
  await Bun.write(file, "[logging]\nmax_size = 1048576\nkeep = 3\n");
  const s = loadSettings(file);
  withEnv({ CARET_LOG_MAX_SIZE: "1024", CARET_LOG_KEEP: "-1" }, () => {
    expect(logMaxSize(s)).toBe(1_048_576); // → file
    expect(logKeep(s)).toBe(3);
    expect(logMaxSize(DEFAULTS)).toBe(DEFAULT_LOG_MAX_SIZE); // → default
    expect(logKeep(DEFAULTS)).toBe(DEFAULT_LOG_KEEP);
    expect(invalidEnvVars()).toEqual(["CARET_LOG_MAX_SIZE", "CARET_LOG_KEEP"]);
  });
});

test("a file max_size below the floor reverts the whole file", async () => {
  await Bun.write(file, `[logging]\nlevel = "warn"\nmax_size = ${MIN_LOG_MAX_SIZE - 1}\n`);
  expect(loadSettings(file)).toEqual(DEFAULTS);
});

test("a hot-reload of the rotation knobs is reported by watchSettings", async () => {
  await Bun.write(file, "[logging]\nmax_size = 5242880\n");
  const fired: string[][] = [];
  const svc = watchSettings(createSettings(file), (changes) => fired.push(changes));
  svc.current();
  await Bun.write(file, "[logging]\nmax_size = 1048576\n");
  svc.current();
  expect(fired).toEqual([["logging.max_size: 5242880 → 1048576"]]);
});

// --- EXC-533: HeartbeatMs upper bound (keeps the derived idleTimeout valid) ---

test("a file heartbeat_ms within the bound is accepted", async () => {
  await Bun.write(file, `[daemon]\nheartbeat_ms = ${MAX_HEARTBEAT_MS - 1}\n`);
  expect(loadSettings(file).daemon.heartbeat_ms).toBe(MAX_HEARTBEAT_MS - 1);
});

test("a file heartbeat_ms at or above the bound reverts the whole file", async () => {
  await Bun.write(
    file,
    `[logging]\nlevel = "warn"\n\n[daemon]\nheartbeat_ms = ${MAX_HEARTBEAT_MS}\n`,
  );
  // Whole-file granularity: the valid logging.level reverts along with the bad key.
  expect(loadSettings(file)).toEqual(DEFAULTS);
});

test("an out-of-bound CARET_HEARTBEAT_MS falls back to the file value, then the default", async () => {
  await Bun.write(file, "[daemon]\nheartbeat_ms = 250\n");
  const s = loadSettings(file);
  withEnv({ ...NO_CARET, CARET_HEARTBEAT_MS: String(MAX_HEARTBEAT_MS) }, () => {
    expect(heartbeatMs(s)).toBe(250); // → file
    expect(heartbeatMs(DEFAULTS)).toBe(8_000); // → default when the file has no value
  });
});

test("invalidEnvVars flags an out-of-bound CARET_HEARTBEAT_MS", () => {
  withEnv({ ...NO_CARET, CARET_HEARTBEAT_MS: String(MAX_HEARTBEAT_MS) }, () => {
    expect(invalidEnvVars()).toEqual(["CARET_HEARTBEAT_MS"]);
  });
  withEnv({ ...NO_CARET, CARET_HEARTBEAT_MS: String(MAX_HEARTBEAT_MS - 1) }, () => {
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

// --- EXC-842: envOverrides — the CARET_* tunables in effect (for /api/diagnostics) ---

test("envOverrides lists a set, valid CARET_* var with its raw value", () => {
  withEnv({ ...NO_CARET, CARET_PORT: "6000" }, () => {
    expect(envOverrides()).toEqual([{ name: "CARET_PORT", value: "6000" }]);
  });
});

test("envOverrides omits unset and blank vars", () => {
  withEnv({ ...NO_CARET, CARET_PORT: "", CARET_IDLE_MS: "   " }, () => {
    expect(envOverrides()).toEqual([]);
  });
});

test("envOverrides reports a set-but-invalid var with a null value", () => {
  // 99999 exceeds the in-schema timeout budget, so it is set-but-unusable.
  withEnv({ ...NO_CARET, CARET_TIMEOUT: "99999" }, () => {
    expect(envOverrides()).toEqual([{ name: "CARET_TIMEOUT", value: null }]);
  });
});

test("envOverrides preserves ENV_VARS declaration order", () => {
  withEnv(
    { CARET_PORT: "6000", CARET_TIMEOUT: "120", CARET_IDLE_MS: "0", CARET_HEARTBEAT_MS: "250" },
    () => {
      expect(envOverrides()).toEqual([
        { name: "CARET_PORT", value: "6000" },
        { name: "CARET_TIMEOUT", value: "120" },
        { name: "CARET_IDLE_MS", value: "0" },
        { name: "CARET_HEARTBEAT_MS", value: "250" },
      ]);
    },
  );
});

test("an env accessor re-resolves when its raw value changes between calls", () => {
  // The accessor caches per raw string but stays a live read: a changed value
  // is reflected on the very next call, never served stale from the cache.
  withEnv({ ...NO_CARET, CARET_PORT: "6000" }, () => {
    expect(getPort(DEFAULTS)).toBe(6000);
  });
  withEnv({ ...NO_CARET, CARET_PORT: "7000" }, () => {
    expect(getPort(DEFAULTS)).toBe(7000);
  });
  // Back to unset → falls through to the schema default, not the cached 7000.
  withEnv(NO_CARET, () => {
    expect(getPort(DEFAULTS)).toBe(DEFAULT_PORT);
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
  await Bun.write(file, "[logging]\nredact = false\n");
  let fires = 0;
  const svc: { current(): Settings } = watchSettings(createSettings(file), () => {
    fires++;
    svc.current(); // a logging callback re-enters (emit → level thunk → current)
  });
  svc.current();
  await Bun.write(file, "[logging]\nredact = true\n");
  svc.current();
  expect(fires).toBe(1); // the re-entrant read sees no further change
});

// --- EXC-558: [dev] table, dev accessors, and the prod-build gate ---

/** Baseline for the dev accessors: no CARET_DEV_* var set, whatever the host exports. */
const NO_DEV: Record<string, string | undefined> = {
  CARET_DEV_PORT: undefined,
  CARET_DEV_STATE_DIR: undefined,
  CARET_DEV_NEW_REVIEW_MS: undefined,
};

test("a [dev] config parses through the existing settings service", async () => {
  await Bun.write(
    file,
    '[dev]\nport = 4000\nstate_dir = "/tmp/caret-dev"\n\n[dev.notify]\nenabled = true\ninterval_ms = 3000\nmax_pending = 5\n',
  );
  expect(loadSettings(file, /* isCompiled */ false).dev).toEqual({
    port: 4000,
    state_dir: "/tmp/caret-dev",
    notify: { enabled: true, interval_ms: 3000, max_pending: 5 },
  });
});

test("an absent [dev] table yields the inert dev defaults", () => {
  expect(loadSettings(file, false).dev).toEqual(DEFAULTS.dev);
});

test("a malformed [dev] value reverts the whole file to defaults", async () => {
  // port must be a positive integer; -1 fails the schema → whole-file revert.
  await Bun.write(file, '[logging]\nlevel = "warn"\n\n[dev]\nport = -1\n');
  expect(loadSettings(file, false)).toEqual(DEFAULTS);
});

test("devPort resolves CARET_DEV_PORT > [dev].port > unset", async () => {
  await Bun.write(file, "[dev]\nport = 4000\n");
  const s = loadSettings(file, false);
  withEnv({ ...NO_DEV, CARET_DEV_PORT: "5050" }, () => expect(devPort(s)).toBe(5050));
  withEnv({ ...NO_DEV, CARET_DEV_PORT: "   " }, () => expect(devPort(s)).toBe(4000)); // blank → unset
  withEnv(NO_DEV, () => expect(devPort(s)).toBe(4000));
  withEnv(NO_DEV, () => expect(devPort(DEFAULTS)).toBeUndefined());
});

test("devPort falls through a set-but-invalid CARET_DEV_PORT to the config value", async () => {
  await Bun.write(file, "[dev]\nport = 4000\n");
  const s = loadSettings(file, false);
  withEnv({ ...NO_DEV, CARET_DEV_PORT: "nope" }, () => expect(devPort(s)).toBe(4000));
});

test("devStateDir resolves env > [dev].state_dir > unset, treating blank as unset", async () => {
  await Bun.write(file, '[dev]\nstate_dir = "/cfg/state"\n');
  const s = loadSettings(file, false);
  withEnv({ ...NO_DEV, CARET_DEV_STATE_DIR: "/env/state" }, () =>
    expect(devStateDir(s)).toBe("/env/state"),
  );
  withEnv({ ...NO_DEV, CARET_DEV_STATE_DIR: "   " }, () =>
    expect(devStateDir(s)).toBe("/cfg/state"),
  );
  withEnv(NO_DEV, () => expect(devStateDir(s)).toBe("/cfg/state"));
  withEnv(NO_DEV, () => expect(devStateDir(DEFAULTS)).toBeUndefined());
});

test("devSeeder arms on --notify, on [dev.notify].enabled, or on a positive env interval", async () => {
  await Bun.write(file, "[dev.notify]\nenabled = true\n");
  const enabledCfg = loadSettings(file, false);
  withEnv(NO_DEV, () => {
    expect(devSeeder(true, DEFAULTS).enabled).toBe(true); // --notify alone
    expect(devSeeder(false, enabledCfg).enabled).toBe(true); // config flag alone
    expect(devSeeder(false, DEFAULTS).enabled).toBe(false); // neither
  });
  withEnv({ ...NO_DEV, CARET_DEV_NEW_REVIEW_MS: "3000" }, () =>
    expect(devSeeder(false, DEFAULTS).enabled).toBe(true),
  );
});

test("devSeeder cadence resolves CARET_DEV_NEW_REVIEW_MS > [dev.notify].interval_ms > 15000", async () => {
  await Bun.write(file, "[dev.notify]\ninterval_ms = 20000\n");
  const s = loadSettings(file, false);
  withEnv({ ...NO_DEV, CARET_DEV_NEW_REVIEW_MS: "3000" }, () =>
    expect(devSeeder(true, s).intervalMs).toBe(3000),
  );
  withEnv(NO_DEV, () => expect(devSeeder(true, s).intervalMs).toBe(20_000));
  withEnv(NO_DEV, () => expect(devSeeder(true, DEFAULTS).intervalMs).toBe(15_000));
});

test("devSeeder carries [dev.notify].max_pending, defaulting to 3", async () => {
  await Bun.write(file, "[dev.notify]\nmax_pending = 5\n");
  const s = loadSettings(file, false);
  withEnv(NO_DEV, () => {
    expect(devSeeder(true, s).maxPending).toBe(5);
    expect(devSeeder(true, DEFAULTS).maxPending).toBe(3);
  });
});

test("a non-positive CARET_DEV_NEW_REVIEW_MS neither arms the seeder nor overrides cadence", async () => {
  await Bun.write(file, "[dev.notify]\ninterval_ms = 20000\n");
  const s = loadSettings(file, false);
  withEnv({ ...NO_DEV, CARET_DEV_NEW_REVIEW_MS: "0" }, () => {
    const r = devSeeder(false, s);
    expect(r.enabled).toBe(false); // 0 is not a positive arming value
    expect(r.intervalMs).toBe(20_000); // falls through to the config cadence
  });
});

test("a garbage CARET_DEV_NEW_REVIEW_MS falls through to config and is flagged invalid", async () => {
  await Bun.write(file, "[dev.notify]\ninterval_ms = 20000\n");
  const s = loadSettings(file, false);
  for (const bad of ["abc", "1.5"]) {
    withEnv({ ...NO_DEV, CARET_DEV_NEW_REVIEW_MS: bad }, () => {
      const r = devSeeder(false, s);
      expect(r.enabled).toBe(false); // garbage does not arm the seeder
      expect(r.intervalMs).toBe(20_000); // falls through to the config cadence
      expect(r.intervalInvalid).toBe(true); // set-but-invalid stays visible (the driver warns)
    });
  }
});

test("a valid or unset CARET_DEV_NEW_REVIEW_MS is not flagged invalid", () => {
  withEnv({ ...NO_DEV, CARET_DEV_NEW_REVIEW_MS: "3000" }, () =>
    expect(devSeeder(false, DEFAULTS).intervalInvalid).toBe(false),
  );
  withEnv(NO_DEV, () => expect(devSeeder(false, DEFAULTS).intervalInvalid).toBe(false));
});

test("a prod build resolves [dev] to inert defaults regardless of config.toml", async () => {
  await Bun.write(
    file,
    '[dev]\nport = 4000\nstate_dir = "/tmp/x"\n\n[dev.notify]\nenabled = true\ninterval_ms = 3000\n',
  );
  expect(loadSettings(file, /* isCompiled */ true).dev).toEqual(DEFAULTS.dev);
  expect(loadSettings(file, false).dev.notify.enabled).toBe(true); // the dev path reads real values
});

test("createSettings honors the prod-build gate on every current() read", async () => {
  await Bun.write(file, "[dev.notify]\nenabled = true\n");
  expect(createSettings(file, /* isCompiled */ true).current().dev).toEqual(DEFAULTS.dev);
  expect(createSettings(file, false).current().dev.notify.enabled).toBe(true);
});
