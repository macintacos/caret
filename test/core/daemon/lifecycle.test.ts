import { afterEach, expect, test } from "bun:test";
import {
  closeSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { ensureDaemonNoOps } from "@test/support/ensure-daemon-deps.ts";
import { setupTempStateDir, withEnv } from "@test/support/env.ts";
import { caretLogRecords } from "@test/support/ndjson.ts";
import { fakeServiceManager } from "@test/support/service-manager.ts";
import {
  daemonLock,
  daemonStderrLogFile,
  ensureLogsDir,
  launcherServiceFile,
  logArchiveDir,
} from "@/config/paths.ts";
import { DEFAULTS, isResident } from "@/config/settings.ts";
import type { HealthBody } from "@/daemon/client.ts";
import {
  DAEMON_CWD,
  type EnsureOptions,
  ensureDaemon,
  openDaemonStderr,
  prodEnsureDeps,
  removeOwnDaemonLock,
  retireDaemon,
  rotateDaemonStderr,
  SPAWN_RESERVE_MS,
  spawnDaemon,
} from "@/daemon/lifecycle.ts";
import { setLogLevel } from "@/lib/log.ts";
import { type ServiceManager, SUPERVISED_VAR } from "@/service/manager.ts";

// Point the state dir at a throwaway temp dir so the debug-level instrumentation
// tests append to a disposable caret.log instead of the real ~/.local/state/caret.
setupTempStateDir("caret-daemon-lifecycle-");
afterEach(() => setLogLevel("info")); // undo any per-test level change

// ---- ensureDaemon ----

function ensureDeps(over: Partial<Parameters<typeof ensureDaemon>[0]> = {}) {
  return {
    baseUrl: "http://localhost:42718",
    currentBuild: "b1",
    currentVersion: "v1",
    currentStateDir: "/my/world",
    health: async () =>
      ({ service: "caret", build: "b1", version: "v1", stateDir: "/my/world" }) as {
        service?: string;
        build?: string;
        version?: string;
        stateDir?: string;
      } | null,
    ...ensureDaemonNoOps(),
    ...over,
  };
}

/**
 * A health/retire/spawn trio simulating a stale build (b0) that answers until
 * retired, then a fresh build (b1) that binds once the port frees. `stateDir`,
 * when given, rides both health responses — the world-identity-safe variant of
 * the same scenario.
 */
function staleThenFreshDaemon(stateDir?: string): {
  counts: { retires: number; spawns: number };
  deps: Pick<Parameters<typeof ensureDaemon>[0], "health" | "retire" | "spawn">;
} {
  const counts = { retires: 0, spawns: 0 };
  const health = (build: string) =>
    stateDir === undefined
      ? { service: "caret", build, version: "v1" }
      : { service: "caret", build, version: "v1", stateDir };
  return {
    counts,
    deps: {
      health: async () => {
        if (counts.retires === 0) return health("b0");
        if (counts.spawns === 0) return null;
        return health("b1");
      },
      retire: async () => {
        counts.retires++;
        return true;
      },
      spawn: () => counts.spawns++,
    },
  };
}

test("ensureDaemon returns immediately when the daemon is already healthy", async () => {
  let spawns = 0;
  const url = await ensureDaemon(ensureDeps({ spawn: () => spawns++ }));
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(0);
});

test("ensureDaemon spawns when the port is refused, then connects", async () => {
  let spawns = 0;
  let checks = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
      spawn: () => spawns++,
    }),
  );
  expect(spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

test("ensureDaemon throws a clear error when a non-caret process holds the port", async () => {
  await expect(
    ensureDaemon(ensureDeps({ health: async () => ({ service: "other" }) })),
  ).rejects.toThrow(/CARET_PORT/);
});

test("ensureDaemon swallows an EADDRINUSE spawn race and connects to the winner", async () => {
  let checks = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
      spawn: () => {
        const e = new Error("listen EADDRINUSE") as Error & { code?: string };
        e.code = "EADDRINUSE";
        throw e;
      },
    }),
  );
  expect(url).toBe("http://localhost:42718");
});

test("ensureDaemon gives up after maxAttempts", async () => {
  await expect(
    ensureDaemon(ensureDeps({ health: async () => null, maxAttempts: 3 })),
  ).rejects.toThrow();
});

