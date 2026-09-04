// Integration: exercise the REAL httpHealth + ensureDaemon against a live
// server (no mocked health). The real cross-process spawn race is covered by
// the manual end-to-end test (two Claude instances).

import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import {
  runCaretCli,
  spawnCaretDaemon,
  spawnEphemeralDaemon,
  untilLockWritten,
} from "@test/support/cli-process.ts";
import { ensureDaemonNoOps } from "@test/support/ensure-daemon-deps.ts";
import { ndjsonRecords } from "@test/support/ndjson.ts";
import { freePort } from "@test/support/net.ts";
import { until } from "@test/support/poll.ts";
import { recordingLog } from "@test/support/recording-log.ts";
import { expectNeverLogsBody } from "@test/support/redaction.ts";
import { DEFAULTS } from "@/config/settings.ts";
import { httpHealth } from "@/daemon/client.ts";
import { ensureDaemon } from "@/daemon/lifecycle.ts";
import { createServer } from "@/daemon/server.ts";
import { VERSION } from "@/lib/build-id.ts";
import { formatPlanMarkdown } from "@/plan/markdown.ts";
import { createStore } from "@/review/store.ts";

// Many tests here spawn a real `bun src/cli.ts daemon` subprocess, then wait on the
// lock file. Standalone that boot is ~tens of ms, but under `mise preflight`'s
// concurrent load the subprocess is starved of scheduling and it can stretch to many
// seconds. A fixed poll ceiling flaked there: EXC-647 kept widening it and 20s still
// tripped (measured: the transpile is NOT the cost — a prebuilt bundle boots no faster
// under load — it is raw scheduling starvation, which no ceiling reliably clears). So
// the waits are patient-while-alive instead: untilLockWritten polls only while the
// daemon PROCESS is alive, so a merely-slow boot still passes while a process that
// exits WITHOUT a lock fails fast with its exit code. setDefaultTimeout is the single,
// generous backstop for a genuinely hung subprocess.
setDefaultTimeout(90_000);

/** The daemon's NDJSON log inside a spawned subprocess's XDG_STATE_HOME — the
 * path createDaemonLogger owns, which these tests read instead of the raw
 * stderr the daemon no longer writes records to (EXC-1068). */
function daemonLog(stateHome: string): string {
  return join(stateHome, "caret", "logs", "daemon.log");
}

// In-process health/discovery probe servers (a bare createServer + fixed-path
// store, distinct from bootDaemon's full boot+client). Stopped after each test.
const servers: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop();
});

test("POST /api/reviews canonicalizes the agent's on-disk plan file end to end", async () => {
  // Guards the whole HTTP seam: the hook's planFilePath must survive the request
  // body schema and reach routeIncomingPlan, which rewrites that file with the
  // canonical text. A schema regression that dropped the field would silently
  // leave the agent reading raw text the human never saw — this catches that.
  const dir = await mkdtemp(join(tmpdir(), "caret-it-planfile-"));
  const srv = createServer({ store: createStore(join(dir, "store")), port: 0 });
  servers.push(srv);
  const planFilePath = join(dir, "plan.md");
  writeFileSync(planFilePath, "raw text the agent first wrote");
  const raw = `# Title\n\n${"a sentence prettier will reflow ".repeat(6)}`;

  const res = await fetch(`http://localhost:${srv.port}/api/reviews`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId: "S", plan: raw, planFilePath }),
  });
  expect(res.ok).toBe(true);

  const canonical = await formatPlanMarkdown(raw, recordingLog().log);
  expect(canonical).not.toBe(raw);
  expect(readFileSync(planFilePath, "utf8")).toBe(canonical);

  await rm(dir, { recursive: true, force: true });
});

test("httpHealth reports the caret identity from a live daemon", async () => {
  const srv = createServer({ store: createStore("/tmp/caret-it-x"), port: 0 });
  servers.push(srv);
  const h = await httpHealth(`http://localhost:${srv.port}`);
  expect(h?.service).toBe("caret");
});

