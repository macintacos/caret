// Unit coverage for the consolidated health probe in src/daemon/client.ts:
// waitForHealth — the bounded health-wait the out-of-process callers (the dev
// driver, the e2e fixture) share. Driven against a real in-process server so
// the probe exercises the actual httpHealth fetch, with an injected sleep so no
// real time passes.
import { afterEach, expect, test } from "bun:test";

import { waitForHealth } from "@/daemon/client.ts";

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