test("ensureDaemon logs the spawn attempt at debug", async () => {
  setLogLevel("debug");
  let checks = 0;
  await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
    }),
  );
  const recs = caretLogRecords().filter((r) => r.step === "spawn");
  expect(recs.some((r) => r.msg === "daemon spawned")).toBe(true);
});

test("ensureDaemon logs the stale-daemon retire at debug", async () => {
  setLogLevel("debug");
  const { deps } = staleThenFreshDaemon();
  await ensureDaemon(ensureDeps(deps));
  const recs = caretLogRecords().filter((r) => r.step === "retire");
  expect(recs.some((r) => r.msg === "stale daemon retiring")).toBe(true);
});

test("ensureDaemon logs orphan-lock removal at debug", async () => {
  setLogLevel("debug");
  let checks = 0;
  await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
      readLock: () => ({ pid: 4_000_000, port: 42718 }),
      isAlive: () => false,
    }),
  );
  const recs = caretLogRecords().filter((r) => r.step === "spawn");
  expect(recs.some((r) => r.msg === "orphan daemon lock removed")).toBe(true);
});

// ---- ensureDaemon: single-instance discovery + graceful takeover (EXC-406) ----

test("ensureDaemon reuses a same-build daemon (no spawn, no retire)", async () => {
  let spawns = 0;
  let retires = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => ({ service: "caret", build: "b1", version: "v1" }),
      spawn: () => spawns++,
      retire: async () => {
        retires++;
        return true;
      },
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(0);
  expect(retires).toBe(0);
});

// `takeover: false` is what a mid-review reconnect passes. The daemon answering may
// be a NEWER build that took the port during an upgrade; retiring it would put this
// (older) client's build back in charge, and since a reconnect repeats on every
// dropped poll it would keep undoing the upgrade. Falsifiable: with the flag ignored,
// the daemon is retired on every attempt until maxAttempts, so `retires` climbs off 0.
test("ensureDaemon with takeover:false attaches to a different-build daemon", async () => {
  let retires = 0;
  let spawns = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => ({ service: "caret", build: "b2", version: "v2", stateDir: "/my/world" }),
      retire: async () => {
        retires++;
        return true;
      },
      spawn: () => spawns++,
    }),
    { takeover: false },
  );
  expect(url).toBe("http://localhost:42718");
  expect(retires).toBe(0);
  expect(spawns).toBe(0);
});