test("concurrent ensureDaemon callers both connect to a live daemon", async () => {
  const srv = createServer({
    store: createStore("/tmp/caret-it-y"),
    port: 0,
    buildId: "it-build",
  });
  servers.push(srv);
  const baseUrl = `http://localhost:${srv.port}`;
  let spawns = 0;
  // Reuse against the real httpHealth: currentBuild/currentVersion match what the
  // live daemon reports, so neither caller retires or spawns.
  const deps = {
    baseUrl,
    currentBuild: "it-build",
    currentVersion: VERSION,
    currentStateDir: "/it/world",
    health: httpHealth,
    ...ensureDaemonNoOps(),
    spawn: () => spawns++,
  };
  const [a, b] = await Promise.all([ensureDaemon(deps), ensureDaemon(deps)]);
  expect(a).toBe(baseUrl);
  expect(b).toBe(baseUrl);
  expect(spawns).toBe(0); // already up — no spawn needed
});

test("ensureDaemon fails fast against a non-caret server on the port", async () => {
  const foreign = Bun.serve({
    port: 0,
    fetch: () => Response.json({ service: "not-caret" }),
  });
  try {
    await expect(
      ensureDaemon({
        baseUrl: `http://localhost:${foreign.port}`,
        currentBuild: "b1",
        currentVersion: VERSION,
        currentStateDir: "/it/world",
        health: httpHealth,
        ...ensureDaemonNoOps(3),
      }),
    ).rejects.toThrow(/CARET_PORT/);
  } finally {
    foreign.stop();
  }
});

// A real detached daemon process — the only way to exercise runDaemon's
// signal/exit cleanup wiring end-to-end (lock written on start, removed on the
// signal, EXC-406). SIGTERM and SIGINT share the same shutdown() closure.
async function assertLockRemovedOnSignal(signal: "SIGTERM" | "SIGINT") {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-signal-"));
  const lockPath = join(stateHome, "caret", "daemon.lock");
  const proc = spawnCaretDaemon(stateHome);
  try {
    await untilLockWritten(proc, lockPath);
    proc.kill(signal);
    // The shutdown closure unlinks the lock, then the process exits — so wait for the
    // exit (again patient under a loaded box, backstopped by setDefaultTimeout), then
    // assert the lock is gone. The unlink runs before exit, so this short poll only
    // absorbs fs latency; a lock still present here is a real cleanup regression.
    await proc.exited;
    expect(await until(() => !existsSync(lockPath), 2_000)).toBe(true);
  } finally {
    proc.kill("SIGKILL");
    await proc.exited;
    await rm(stateHome, { recursive: true, force: true });
  }
}

test("the daemon writes the lock on start and removes it on SIGTERM", async () => {
  await assertLockRemovedOnSignal("SIGTERM");
});

// `caret daemon --ephemeral` (EXC-461): the daemon binds an OS-assigned port
// regardless of the configured one, and the lock + /api/health carry the
// world identity a dev session discovers the daemon by.
test("an --ephemeral daemon binds an OS port and records identity in the lock", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-ephemeral-"));
  const { proc, lock } = await spawnEphemeralDaemon(stateHome);
  try {
    // OS-assigned, never the configured default the env would have resolved to.
    expect(lock.port).toBeGreaterThan(0);
    expect(lock.port).not.toBe(42718);
    expect(lock.stateDir).toBe(join(stateHome, "caret"));
    expect(lock.instanceId).toMatch(/^[0-9a-f]{8}$/);
    const h = (await (await fetch(`http://127.0.0.1:${lock.port}/api/health`)).json()) as {
      service?: string;
      stateDir?: string;
      instanceId?: string;
      fresh?: boolean;
    };
    expect(h.service).toBe("caret");
    expect(h.stateDir).toBe(lock.stateDir);
    expect(h.instanceId).toBe(lock.instanceId);
    // Without CARET_FRESH (the production case) the fresh field is omitted entirely.
    expect(h.fresh).toBeUndefined();
  } finally {
    proc.kill("SIGKILL");
    await proc.exited;
    await rm(stateHome, { recursive: true, force: true });
  }
});

