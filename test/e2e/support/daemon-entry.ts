#!/usr/bin/env bun
// e2e daemon launcher: boots an isolated caret daemon for one Playwright test.
//
// This is a SECOND, deliberately-kept daemon-boot path alongside the production
// `runDaemon` (src/commands/daemon.ts). The two call the same createServer, but
// the e2e boot needs four things the production boot can't offer, and a shared
// factory would have to be parameterized across every one of them — speculative
// abstraction for a single extra call site (the no-speculative-abstraction rule
// in doc/agents/typescript-rules.md), so the parallel boot stays explicit. The deltas:
//
//   1. OS-assigned port (port 0). `caret daemon --ephemeral` does bind port 0,
//      but every other CLI path resolves the port through the settings layer,
//      where it must be a POSITIVE int — so the schema can't carry 0 and direct
//      createServer is the only way to ask for one. OS-assigned ports keep
//      fullyParallel workers collision-free.
//   2. Config hermeticity. createServer takes explicit opts and reads no
//      config.toml, so the user's ~/.config/caret/config.toml can never leak
//      into a test run; the production boot resolves settings (and hot-reloads).
//   3. NEVER_IDLE_MS + a no-op onShutdown. The daemon must never idle-shut-down
//      mid-test, and even an unexpected shutdown must not process.exit out from
//      under the runner; the production boot's onShutdown exits the process.
//   4. A stdout port handshake. The fixture parses the bound port from stdout;
//      the production boot writes a lock file instead and installs the signal
//      handlers + lock lifecycle this test boot deliberately omits.
//
// Protocol with the spawning fixture (test/e2e/support/fixtures.ts): stdout carries
// EXACTLY ONE JSON line `{"port": N}`; all logs go to stderr so the port
// handshake can't be corrupted. The fixture owns the ephemeral XDG_STATE_HOME
// and tears it down after the test.

import { NEVER_IDLE_MS } from "../../../src/config/constants.ts";
import { createServer } from "../../../src/daemon/server.ts";
import { createDaemonLogger } from "../../../src/lib/log.ts";
import { prefsFile, reviewsDir } from "../../../src/config/paths.ts";
import { createStore } from "../../../src/store.ts";
import { loadUiAssets } from "../../../src/ui-assets.ts";

// Refuse to run without an isolated state dir — never fall back to the real
// ~/.local/state/caret (same posture as assertDevEnv in scripts/tasks/dev/driver.ts).
if (!process.env.XDG_STATE_HOME) {
  console.error("caret e2e daemon: XDG_STATE_HOME must be set to an isolated state dir");
  process.exit(1);
}

// The shipped artifact, resolved through the daemon's own asset seam so the spec
// exercises the whole ui/dist/ tree (index plus its hashed siblings), the same
// resolver the binary uses. Absence fails loudly so a direct `bunx playwright
// test` that skipped the UI build doesn't silently serve the placeholder; the
// `test e2e` task builds the UI first.
const assets = await loadUiAssets();
if (!assets) {
  console.error("caret e2e daemon: ui/dist missing — run `mise run build ui` first");
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