// Attaching is not "never spawn": a daemon that died with nothing replacing it leaves
// the review unservable, and this client is then the only candidate.
test("ensureDaemon with takeover:false still spawns when nothing holds the port", async () => {
  let spawns = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => (spawns === 0 ? null : { service: "caret", build: "b1", version: "v1" }),
      spawn: () => spawns++,
    }),
    { takeover: false },
  );
  expect(spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

// The foreign-world refusal outranks attaching: cross-attaching another world's
// daemon writes this world's reviews into its state dir (EXC-461).
test("ensureDaemon with takeover:false still refuses a foreign world", async () => {
  await expect(
    ensureDaemon(
      ensureDeps({
        health: async () => ({
          service: "caret",
          build: "b2",
          version: "v2",
          stateDir: "/other/world",
        }),
      }),
      { takeover: false },
    ),
  ).rejects.toThrow(/different caret world/);
});

test("ensureDaemon retires a stale-build daemon, then reuses the fresh respawn", async () => {
  const { counts, deps } = staleThenFreshDaemon();
  const url = await ensureDaemon(ensureDeps(deps));
  expect(counts.retires).toBe(1);
  expect(counts.spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

test("ensureDaemon treats a version mismatch as stale even when the build matches", async () => {
  let retires = 0;
  await ensureDaemon(
    ensureDeps({
      health: async () => ({ service: "caret", build: "b1", version: "v0" }),
      retire: async () => {
        retires++;
        return true;
      },
      maxAttempts: 1,
    }),
  );
  expect(retires).toBe(1);
});

test("ensureDaemon removes an orphan lock (dead PID) before spawning", async () => {
  let removed = 0;
  let spawns = 0;
  let checks = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () =>
        ++checks === 1 ? null : { service: "caret", build: "b1", version: "v1" },
      readLock: () => ({ pid: 999999, port: 42718 }),
      isAlive: () => false,
      removeLock: () => removed++,
      spawn: () => spawns++,
    }),
  );
  expect(removed).toBe(1);
  expect(spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

test("a stale daemon that cannot be retired is reused, never denied", async () => {
  let retires = 0;
  // A pre-fix daemon: no /api/retire and no lock, so retire can do nothing (false).
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => ({ service: "caret", build: "b0", version: "v0" }),
      retire: async () => {
        retires++;
        return false;
      },
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect(retires).toBe(1);
});

// ---- ensureDaemon: world identity — no cross-world attach (EXC-461) ----

test("ensureDaemon throws on a foreign-world daemon, never retires or spawns", async () => {
  let retires = 0;
  let spawns = 0;
  await expect(
    ensureDaemon(
      ensureDeps({
        health: async () => ({
          service: "caret",
          build: "b1",
          version: "v1",
          stateDir: "/other/world",
        }),
        retire: async () => {
          retires++;
          return true;
        },
        spawn: () => spawns++,
      }),
    ),
  ).rejects.toThrow(/different caret world/);
  expect(retires).toBe(0);
  expect(spawns).toBe(0);
});

test("ensureDaemon reuses a same-world same-build daemon", async () => {
  let spawns = 0;
  const url = await ensureDaemon(ensureDeps({ spawn: () => spawns++ }));
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(0);
});

test("ensureDaemon retires a same-world stale daemon (EXC-406 preserved)", async () => {
  const { counts, deps } = staleThenFreshDaemon("/my/world");
  const url = await ensureDaemon(ensureDeps(deps));
  expect(counts.retires).toBe(1);
  expect(counts.spawns).toBe(1);
  expect(url).toBe("http://localhost:42718");
});

test("the never-deny fallback refuses a foreign-world daemon", async () => {
  let calls = 0;
  await expect(
    ensureDaemon(
      ensureDeps({
        maxAttempts: 2,
        // Refused throughout the loop; a foreign daemon answers only at the
        // exhausted-fallback health check.
        health: async () =>
          ++calls <= 2
            ? null
            : { service: "caret", build: "b1", version: "v1", stateDir: "/other/world" },
      }),
    ),
  ).rejects.toThrow(/different caret world/);
});

test("the never-deny fallback still reuses a same-world stale daemon", async () => {
  let calls = 0;
  const url = await ensureDaemon(
    ensureDeps({
      maxAttempts: 2,
      health: async () =>
        ++calls <= 2
          ? null
          : { service: "caret", build: "b9", version: "v9", stateDir: "/my/world" },
    }),
  );
  expect(url).toBe("http://localhost:42718");
});

// ---- ensureDaemon under this world's supervisor (EXC-1166) ----

/** A resident same-world daemon of another build (b0). */
function peer(instanceId: string, over: Partial<HealthBody> = {}): HealthBody {
  return {
    service: "caret",
    build: "b0",
    version: "v1",
    stateDir: "/my/world",
    resident: true,
    instanceId,
    ...over,
  };
}

/** A health probe answering with whatever `next()` returns, recording each answer. */
function recordingHealth(next: () => HealthBody | null) {
  const served: (HealthBody | null)[] = [];
  const health = async () => {
    const h = next();
    served.push(h);
    return h;
  };
  return { served, health };
}

/** This world's supervisor, its unit installed and running unless a case says otherwise. */
const supervisor = (over: Parameters<typeof fakeServiceManager>[0] = {}) =>
  fakeServiceManager({ status: { installed: true, running: true }, ...over });

test("a resident peer's service is cycled, and the hook attaches to its successor", async () => {
  const { calls, manager: service } = supervisor();
  let retires = 0;
  let spawns = 0;
  // After the cycle the outgoing daemon answers once more while it drains, the port
  // goes quiet, then the supervisor's new daemon binds — of whatever build the launcher
  // resolved, which the hook attaches to rather than cycling a second time.
  const afterCycle: (HealthBody | null)[] = [peer("old"), null];
  const { served, health } = recordingHealth(() =>
    !calls.includes("restart")
      ? peer("old")
      : afterCycle.length > 0
        ? (afterCycle.shift() ?? null)
        : peer("new", { build: "b2" }),
  );
  const url = await ensureDaemon(
    ensureDeps({
      service,
      health,
      retire: async () => {
        retires++;
        return true;
      },
      spawn: () => spawns++,
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect({ calls, retires, spawns }).toEqual({ calls: ["restart"], retires: 0, spawns: 0 });
  expect(served.at(-1)?.instanceId).toBe("new");
});

// The launcher execs the highest installed caret, so cycling a daemon newer than this
// hook brings that same build back under a new instance — on every call such a hook
// makes. OpenCode's pinned plugin, or a session that outlived an update, is that hook.
test("a hook older than the resident daemon attaches instead of cycling it", async () => {
  const { calls, manager: service } = supervisor();
  let retires = 0;
  const url = await ensureDaemon(
    ensureDeps({
      service,
      currentVersion: "0.16.0",
      health: async () => peer("newer", { version: "0.17.0" }),
      retire: async () => {
        retires++;
        return true;
      },
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect({ calls, retires }).toEqual({ calls: [], retires: 0 });
});

// A restart that answers with nothing new leaves the stale daemon on the port; serving it
// beats denying the review over a takeover that did not happen.
test("a cycle that never takes effect leaves the stale daemon serving", async () => {
  const { calls, manager: service } = supervisor();
  let retires = 0;
  let spawns = 0;
  const url = await ensureDaemon(
    ensureDeps({
      service,
      health: async () => peer("old"),
      retire: async () => {
        retires++;
        return true;
      },
      spawn: () => spawns++,
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect({ calls, retires, spawns }).toEqual({ calls: ["restart"], retires: 0, spawns: 0 });
});

// `systemctl restart` stops the unit before it starts it, so a start the unit's start
// limit refuses fails with the daemon already gone.
test("a restart that stops the daemon and then fails is followed by a spawn", async () => {
  let stopped = false;
  let spawns = 0;
  const { manager: service } = supervisor({
    restart: async () => {
      stopped = true;
      throw new Error("systemctl restart failed: start-limit-hit");
    },
  });
  const url = await ensureDaemon(
    ensureDeps({
      service,
      health: async () =>
        spawns > 0
          ? peer("spawned", { build: "b1", resident: false })
          : stopped
            ? null
            : peer("old"),
      spawn: () => spawns++,
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(1);
});

// A reconnecting client may be an old build whose review outlived an upgrade; cycling
// the service for it is the same mistake as retiring the daemon (see EnsureOptions).
test("takeover:false attaches to a resident peer without cycling its service", async () => {
  const { calls, manager: service } = supervisor();
  const url = await ensureDaemon(ensureDeps({ service, health: async () => peer("old") }), {
    takeover: false,
  });
  expect(url).toBe("http://localhost:42718");
  expect(calls).toEqual([]);
});

// Only a peer that says it is resident is the supervised one. Anything else holding the
// port — a build that predates residency, or a hook's idle-exiting fallback — is retired,
// and the port is left to the supervisor, which is already restarting on its throttle.
// Cycling the service would not free a port someone else holds.
test.each<[string, Partial<HealthBody>]>([
  ["a peer that predates residency", { resident: undefined }],
  ["an idle-exiting peer", { resident: false }],
])("%s is retired and the port left to the supervised daemon", async (_title, over) => {
  const { calls, manager: service } = supervisor();
  let retires = 0;
  let spawns = 0;
  let refusals = 0;
  const url = await ensureDaemon(
    ensureDeps({
      service,
      health: async () => {
        if (retires === 0) return peer("old", over);
        if (++refusals <= 2) return null;
        return peer("supervised", { build: "b1" });
      },
      retire: async () => {
        retires++;
        return true;
      },
      spawn: () => spawns++,
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect({ calls, retires, spawns }).toEqual({ calls: [], retires: 1, spawns: 0 });
});

// A dev or test world installed no supervisor of its own — the machine's one belongs to
// another world — so it replaces its peer however that peer describes itself.
test("with no supervisor, a resident peer is retired and the freed port spawned into at once", async () => {
  let retires = 0;
  let spawns = 0;
  let refusals = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => {
        if (retires === 0) return peer("old");
        if (spawns === 0) {
          refusals++;
          return null;
        }
        return peer("spawned", { build: "b1", resident: false });
      },
      retire: async () => {
        retires++;
        return true;
      },
      spawn: () => spawns++,
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect({ retires, spawns, refusals }).toEqual({ retires: 1, spawns: 1, refusals: 1 });
});

test("a foreign world's resident daemon is refused before the service is touched", async () => {
  const { calls, manager: service } = supervisor();
  let retires = 0;
  await expect(
    ensureDaemon(
      ensureDeps({
        service,
        health: async () => peer("theirs", { stateDir: "/other/world" }),
        retire: async () => {
          retires++;
          return true;
        },
      }),
    ),
  ).rejects.toThrow(/different caret world/);
  expect({ calls, retires }).toEqual({ calls: [], retires: 0 });
});

// The fallback spawn inherits the hook's environment, which carries no CARET_SUPERVISED,
// so the daemon it starts idle-exits and hands the port back to the supervisor.
test("a cycle whose daemon never returns falls back to a spawn that does not claim residency", async () => {
  const { calls, manager: service } = supervisor();
  let spawnedEnv: NodeJS.ProcessEnv | undefined;
  const fakeSpawn = ((_argv: string[], opts: { env?: NodeJS.ProcessEnv; stdio?: unknown[] }) => {
    spawnedEnv = { ...opts.env };
    const out = opts.stdio?.[1];
    if (typeof out === "number") closeSync(out);
    return { unref: () => {} };
  }) as unknown as typeof Bun.spawn;
  const { served, health } = recordingHealth(() => {
    if (!calls.includes("restart")) return peer("old");
    if (spawnedEnv === undefined) return null;
    return peer("fallback", { build: "b1", resident: isResident(DEFAULTS, spawnedEnv) });
  });
  const url = await withEnv({ [SUPERVISED_VAR]: undefined }, () =>
    ensureDaemon(
      ensureDeps({
        service,
        health,
        spawn: () => spawnDaemon(DEFAULTS, fakeSpawn),
      }),
    ),
  );
  expect(url).toBe("http://localhost:42718");
  expect(calls).toEqual(["restart"]);
  expect(served.at(-1)?.resident).toBe(false);
});

test("a service that will not restart leaves the resident peer serving", async () => {
  const { manager: service } = supervisor({
    restart: async () => {
      throw new Error("launchctl kickstart failed: exit 113");
    },
  });
  let retires = 0;
  let spawns = 0;
  const url = await ensureDaemon(
    ensureDeps({
      service,
      health: async () => peer("old"),
      retire: async () => {
        retires++;
        return true;
      },
      spawn: () => spawns++,
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect({ retires, spawns }).toEqual({ retires: 0, spawns: 0 });
  expect(caretLogRecords().some((r) => r.step === "service" && r.level === 40)).toBe(true);
});

test("an empty port under a supervisor is left to the supervised daemon", async () => {
  const { calls, manager: service } = supervisor();
  let probes = 0;
  let spawns = 0;
  const url = await ensureDaemon(
    ensureDeps({
      service,
      // The launcher may resolve another build than this hook's; the hook attaches to
      // it rather than cycling the service again.
      health: async () => (++probes <= 3 ? null : peer("supervised", { build: "b2" })),
      spawn: () => spawns++,
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect({ calls, spawns }).toEqual({ calls: [], spawns: 0 });
});

// A service record can outlive a running supervisor: the user turned caret off in Login
// Items or `systemctl --user disable`, the launcher booted the agent out after a terminal
// failure, or systemd parked the unit after one. Waiting on a supervisor that is not
// coming would stall every cold hook.
test.each<[string, ServiceManager["status"]]>([
  ["turned off by the user", async () => ({ installed: true, running: false, disabled: true })],
  ["not loaded", async () => ({ installed: false, running: false, disabled: false })],
  [
    "parked by systemd after a terminal exit",
    async () => ({ installed: true, running: false, disabled: false, failed: true }),
  ],
  [
    "unreadable",
    async () => {
      throw new Error("launchctl print failed: exit 113");
    },
  ],
])(
  "an empty port under a supervisor that is %s is spawned into at once",
  async (_title, status) => {
    const { manager: service } = supervisor({ status });
    let refusals = 0;
    let spawns = 0;
    await ensureDaemon(
      ensureDeps({
        service,
        health: async () => {
          if (spawns > 0) return peer("spawned", { build: "b1", resident: false });
          refusals++;
          return null;
        },
        spawn: () => spawns++,
      }),
    );
    expect({ refusals, spawns }).toEqual({ refusals: 1, spawns: 1 });
  },
);

// Each read spawns launchctl or systemctl processes, on the path a cold hook waits on.
test("the supervisor's status is read once per call", async () => {
  const { statusReads, manager: service } = supervisor({
    status: async () => ({ installed: true, running: false, disabled: true }),
  });
  let probes = 0;
  await ensureDaemon(
    ensureDeps({
      service,
      health: async () =>
        ++probes <= 3 ? null : peer("spawned", { build: "b1", resident: false }),
    }),
  );
  expect(statusReads()).toBe(1);
});

// ---- ensureDaemon after a draining daemon refused a review ----

// The refusing daemon keeps answering while it drains, and it may be this very build, so
// the same-build check alone would hand it straight back to be refused again.
test("draining: waits past the refusing instance to its supervised successor", async () => {
  const { manager: service } = supervisor();
  let spawns = 0;
  const drain: (HealthBody | null)[] = [
    peer("draining", { build: "b1" }),
    peer("draining", { build: "b1" }),
    null,
  ];
  const { served, health } = recordingHealth(() =>
    drain.length > 0 ? (drain.shift() ?? null) : peer("successor", { build: "b1" }),
  );
  const url = await ensureDaemon(ensureDeps({ service, health, spawn: () => spawns++ }), {
    takeover: false,
    draining: true,
  });
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(0);
  expect(served.at(-1)?.instanceId).toBe("successor");
});

// The drain wait is the supervisor's one window for the call, whatever `takeover` says.
test("draining: a resident successor of another build is attached, not cycled", async () => {
  const { calls, manager: service } = supervisor();
  const drain: (HealthBody | null)[] = [peer("draining", { build: "b1" }), null];
  const { served, health } = recordingHealth(() =>
    drain.length > 0 ? (drain.shift() ?? null) : peer("successor", { build: "b2" }),
  );
  await ensureDaemon(ensureDeps({ service, health }), { draining: true });
  expect(calls).toEqual([]);
  expect(served.at(-1)?.instanceId).toBe("successor");
});

// With no supervisor there is no one else to bind the freed port, so the hook spawns
// into it straight away rather than waiting out the budget first.
test("draining with no supervisor: spawns as soon as the refusing instance frees the port", async () => {
  let spawns = 0;
  let drainProbes = 0;
  let refusals = 0;
  const { served, health } = recordingHealth(() => {
    if (spawns > 0) return peer("spawned", { build: "b1", resident: false });
    if (++drainProbes <= 2) return peer("draining", { build: "b1", resident: false });
    refusals++;
    return null;
  });
  const url = await ensureDaemon(ensureDeps({ maxAttempts: 12, health, spawn: () => spawns++ }), {
    takeover: false,
    draining: true,
  });
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(1);
  expect(served.at(-1)?.instanceId).toBe("spawned");
  expect(refusals).toBeLessThanOrEqual(2);
});

// The refusal only ever names the daemon that was answering then. Once the port has been
// seen empty, whatever binds next is the successor, not another instance to wait past.
test("draining: a port already freed is a cold start, attached on its first answer", async () => {
  let spawns = 0;
  const { served, health } = recordingHealth(() =>
    spawns > 0 ? peer("spawned", { build: "b1", resident: false }) : null,
  );
  const url = await ensureDaemon(ensureDeps({ health, spawn: () => spawns++ }), {
    takeover: false,
    draining: true,
  });
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(1);
  expect(served.filter((h) => h?.instanceId === "spawned")).toHaveLength(1);
});

// ---- ensureDaemon's overall time bound ----

/** A clock that moves a second per backoff, over more attempts than the deadline allows,
 * so only the deadline can end the call. */
function steppedClock() {
  let t = 0;
  return {
    elapsed: () => t,
    deps: {
      now: () => t,
      backoff: async () => {
        t += 1_000;
      },
      maxAttempts: 50,
      windowMs: 10_000,
    },
  };
}

// A hook killed by its own timeout leaves the review nothing at all, so every way the
// call can wait has to fit one deadline — the fallback spawn's attempts included.
test.each<[string, EnsureOptions, (calls: string[]) => () => HealthBody | null]>([
  [
    "a cycled service that never brings a daemon back",
    {},
    (calls) => () => (calls.includes("restart") ? null : peer("old")),
  ],
  ["an empty port the supervisor never fills", {}, () => () => null],
  [
    "a drain whose successor never comes",
    { draining: true },
    () => {
      let probes = 0;
      return () => (++probes === 1 ? peer("draining") : null);
    },
  ],
])("%s ends by the call's deadline", async (_title, opts, answers) => {
  const clock = steppedClock();
  const { calls, manager: service } = supervisor();
  const next = answers(calls);
  await expect(
    ensureDaemon(ensureDeps({ ...clock.deps, service, health: async () => next() }), opts),
  ).rejects.toThrow();
  expect(clock.elapsed()).toBeLessThanOrEqual(clock.deps.windowMs + SPAWN_RESERVE_MS + 1_000);
});

test("a supervisor window that runs out still leaves the fallback spawn its turn", async () => {
  const clock = steppedClock();
  const { manager: service } = supervisor();
  const spawnedAt: number[] = [];
  const url = await ensureDaemon(
    ensureDeps({
      ...clock.deps,
      service,
      health: async () =>
        spawnedAt.length > 0 ? peer("spawned", { build: "b1", resident: false }) : null,
      spawn: () => void spawnedAt.push(clock.elapsed()),
    }),
  );
  expect(url).toBe("http://localhost:42718");
  expect(spawnedAt).toHaveLength(1);
  expect(spawnedAt[0]).toBeGreaterThanOrEqual(clock.deps.windowMs);
});

// ---- prodEnsureDeps ----

// The supervisor is machine-wide — one constant label — so a dev or test world with its
// own XDG_STATE_HOME must never cycle it. Only the world whose install wrote the
// launcher's service record owns it.
test("prodEnsureDeps wires the supervisor only into the world that installed it", async () => {
  const { manager: service } = supervisor();
  let built = 0;
  const manager = () => {
    built++;
    return service;
  };
  expect((await prodEnsureDeps(DEFAULTS, manager)).service).toBeUndefined();
  expect(built).toBe(0);

  mkdirSync(dirname(launcherServiceFile()), { recursive: true });
  writeFileSync(launcherServiceFile(), "caret.service\n");
  expect((await prodEnsureDeps(DEFAULTS, manager)).service).toBe(service);
});

// ---- retireDaemon: SIGTERM fallback is gated on the lock's world (EXC-461) ----

// http://127.0.0.1:1 — nothing listens there, so the /api/retire attempt fails
// fast and the SIGTERM fallback is what's under test. The injected kill spy
// keeps the test from signaling anything real; pid is our own (always alive).

test("retireDaemon does not SIGTERM a foreign world's lock pid", async () => {
  let kills = 0;
  const ok = await retireDaemon(
    "http://127.0.0.1:1",
    { pid: process.pid, port: 1, stateDir: "/other/world" },
    "/my/world",
    () => kills++,
  );
  expect(ok).toBe(false);
  expect(kills).toBe(0);
});

test("retireDaemon SIGTERMs a same-world lock pid", async () => {
  let kills = 0;
  const ok = await retireDaemon(
    "http://127.0.0.1:1",
    { pid: process.pid, port: 1, stateDir: "/my/world" },
    "/my/world",
    () => kills++,
  );
  expect(ok).toBe(true);
  expect(kills).toBe(1);
});

test("retireDaemon treats a legacy lock (no stateDir) as same-world", async () => {
  let kills = 0;
  const ok = await retireDaemon(
    "http://127.0.0.1:1",
    { pid: process.pid, port: 1 },
    "/my/world",
    () => kills++,
  );
  expect(ok).toBe(true);
  expect(kills).toBe(1);
});

// ---- openDaemonStderr (EXC-1068) ----

test("openDaemonStderr creates daemon-stderr.log at 0600 inside logs/", () => {
  const fd = openDaemonStderr(DEFAULTS);
  expect(fd).not.toBe("ignore");
  closeSync(fd as number);
  expect(statSync(daemonStderrLogFile()).mode & 0o777).toBe(0o600);
});

test("openDaemonStderr tightens an upgraded install's world-readable stderr log", () => {
  ensureLogsDir();
  writeFileSync(daemonStderrLogFile(), "old crash output\n", { mode: 0o644 });
  // openSync's mode argument only applies on create, so an existing file needs
  // the explicit chmod — without it an upgrade keeps the umask-derived mode.
  closeSync(openDaemonStderr(DEFAULTS) as number);
  expect(statSync(daemonStderrLogFile()).mode & 0o777).toBe(0o600);
});

test("openDaemonStderr rotates an oversized stderr log before reopening it", () => {
  ensureLogsDir();
  writeFileSync(daemonStderrLogFile(), "x".repeat(200_000));
  const s = { ...DEFAULTS, logging: { ...DEFAULTS.logging, max_size: 65_536 } };
  closeSync(openDaemonStderr(s) as number);
  expect(statSync(daemonStderrLogFile()).size).toBe(0);
  expect(readdirSync(logArchiveDir())).toEqual([
    expect.stringMatching(/^daemon-stderr-.*\.log\.gz$/),
  ]);
});

// ---- rotateDaemonStderr (EXC-1164) ----

test("rotateDaemonStderr archives an oversized stderr log in place", () => {
  ensureLogsDir();
  writeFileSync(daemonStderrLogFile(), "x".repeat(200_000));
  const s = { ...DEFAULTS, logging: { ...DEFAULTS.logging, max_size: 65_536 } };
  rotateDaemonStderr(s);
  expect(statSync(daemonStderrLogFile()).size).toBe(0);
  expect(readdirSync(logArchiveDir())).toEqual([
    expect.stringMatching(/^daemon-stderr-.*\.log\.gz$/),
  ]);
});

// ---- daemon cwd (EXC-1155) ----

// A Bun process whose cwd has been unlinked cannot posix_spawn anything at all,
// absolute paths included — the failure that stranded daemons started inside an
// exec worktree later torn down with its PR. Run in a subprocess because it
// chdir()s into a directory it then deletes. Only the positive direction is
// asserted: that the *unset*-cwd spawn fails is a Bun behaviour unconfirmed off
// macOS, while an explicit live cwd surviving is the contract DAEMON_CWD buys.
const DEAD_CWD_PROBE = `
const { existsSync, mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const dir = mkdtempSync(join(tmpdir(), "caret-dead-cwd-"));
process.chdir(dir);
rmSync(dir, { recursive: true, force: true });
// Fail loudly rather than passing vacuously if the cwd outlived the unlink.
if (existsSync(dir)) process.exit(3);
const proc = Bun.spawn([process.execPath, "--version"], { cwd: process.argv[1], stdout: "ignore" });
process.exit(await proc.exited);
`;

test("a spawn from DAEMON_CWD survives the spawning process losing its own cwd", async () => {
  const probe = Bun.spawn([process.execPath, "-e", DEAD_CWD_PROBE, DAEMON_CWD], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  expect(await probe.exited).toBe(0);
});

test("spawnDaemon pins the daemon's cwd to DAEMON_CWD", () => {
  const calls: Array<{ cwd?: string; stdio?: unknown[] }> = [];
  const spawn = ((_argv: string[], opts: { cwd?: string; stdio?: unknown[] }) => {
    calls.push(opts);
    return { unref: () => {} };
  }) as unknown as typeof Bun.spawn;

  spawnDaemon(DEFAULTS, spawn);

  expect(calls).toHaveLength(1);
  expect(calls[0]?.cwd).toBe(DAEMON_CWD);
  // The pin only buys anything if that directory outlives every project dir.
  expect(existsSync(DAEMON_CWD)).toBe(true);
  // openDaemonStderr handed the fake a real fd, as the sibling tests above do.
  const out = calls[0]?.stdio?.[1];
  if (typeof out === "number") closeSync(out);
});

// ---- removeOwnDaemonLock ----

// A daemon tearing ITSELF down must remove its own lock and nothing else: the
// path may hold the lock of whichever daemon won the port race, and unlinking
// that one strands a live daemon nothing can find. The ownership check is what
// lets the cleanup be wired BEFORE the bind, closing the signal window in
// runDaemon.
test("removeOwnDaemonLock removes a lock naming this process", () => {
  mkdirSync(dirname(daemonLock()), { recursive: true });
  writeFileSync(daemonLock(), JSON.stringify({ pid: process.pid, port: 42718 }));
  removeOwnDaemonLock();
  expect(existsSync(daemonLock())).toBe(false);
});

test("removeOwnDaemonLock keeps a lock naming another process", () => {
  mkdirSync(dirname(daemonLock()), { recursive: true });
  writeFileSync(daemonLock(), JSON.stringify({ pid: process.pid + 1, port: 42718 }));
  removeOwnDaemonLock();
  expect(existsSync(daemonLock())).toBe(true);
  unlinkSync(daemonLock());
});

test("removeOwnDaemonLock tolerates a missing or unreadable lock", () => {
  mkdirSync(dirname(daemonLock()), { recursive: true });
  expect(() => removeOwnDaemonLock()).not.toThrow();
  writeFileSync(daemonLock(), "{ not json");
  expect(() => removeOwnDaemonLock()).not.toThrow();
  expect(existsSync(daemonLock())).toBe(true);
  unlinkSync(daemonLock());
});
