// Unit coverage for src/daemon/client.ts: waitForHealth — the bounded health-wait
// the out-of-process callers (the dev driver, the e2e fixture) share — and how
// postReview reads the daemon's refusals. Driven against a real in-process server
// so each wrapper exercises its actual fetch; waitForHealth takes an injected sleep
// so no real time passes.
import { afterEach, expect, test } from "bun:test";

import { expireReview, longPoll, postReview, waitForHealth } from "@/daemon/client.ts";

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
