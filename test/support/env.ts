// Environment isolation: keep every test off the real ~/.local/state/caret and
// ~/.config/caret by routing the XDG dirs at throwaway temp dirs, and restore
// process.env afterward so changes never leak across tests.
import { afterEach, beforeEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Run `fn` with the given env vars applied (an `undefined` value deletes the
 * var), restoring every touched key — including ones that were already set —
 * afterward. Synchronous: the restore runs in a `finally`, so a throwing `fn`
 * still leaves process.env clean.
 */
export function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
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

/**
 * Wire a fresh, isolated XDG_STATE_HOME for each test in the calling file: a new
 * temp dir is created in beforeEach and pointed at by `process.env.XDG_STATE_HOME`,
 * then wiped and the prior value restored in afterEach. The returned accessor
 * yields the current test's state dir (so logFile()/stateDir() resolve under it).
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
