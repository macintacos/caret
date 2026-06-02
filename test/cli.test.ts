import { afterEach, beforeEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDaemon, runReview } from "../src/cli.ts";
import { logFile } from "../src/paths.ts";
import type { Decision } from "../src/types.ts";

const allow: Decision = { behavior: "allow", decidedAt: 1 };

function reviewDeps(over: Partial<Parameters<typeof runReview>[1]> = {}) {
  return {
    ensureDaemon: async () => "http://x",
    postReview: async () => ({ id: "rid" }),
    longPoll: async () => allow,
    openBrowser: () => {},
    timeoutMs: 1000,
    ...over,
  };
}

const stdin = JSON.stringify({ session_id: "S", cwd: "/p", tool_input: { plan: "# P" } });

// Point the state dir at a throwaway temp dir so deny-path tests append to a
// disposable caret.log instead of the real ~/.local/state/caret.
let stateHome: string;
let savedXdg: string | undefined;
beforeEach(async () => {
  stateHome = await mkdtemp(join(tmpdir(), "caret-cli-"));
  savedXdg = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateHome;
});
afterEach(async () => {
  if (savedXdg === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = savedXdg;
  await rm(stateHome, { recursive: true, force: true });
});

// ---- runReview ----

test("happy path returns an allow hook output", async () => {
  const out = await runReview(stdin, reviewDeps());
  expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
});

test("deny decision passes the feedback through to message", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => ({ behavior: "deny", feedback: "tweak X", decidedAt: 1 }),
    }),
  );
  expect(out.hookSpecificOutput.decision).toMatchObject({
    behavior: "deny",
    message: "tweak X",
  });
});

test("acceptMode passes through to updatedPermissions", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => ({ behavior: "allow", acceptMode: "acceptEdits", decidedAt: 1 }),
    }),
  );
  expect(out.hookSpecificOutput.decision.updatedPermissions?.[0]?.mode).toBe(
    "acceptEdits",
  );
});

test("invalid stdin JSON fails safe to deny (never allow)", async () => {
  const out = await runReview("not json", reviewDeps());
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
});

test("ensureDaemon failure fails safe to deny", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      ensureDaemon: async () => {
        throw new Error("boom");
      },
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
});

test("a never-resolving long-poll times out to deny", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: () => new Promise<Decision>(() => {}),
      timeoutMs: 20,
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
  expect(out.hookSpecificOutput.decision.message).toContain("timed out");
});

test("a dropped long-poll reconnects once then succeeds", async () => {
  let calls = 0;
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => {
        calls++;
        if (calls === 1) throw new Error("connection reset");
        return allow;
      },
    }),
  );
  expect(calls).toBe(2);
  expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
});

test("a 204 heartbeat re-polls until a decision arrives", async () => {
  let calls = 0;
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => {
        calls++;
        return calls < 3 ? null : allow; // two heartbeats, then the decision
      },
    }),
  );
  expect(calls).toBe(3);
  expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
});

test("a transient drop reconnects and keeps polling (no premature deny)", async () => {
  let reconnects = 0;
  let calls = 0;
  const out = await runReview(
    stdin,
    reviewDeps({
      ensureDaemon: async () => {
        reconnects++;
        return "http://x";
      },
      longPoll: async () => {
        calls++;
        if (calls === 1) throw new Error("socket closed");
        return allow;
      },
    }),
  );
  expect(reconnects).toBe(2); // 1 at startup + 1 reconnect after the drop
  expect(out.hookSpecificOutput.decision.behavior).toBe("allow");
});

test("the poll loop is bounded by timeoutMs (endless heartbeats → deny)", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => {
        await Bun.sleep(2); // pace the loop so it isn't a hot spin
        return null; // never decides
      },
      timeoutMs: 30,
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
  expect(out.hookSpecificOutput.decision.message).toContain("timed out");
});

test("an unreachable daemon mid-poll fails safe to deny", async () => {
  let first = true;
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => {
        throw new Error("socket closed");
      },
      ensureDaemon: async () => {
        if (first) {
          first = false;
          return "http://x"; // startup connects
        }
        throw new Error("daemon gone"); // reconnect fails → deny
      },
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
});

test("a failure logs the step + context to caret.log and surfaces the path", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      ensureDaemon: async () => {
        throw new Error("daemon down");
      },
    }),
  );
  // The deny reason points the user at the log.
  expect(out.hookSpecificOutput.decision.message).toContain(logFile());
  // The log captures which step failed, the message, and stdin context.
  const body = readFileSync(logFile(), "utf-8");
  expect(body).toContain("step=ensureDaemon");
  expect(body).toContain("daemon down");
  expect(body).toContain("sessionId=S");
});

test("a failed reconnect logs step=reconnect, not the poll step", async () => {
  let firstEnsure = true;
  await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => {
        throw new Error("socket closed");
      },
      ensureDaemon: async () => {
        if (firstEnsure) {
          firstEnsure = false;
          return "http://x"; // startup connects
        }
        throw new Error("daemon gone"); // reconnect fails → logged
      },
    }),
  );
  const body = readFileSync(logFile(), "utf-8");
  expect(body).toContain("step=reconnect");
  expect(body).not.toContain("step=longPoll");
});

// ---- ensureDaemon ----

function ensureDeps(over: Partial<Parameters<typeof ensureDaemon>[0]> = {}) {
  return {
    baseUrl: "http://localhost:42718",
    health: async () => ({ service: "caret" }) as { service?: string } | null,
    spawn: () => {},
    backoff: async () => {},
    maxAttempts: 5,
    ...over,
  };
}

test("ensureDaemon returns immediately when the daemon is already healthy", async () => {
  let spawns = 0;
  const url = await ensureDaemon(
    ensureDeps({ spawn: () => spawns++ }),
  );
  expect(url).toBe("http://localhost:42718");
  expect(spawns).toBe(0);
});

test("ensureDaemon spawns when the port is refused, then connects", async () => {
  let spawns = 0;
  let checks = 0;
  const url = await ensureDaemon(
    ensureDeps({
      health: async () => (++checks === 1 ? null : { service: "caret" }),
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
      health: async () => (++checks === 1 ? null : { service: "caret" }),
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
