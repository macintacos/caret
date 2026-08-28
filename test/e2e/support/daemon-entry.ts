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

import { NEVER_IDLE_MS } from "@/config/constants.ts";
import { prefsFile, reviewsDir } from "@/config/paths.ts";
import { createServer } from "@/daemon/server.ts";
import { createDaemonLogger } from "@/lib/log.ts";
import { createStore } from "@/review/store.ts";
import { loadUiAssets } from "@/ui/assets.ts";

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

// Explicit fd 2: the harness folds this daemon's stderr into its boot-failure
// message (test/e2e/support/fixtures.ts), so the NDJSON must stay on stderr
// rather than going to the daemon log the default now owns.
const log = createDaemonLogger(() => "info", 2);
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
  // A synthetic build identity + self-diagnostics so the settings Advanced pane
  // (EXC-848) has real blocks to render. The prod daemon derives these from the
  // build (buildId/commit) and the live process/settings; here they are fixed so
  // the pane's block text is deterministic across machines (advanced.e2e.ts
  // asserts these exact values — keep the two in sync). The port lives in the
  // settings graph, not the bound OS port, mirroring how the pane narrows it.
  // `listSkills` and `readSkillDescription` are deliberately NOT wired, so
  // GET /api/reviews/:id/skills and its /skill-description sibling both 404 here:
  // the production capabilities enumerate and then OPEN files under the
  // developer's real ~/.claude, and a spec must never read those. A spec that
  // needs either route stubs its own.
  buildId: "e2e-build",
  commit: "e2ecommit0000000",
  // The update verdict (EXC-1207), synthetic for the same reason the identity above is.
  // It is wired rather than left absent because App reads GET /api/update on EVERY load:
  // an unwired route 404s, which would put a failed same-origin request into every spec's
  // page load — exactly what assets.e2e.ts exists to catch. `unavailable`/`dev` is the
  // honest verdict for a daemon running from source, and it is quiet, so no spec sees a
  // toast or a badge it did not ask for. A spec that wants a real verdict routes
  // **/api/update itself (updates.e2e.ts).
  updateReport: () => ({
    install: "dev",
    version: "0.0.0-e2e",
    commit: "e2ecommit0000000",
    status: { kind: "unavailable", reason: "dev" },
  }),
  diagnostics: () => ({
    system: { platform: "darwin", arch: "arm64", runtime: "bun 1.2.19" },
    uptimeMs: 2 * 3_600_000 + 14 * 60_000,
    settings: { daemon: { port: 42718 }, review: { timeout_s: 3600 } },
    config: { path: "/home/e2e/.config/caret/config.toml", exists: true, env: [] },
  }),
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
