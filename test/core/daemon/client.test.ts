// Unit coverage for src/daemon/client.ts: waitForHealth (the dev driver's bounded
// wait), postReview's refusals, and the state dir's token on every request. Driven
// against a real in-process server so each wrapper exercises its actual fetch;
// waitForHealth takes an injected sleep so no real time passes.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { setupTempStateDir } from "@test/support/env.ts";
import { daemonTokenFile } from "@/config/paths.ts";
import {
  DaemonAuthError,
  expireReview,
  httpHealth,
  listReviews,
  longPoll,
  postReview,
  resolveReview,
  waitForHealth,
} from "@/daemon/client.ts";

const servers: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.stop();
});

const noSleep = async () => {};

test("waitForHealth resolves once the server reports the caret identity", async () => {
  const srv = Bun.serve({
    port: 0,
    fetch: () => Response.json({ service: "caret" }),
  });
  servers.push(srv);
  await expect(
    waitForHealth(`http://localhost:${srv.port}`, { sleep: noSleep }),
  ).resolves.toBeUndefined();
});

test("waitForHealth retries until the server starts answering, then resolves", async () => {
  let healthy = false;
  const srv = Bun.serve({
    port: 0,
    fetch: () =>
      healthy ? Response.json({ service: "caret" }) : new Response("warming", { status: 503 }),
  });
  servers.push(srv);
  // Flip to healthy after a couple of probes; the injected sleep advances the
  // loop without real waits.
  let probes = 0;
  const sleep = async () => {
    if (++probes >= 2) healthy = true;
  };
  await expect(
    waitForHealth(`http://localhost:${srv.port}`, { sleep, attempts: 10 }),
  ).resolves.toBeUndefined();
});

test("waitForHealth throws after exhausting attempts against a non-caret server", async () => {
  const srv = Bun.serve({
    port: 0,
    fetch: () => Response.json({ service: "not-caret" }),
  });
  servers.push(srv);
  await expect(
    waitForHealth(`http://localhost:${srv.port}`, { sleep: noSleep, attempts: 3 }),
  ).rejects.toThrow(/did not become healthy/);
});

test("waitForHealth bounds its attempts (a dead address gives up, not loops forever)", async () => {
  // Nothing listening: every probe's connection is refused (httpHealth → null).
  let probes = 0;
  const sleep = async () => {
    probes++;
  };
  await expect(waitForHealth("http://127.0.0.1:1", { sleep, attempts: 5 })).rejects.toThrow(
    /did not become healthy/,
  );
  // attempts probes, one sleep between each pair that fails (the loop sleeps
  // after every failed probe, including the last).
  expect(probes).toBe(5);
});

test("postReview reads a draining daemon's 503 as no review created", async () => {
  const srv = Bun.serve({ port: 0, fetch: () => new Response("draining", { status: 503 }) });
  servers.push(srv);
  expect(await postReview(`http://localhost:${srv.port}`, { plan: "# P" })).toBeNull();
});

test("postReview rejects any other failed status", async () => {
  const srv = Bun.serve({ port: 0, fetch: () => new Response("boom", { status: 500 }) });
  servers.push(srv);
  await expect(postReview(`http://localhost:${srv.port}`, { plan: "# P" })).rejects.toThrow(/500/);
});

function serveStatus(status: number, seen: string[] = []): string {
  const srv = Bun.serve({
    port: 0,
    fetch: (req) => {
      seen.push(new URL(req.url).search);
      return new Response(null, { status });
    },
  });
  servers.push(srv);
  return `http://localhost:${srv.port}`;
}

test("longPoll names its version and reads a 409 as superseded", async () => {
  const seen: string[] = [];
  expect(await longPoll(serveStatus(409, seen), "r1", 1)).toBe("superseded");
  expect(seen).toEqual(["?version=1"]);
});

test("expireReview names its version and treats a 409 as nothing left to expire", async () => {
  const seen: string[] = [];
  await expireReview(serveStatus(409, seen), "r1", 1);
  expect(seen).toEqual(["?version=1"]);
});

test("a call without a version sends no version query", async () => {
  const seen: string[] = [];
  await expireReview(serveStatus(404, seen), "r1", undefined);
  expect(seen).toEqual([""]);
});

describe("daemon requests carry the state dir's token", () => {
  setupTempStateDir("caret-client-");
  const TOKEN = "s3cret-token";
  const writeToken = () => {
    mkdirSync(dirname(daemonTokenFile()), { recursive: true });
    writeFileSync(daemonTokenFile(), `${TOKEN}\n`);
  };
  const calls: Array<[string, (base: string) => Promise<unknown>]> = [
    ["httpHealth", (b) => httpHealth(b)],
    ["postReview", (b) => postReview(b, { plan: "# P" })],
    ["expireReview", (b) => expireReview(b, "r1", 1)],
    ["longPoll", (b) => longPoll(b, "r1", 1)],
    ["listReviews", (b) => listReviews(b)],
    ["resolveReview", (b) => resolveReview(b, "r1", { behavior: "allow" })],
  ];

  function serveAuth(status: number, seen: Array<string | null>, challenge = true): string {
    const srv = Bun.serve({
      port: 0,
      fetch: (req) => {
        seen.push(req.headers.get("authorization"));
        if (status === 200) return Response.json({});
        const headers = challenge ? { "WWW-Authenticate": 'Bearer realm="caret"' } : undefined;
        return new Response(null, { status, headers });
      },
    });
    servers.push(srv);
    return `http://localhost:${srv.port}`;
  }

  test.each(calls)("%s sends the token as a bearer header", async (_, call) => {
    writeToken();
    const seen: Array<string | null> = [];
    await call(serveAuth(200, seen));
    expect(seen).toEqual([`Bearer ${TOKEN}`]);
  });

  test.each(calls)("%s sends no Authorization header without a token file", async (_, call) => {
    const seen: Array<string | null> = [];
    await call(serveAuth(200, seen));
    expect(seen).toEqual([null]);
  });

  test.each(calls)("%s rejects a 401 with an error naming the token file", async (_, call) => {
    writeToken();
    const err = await call(serveAuth(401, [])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DaemonAuthError);
    expect((err as Error).message).toContain(daemonTokenFile());
    expect((err as Error).message).not.toContain(TOKEN);
  });

  test("a 401 without a token file names the missing file", async () => {
    const err = await httpHealth(serveAuth(401, [])).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DaemonAuthError);
    expect((err as Error).message).toContain(daemonTokenFile());
  });

  test("httpHealth resolves null on a 401 that carries no caret challenge", async () => {
    writeToken();
    expect(await httpHealth(serveAuth(401, [], false))).toBeNull();
  });

  test.each(calls.slice(1))(
    "%s treats a 401 with no caret challenge as an ordinary failure",
    async (_, call) => {
      writeToken();
      const err = await call(serveAuth(401, [], false)).catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(DaemonAuthError);
    },
  );

  test("httpHealth still resolves null when nothing answers", async () => {
    writeToken();
    expect(await httpHealth("http://127.0.0.1:1")).toBeNull();
  });
});
