import { expect, test } from "bun:test";
import { ensureDaemon, runReview } from "../src/cli.ts";
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

test("a long-poll that fails twice fails safe to deny", async () => {
  const out = await runReview(
    stdin,
    reviewDeps({
      longPoll: async () => {
        throw new Error("connection reset");
      },
    }),
  );
  expect(out.hookSpecificOutput.decision.behavior).toBe("deny");
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
