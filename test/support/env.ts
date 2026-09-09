// Environment isolation: keep every test off the real ~/.local/state/caret and
// ~/.config/caret by routing the XDG dirs at throwaway temp dirs, and restore
// process.env afterward so changes never leak across tests.
import { afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Run `fn` with the given env vars applied (an `undefined` value deletes the
 * var), restoring every touched key — including ones that were already set.
 * Sync or async, throwing or rejecting, process.env comes out clean.
 */
export function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  let result: T;
  try {
    result = fn();
  } catch (e) {
    restore();
    throw e;
  }
  if (result instanceof Promise) {
    return result.finally(restore) as T;
  }
  restore();
  return result;
}

/**
 * Point CARET_CONFIG_FILE at a fresh path inside each test's own temp dir, so a suite
 * that reads or writes config.toml never touches the developer's own. Takes the state-dir
 * accessor `setupTempStateDir` returns, since that dir is already per-test.
 *
 * The returned accessor yields the config path (which starts out absent, so loadSettings
 * resolves to defaults until the test writes one).
 */
export function setupTempConfigFile(dir: () => string): () => string {
  const file = () => join(dir(), "config.toml");
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.CARET_CONFIG_FILE;
    process.env.CARET_CONFIG_FILE = file();
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.CARET_CONFIG_FILE;
    else process.env.CARET_CONFIG_FILE = saved;
  });
  return file;
}

/**
 * Wire a fresh, isolated XDG_STATE_HOME for each test in the calling file. The
 * returned accessor yields the current test's state dir (so logFile()/stateDir()
 * resolve under it).
 *
 * `prefix` names the temp dir for diagnosability (e.g. "caret-cli-").
 */
export function setupTempStateDir(prefix = "caret-test-"): () => string {
  let dir: string;
  let savedXdg: string | undefined;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), prefix));
    savedXdg = process.env.XDG_STATE_HOME;
    process.env.XDG_STATE_HOME = dir;
  });
  afterEach(async () => {
    if (savedXdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedXdg;
    await rm(dir, { recursive: true, force: true });
  });
  return () => dir;
}
