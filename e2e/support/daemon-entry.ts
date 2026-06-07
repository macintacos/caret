#!/usr/bin/env bun
// e2e daemon launcher: boots an isolated caret daemon for one Playwright test.
//
// Why not `bun src/cli.ts daemon`: the CLI resolves its port through the
// settings layer, where CARET_PORT must be a POSITIVE int — port 0 is invalid
// and would silently fall back to the production default (42718, the user's
// real daemon). OS-assigned ports therefore require calling createServer
// directly, which is also hermetic (explicit opts, no config-file reads), so
// the user's ~/.config/caret/config.toml can never leak into a test run.
//
// Protocol with the spawning fixture (e2e/support/fixtures.ts): stdout carries
// EXACTLY ONE JSON line `{"port": N}`; all logs go to stderr so the port
// handshake can't be corrupted. The fixture owns the ephemeral XDG_STATE_HOME
// and tears it down after the test.

import { NEVER_IDLE_MS } from "../../src/constants.ts";
import { createServer } from "../../src/daemon.ts";
import { createDaemonLogger } from "../../src/log.ts";
import { prefsFile, reviewsDir } from "../../src/paths.ts";
import { createStore } from "../../src/store.ts";
import { loadUiAssets } from "../../src/ui-assets.ts";

// Refuse to run without an isolated state dir — never fall back to the real
// ~/.local/state/caret (same posture as assertDevEnv in scripts/dev/driver.ts).
if (!process.env.XDG_STATE_HOME) {
  console.error("caret e2e daemon: XDG_STATE_HOME must be set to an isolated state dir");
  process.exit(1);
}

// The shipped artifact, resolved through the daemon's own asset seam so the spec
// exercises the whole ui/dist/ tree (index plus its hashed siblings), the same
// resolver the binary uses. Absence fails loudly so a direct `bunx playwright
// test` that skipped build-ui doesn't silently serve the placeholder; the mise
// task depends on build-ui.
const assets = await loadUiAssets();
if (!assets) {
  console.error("caret e2e daemon: ui/dist missing — run `mise run build-ui` first");
  process.exit(1);
}

const log = createDaemonLogger(() => "info"); // NDJSON to stderr
const store = createStore(reviewsDir(), log);
await store.rehydrate();

const server = createServer({
  store,
  port: 0, // OS-assigned: parallel workers can never collide
  // The daemon must never idle-shut-down mid-test.
  idleMs: NEVER_IDLE_MS,
  // Belt and braces: even an unexpected idle fire must not process.exit.
  onShutdown: () => {},
  prefsPath: prefsFile(), // under the ephemeral state dir
  assets,
  log,
});

// Self-reap if the fixture dies without running teardown (e.g. a SIGKILL'd
// runner): the parent holds our stdin pipe, so its death closes stdin. Without
// this, an orphan would idle for ~2^31 ms holding its port and state dir.
process.stdin.resume();
process.stdin.on("close", () => process.exit(0));
process.stdin.on("end", () => process.exit(0));

// The one stdout line the fixture parses. Bun.serve keeps the process alive;
// the fixture SIGTERMs it at teardown — no handler installed on purpose: the
// runtime's default terminate is fine since reviews are write-through and
// there is nothing to flush (runDaemon's signal handlers live in commands/daemon.ts).
console.log(JSON.stringify({ port: server.port }));
