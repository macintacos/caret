// Integration: exercise the REAL httpHealth + ensureDaemon against a live
// server (no mocked health). The real cross-process spawn race is covered by
// the manual end-to-end test (two Claude instances).

import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDaemon, httpHealth } from "../src/cli.ts";
import { createServer } from "../src/daemon.ts";
import { VERSION } from "../src/paths.ts";
import { createStore } from "../src/store.ts";

const servers: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop();
});

/** Poll `pred` until it's true or the budget elapses. */
async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (pred()) return true;
    await Bun.sleep(20);
  }
  return pred();
}

/** A loopback port that is free right now (probe-then-release). */
function freePort(): number {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
  const port = probe.port;
  probe.stop();
  return port;
}

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
    health: httpHealth,
    readLock: () => null,
    isAlive: () => false,
    retire: async () => true,
    removeLock: () => {},
    spawn: () => spawns++,
    backoff: async () => {},
    maxAttempts: 5,
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
        health: httpHealth,
        readLock: () => null,
        isAlive: () => false,
        retire: async () => true,
        removeLock: () => {},
        spawn: () => {},
        backoff: async () => {},
        maxAttempts: 3,
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
  const proc = Bun.spawn([process.execPath, "src/cli.ts", "daemon"], {
    env: {
      ...process.env,
      CARET_PORT: String(freePort()),
      XDG_STATE_HOME: stateHome,
      CARET_IDLE_MS: "600000", // don't idle-shutdown before we signal
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  try {
    expect(await waitFor(() => existsSync(lockPath), 5000)).toBe(true);
    proc.kill(signal);
    expect(await waitFor(() => !existsSync(lockPath), 5000)).toBe(true);
    await proc.exited;
  } finally {
    proc.kill("SIGKILL");
    await proc.exited;
    await rm(stateHome, { recursive: true, force: true });
  }
}

test("the daemon writes the lock on start and removes it on SIGTERM", async () => {
  await assertLockRemovedOnSignal("SIGTERM");
});

test("the daemon removes the lock on SIGINT", async () => {
  await assertLockRemovedOnSignal("SIGINT");
});

// `caret redact` end-to-end: argv routing, stdout report, and the scrubbed
// sibling files — the real subprocess, like the daemon signal tests above.
test("caret redact scrubs state-dir logs into shareable siblings", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-redact-cli-"));
  const logPath = join(stateHome, "caret", "caret.log");
  const home = homedir();
  await Bun.write(logPath, `${JSON.stringify({ step: "x", msg: `boom at ${home}/src` })}\n`);
  const proc = Bun.spawn([process.execPath, "src/cli.ts", "redact"], {
    env: { ...process.env, XDG_STATE_HOME: stateHome },
    stdout: "pipe",
    stderr: "ignore",
  });
  try {
    const exit = await proc.exited;
    const out = await new Response(proc.stdout).text();
    const sibling = join(stateHome, "caret", "caret.redacted.log");
    expect(exit).toBe(0);
    expect(out).toContain(sibling);
    const scrubbed = await Bun.file(sibling).text();
    expect(scrubbed).not.toContain(home);
    expect(scrubbed).toContain("~/src");
  } finally {
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("caret redact reports when there are no logs to scrub", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-redact-empty-"));
  const proc = Bun.spawn([process.execPath, "src/cli.ts", "redact"], {
    env: { ...process.env, XDG_STATE_HOME: stateHome },
    stdout: "pipe",
    stderr: "ignore",
  });
  try {
    const exit = await proc.exited;
    const out = await new Response(proc.stdout).text();
    expect(exit).toBe(0);
    expect(out).toContain("no logs");
  } finally {
    await rm(stateHome, { recursive: true, force: true });
  }
});

// runDaemon lifecycle records (EXC-444): ui fallback, invalid-env warns, and
// the signal-shutdown record — only reachable through a real daemon process.
test("the daemon logs env warns, ui fallback, and the sigterm shutdown", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-daemon-logs-"));
  const lockPath = join(stateHome, "caret", "daemon.lock");
  const proc = Bun.spawn([process.execPath, "src/cli.ts", "daemon"], {
    env: {
      ...process.env,
      CARET_PORT: String(freePort()),
      CARET_TIMEOUT: "nope", // set-but-invalid → one boot warn
      XDG_STATE_HOME: stateHome,
      CARET_IDLE_MS: "600000",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    expect(await waitFor(() => existsSync(lockPath), 5000)).toBe(true);
    proc.kill("SIGTERM");
    await proc.exited;
    const recs = (await new Response(proc.stderr).text())
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(
      recs.some(
        (r) => r.step === "env" && r.level === 40 && r.msg === "CARET_TIMEOUT invalid; using default",
      ),
    ).toBe(true);
    expect(recs.some((r) => r.step === "signal" && r.msg === "sigterm: shutting down")).toBe(true);
    // The ui record only fires when no UI is embedded/built — true on a fresh
    // checkout; skip the assertion when a local `mise run build-ui` artifact exists.
    if (!existsSync(join(process.cwd(), "ui", "dist", "index.html"))) {
      expect(recs.some((r) => r.step === "ui" && r.msg === "no embedded ui; serving placeholder")).toBe(
        true,
      );
    }
  } finally {
    proc.kill("SIGKILL");
    await proc.exited;
    await rm(stateHome, { recursive: true, force: true });
  }
});

test("the review hook warns about invalid CARET_* env vars in caret.log", async () => {
  const stateHome = await mkdtemp(join(tmpdir(), "caret-review-env-"));
  const proc = Bun.spawn([process.execPath, "src/cli.ts", "review"], {
    env: { ...process.env, XDG_STATE_HOME: stateHome, CARET_PORT: "nope" },
    // Bad stdin: the run fail-safe-denies at the parse step, before any daemon
    // work — the env warn must already be on disk by then.
    stdin: new TextEncoder().encode("not json"),
    stdout: "pipe",
    stderr: "ignore",
  });
  try {
    const exit = await proc.exited;
    const out = await new Response(proc.stdout).text();
    expect(exit).toBe(0);
    expect(out).toContain('"deny"');
    const recs = (await Bun.file(join(stateHome, "caret", "caret.log")).text())
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(
      recs.some(
        (r) => r.step === "env" && r.level === 40 && r.msg === "CARET_PORT invalid; using default",
      ),
    ).toBe(true);
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
  const proc = Bun.spawn([process.execPath, "src/cli.ts", "daemon"], {
    env: {
      ...process.env,
      CARET_PORT: String(freePort()),
      XDG_STATE_HOME: stateHome,
      XDG_CONFIG_HOME: configHome,
      CARET_IDLE_MS: "600000", // don't idle-shutdown before we read the boot line
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    // The boot settings line is emitted before the server binds (lock write),
    // so the lock appearing means the line is already flushed (sync writes).
    expect(await waitFor(() => existsSync(lockPath), 5000)).toBe(true);
    proc.kill("SIGTERM");
    await proc.exited;
    const stderr = await new Response(proc.stderr).text();
    const rec = stderr
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .find((r) => r.step === "settings");
    expect(rec).toBeDefined();
    // Effective (validated) values, never raw config text.
    expect(rec?.settings).toEqual({ logging: { level: "info", debug: true, redact: true } });
  } finally {
    proc.kill("SIGKILL");
    await proc.exited;
    await rm(stateHome, { recursive: true, force: true });
    await rm(configHome, { recursive: true, force: true });
  }
});