// EXC-781: `mise run dev --fresh` sets CARET_FRESH=1 on the daemon child; the UI
// reads this field from /api/health to reset its saved preferences on boot.
test("a daemon started with CARET_FRESH=1 reports fresh in /api/health", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-fresh-"));
  const { proc, lock } = await spawnEphemeralDaemon(stateHome, { CARET_FRESH: "1" });
  try {
    const h = (await (await fetch(`http://127.0.0.1:${lock.port}/api/health`)).json()) as {
      fresh?: boolean;
    };
    expect(h.fresh).toBe(true);
  } finally {
    proc.kill("SIGKILL");
    await proc.exited;
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("the daemon removes the lock on SIGINT", async () => {
  await assertLockRemovedOnSignal("SIGINT");
});

// `caret redact` end-to-end: argv routing, stdout report, and the scrubbed
// sibling files — the real subprocess, like the daemon signal tests above.
test("caret redact scrubs state-dir logs into shareable siblings", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-redact-cli-"));
  const logPath = join(stateHome, "caret", "logs", "caret.log");
  const home = homedir();
  await Bun.write(logPath, `${JSON.stringify({ step: "x", msg: `boom at ${home}/src` })}\n`);
  try {
    const { exitCode, stdout } = await runCaretCli(["redact"], {
      env: { ...process.env, XDG_STATE_HOME: stateHome },
    });
    const sibling = join(stateHome, "caret", "logs", "caret.redacted.log");
    expect(exitCode).toBe(0);
    expect(stdout).toContain(sibling);
    const scrubbed = await Bun.file(sibling).text();
    expectNeverLogsBody(scrubbed, home);
    expect(scrubbed).toContain("~/src");
  } finally {
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("caret redact reports when there are no logs to scrub", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-redact-empty-"));
  try {
    const { exitCode, stdout } = await runCaretCli(["redact"], {
      env: { ...process.env, XDG_STATE_HOME: stateHome },
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("no logs");
  } finally {
    await rm(stateHome, { recursive: true, force: true });
  }
});

// `caret discovery` end-to-end (EXC-464): argv routing (human vs --json), the
// always-on redaction, and the exit-0-on-degraded contract — real subprocess,
// like the redact tests above. CARET_PORT points at a just-released free port
// so the probe never touches a real daemon; CLAUDE_CONFIG_DIR points at the
// empty state home so installState stays hermetic ("unknown").
function discoveryEnv(stateHome: string): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    XDG_STATE_HOME: stateHome,
    CARET_PORT: String(freePort()),
    CLAUDE_CONFIG_DIR: join(stateHome, "claude"),
  };
  // Force the default config path (~/.config/...): its home prefix is exactly
  // what the always-on scrub must rewrite to ~.
  delete env.XDG_CONFIG_HOME;
  return env;
}

test("caret discovery prints a human-readable report and exits 0", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-discovery-human-"));
  try {
    const { exitCode, stdout: out } = await runCaretCli(["discovery"], {
      env: discoveryEnv(stateHome),
    });
    expect(exitCode).toBe(0);
    expect(out.startsWith("caret discovery (caret-discovery/1)")).toBe(true);
    // Every section title renders, and the daemon (nothing on the port) reads
    // as unreachable.
    for (const title of [
      "system:",
      "install:",
      "settings:",
      "daemon:",
      "lockAndPort:",
      "processes:",
      "reviews:",
      "installState:",
      "logs:",
    ]) {
      expect(out).toContain(title);
    }
    expect(out).toContain("reachable : false");
  } finally {
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("caret discovery --json prints one parseable, redacted document", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-discovery-json-"));
  try {
    const { exitCode, stdout: out } = await runCaretCli(["discovery", "--json"], {
      env: discoveryEnv(stateHome),
    });
    expect(exitCode).toBe(0);
    const report = JSON.parse(out) as Record<string, unknown>;
    expect(report.schema).toBe("caret-discovery/1");
    expect(report.version).toBe(VERSION);
    for (const key of [
      "system",
      "install",
      "settings",
      "daemon",
      "lockAndPort",
      "processes",
      "reviews",
      "installState",
      "logs",
    ]) {
      expect(report[key]).toBeDefined();
    }
    // Empty state + nothing on the port: every probe degrades gracefully, the
    // run still exits 0 (the acceptance contract).
    expect(report.daemon).toEqual({ reachable: false });
    // Always-redacted: the home prefix never appears raw — the default config
    // path renders as ~/.config/... and the bun binaryPath is scrubbed too.
    expectNeverLogsBody(out, homedir());
    expect((report.settings as Record<string, unknown>).configPath).toBe(
      "~/.config/caret/config.toml",
    );
    // The flat-shape invariant: nothing was depth-clipped by the scrub.
    expect(out).not.toContain("<depth-capped>");
  } finally {
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("caret discovery --json reports a live daemon's identity and commit", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-discovery-live-"));
  const srv = createServer({
    store: createStore(join(stateHome, "reviews")),
    port: 0,
    buildId: "it-build",
    commit: "it-commit",
  });
  servers.push(srv);
  const env = discoveryEnv(stateHome);
  env.CARET_PORT = String(srv.port);
  try {
    const { exitCode, stdout: out } = await runCaretCli(["discovery", "--json"], { env });
    expect(exitCode).toBe(0);
    const report = JSON.parse(out) as Record<string, unknown>;
    expect(report.daemon).toEqual({
      reachable: true,
      service: "caret",
      daemonVersion: VERSION,
      build: "it-build",
      commit: "it-commit",
    });
    expect((report.lockAndPort as Record<string, unknown>).portServesCaret).toBe(true);
  } finally {
    await rm(stateHome, { recursive: true, force: true });
  }
});

// runDaemon lifecycle records (EXC-444): ui fallback, invalid-env warns, and
// the signal-shutdown record — only reachable through a real daemon process.
test("the daemon logs env warns, ui fallback, and the sigterm shutdown", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-daemon-logs-"));
  const lockPath = join(stateHome, "caret", "daemon.lock");
  // CARET_TIMEOUT set-but-invalid → one boot warn.
  const proc = spawnCaretDaemon(stateHome, { CARET_TIMEOUT: "nope" }, true);
  try {
    await untilLockWritten(proc, lockPath);
    proc.kill("SIGTERM");
    await proc.exited;
    // The daemon's NDJSON goes to the log path it owns, not stderr (EXC-1068).
    const recs = ndjsonRecords(await Bun.file(daemonLog(stateHome)).text());
    // Stable contract: the invalid env var surfaces as a warn-level "env" record
    // naming the offending var — assert step/level/var, not the exact tail.
    expect(
      recs.some(
        (r) =>
          r.step === "env" &&
          r.level === 40 &&
          typeof r.msg === "string" &&
          r.msg.startsWith("CARET_TIMEOUT invalid"),
      ),
    ).toBe(true);
    expect(recs.some((r) => r.step === "signal" && r.msg === "sigterm: shutting down")).toBe(true);
    // The ui record fires exactly when no UI is embedded/built — true on a fresh
    // checkout and in CI; a local `mise run build ui` artifact flips the branch,
    // so each environment asserts its own valid outcome.
    const uiBuilt = existsSync(join(process.cwd(), "ui", "dist", "index.html"));
    expect(
      recs.some((r) => r.step === "ui" && r.msg === "no embedded ui; serving placeholder"),
    ).toBe(!uiBuilt);
  } finally {
    proc.kill("SIGKILL");
    await proc.exited;
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("the review hook warns about invalid CARET_* env vars in caret.log", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-review-env-"));
  try {
    // Bad stdin: the run fail-safe-denies at the parse step, before any daemon
    // work — the env warn must already be on disk by then.
    const { exitCode, stdout: out } = await runCaretCli(["review"], {
      env: { ...process.env, XDG_STATE_HOME: stateHome, CARET_PORT: "nope" },
      stdin: new TextEncoder().encode("not json"),
    });
    expect(exitCode).toBe(0);
    expect(out).toContain('"deny"');
    const recs = ndjsonRecords(
      await Bun.file(join(stateHome, "caret", "logs", "caret.log")).text(),
    );
    // Stable contract: a warn-level "env" record naming the offending var —
    // assert step/level/var prefix, not the exact descriptive tail (F1 style).
    expect(
      recs.some(
        (r) =>
          r.step === "env" &&
          r.level === 40 &&
          typeof r.msg === "string" &&
          r.msg.startsWith("CARET_PORT invalid"),
      ),
    ).toBe(true);
  } finally {
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("the review hook treats an unknown flag as a parse error, not a deny", async () => {
  // EXC-472: a CLI parse error (e.g. an unknown option on `review`) must NOT
  // masquerade as a fail-safe deny. The flag is rejected during argv parsing —
  // before the review action runs and reads stdin — so the process exits
  // non-zero with nothing on stdout, never a deny written to stdout at exit 0.
  const stateHome = await mkdtemp(join(tmpdir(), "caret-review-parse-"));
  try {
    // Stdin is supplied so the baseline (which ignores the flag and reads stdin)
    // resolves rather than blocking; the parse error errors before stdin is read.
    const { exitCode, stdout: out } = await runCaretCli(["review", "--nonexistent-flag"], {
      env: { ...process.env, XDG_STATE_HOME: stateHome },
      stdin: new TextEncoder().encode("not json"),
    });
    expect(exitCode).not.toBe(0);
    expect(out).not.toContain('"deny"');
  } finally {
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("the daemon logs the parsed settings at startup", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-settings-boot-"));
  const configHome = await mkdtemp(join(tmpdir(), "caret-settings-cfg-"));
  await Bun.write(
    join(configHome, "caret", "config.toml"),
    "[logging]\ndebug = true\nredact = true\n",
  );
  const lockPath = join(stateHome, "caret", "daemon.lock");
  const proc = spawnCaretDaemon(stateHome, { XDG_CONFIG_HOME: configHome }, true);
  try {
    // The boot settings line is emitted before the server binds (lock write),
    // so the lock appearing means the line is already flushed (sync writes).
    await untilLockWritten(proc, lockPath);
    proc.kill("SIGTERM");
    await proc.exited;
    const rec = ndjsonRecords(await Bun.file(daemonLog(stateHome)).text()).find(
      (r) => r.step === "settings",
    );
    expect(rec).toBeDefined();
    // Effective (validated) values, never raw config text. `debug` is no longer
    // a known key (EXC-400): zod strips it, so it never reaches the boot line.
    // The daemon/review tables are the file-or-default values — the CARET_PORT /
    // CARET_IDLE_MS env overrides above resolve in the accessors (EXC-430) and
    // never appear in the parsed settings.
    // EXC-558: the [dev] table rides the boot record too; here it is the
    // schema default (no [dev] in this config). A prod binary gates it inert.
    // Every table but logging.redact is untouched by this config, so they ride
    // straight from DEFAULTS.
    expect(rec?.settings).toEqual({ ...DEFAULTS, logging: { ...DEFAULTS.logging, redact: true } });
  } finally {
    proc.kill("SIGKILL");
    await proc.exited;
    await rm(stateHome, { recursive: true, force: true });
    await rm(configHome, { recursive: true, force: true });
  }
});
