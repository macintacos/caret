import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CaretServer, createServer } from "../src/daemon.ts";
import { createStore, type Store } from "../src/store.ts";
import { assertDevEnv, DEV_SESSION, postRevision, seedPlan } from "../scripts/dev/driver.ts";

// The fixtures the driver posts — read independently here so the assertions
// don't lean on the driver's own loader.
const PLAN_V1 = await Bun.file(`${import.meta.dir}/../scripts/dev/fake-plan.md`).text();
const PLAN_V2 = await Bun.file(`${import.meta.dir}/../scripts/dev/fake-plan.revised.md`).text();

let dir: string;
let store: Store;
let srv: CaretServer;
let base: string;

// Boot a real in-process daemon (no browser, no spawned process), exactly the
// pattern test/daemon.test.ts uses.
async function boot() {
  store = createStore(dir);
  await store.rehydrate();
  srv = createServer({ store, port: 0, idleMs: 1_000_000, onShutdown: () => {} });
  base = `http://localhost:${srv.port}`;
}

// Simulate the browser's decision (the UI's POST /resolve).
async function resolve(id: string, behavior: "allow" | "deny", feedback?: string) {
  await fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior, feedback }),
  });
}

async function clientReview(id: string) {
  return (await (await fetch(`${base}/api/reviews/${id}`)).json()) as {
    currentPlan: string;
    version: number;
    status: string;
    sessionId: string;
  };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-driver-"));
});
afterEach(async () => {
  srv?.stop();
  await rm(dir, { recursive: true, force: true });
});

test("seedPlan creates one pending review holding the v1 fake plan", async () => {
  await boot();
  const id = await seedPlan(base);
  const r = await clientReview(id);
  expect(r.currentPlan).toBe(PLAN_V1);
  expect(r.version).toBe(1);
  expect(r.status).toBe("pending");
  expect(r.sessionId).toBe(DEV_SESSION);
  const list = (await (await fetch(`${base}/api/reviews`)).json()) as Array<{ id: string }>;
  expect(list.map((x) => x.id)).toEqual([id]);
});

test("on request-changes, postRevision threads v2 into the SAME review via sessionId", async () => {
  await boot();
  const id = await seedPlan(base);
  await resolve(id, "deny", "please revise");
  const revId = await postRevision(base);
  expect(revId).toBe(id); // appended as a new version, not forked into a new review
  const r = await clientReview(revId);
  expect(r.version).toBe(2);
  expect(r.currentPlan).toBe(PLAN_V2);
  expect(r.status).toBe("pending");
});

test("on approve, re-seeding starts a fresh pending review with v1", async () => {
  await boot();
  const id = await seedPlan(base);
  await resolve(id, "allow");
  const nextId = await seedPlan(base); // re-seed is just another seedPlan
  expect(nextId).not.toBe(id); // approval is terminal → a new thread
  const r = await clientReview(nextId);
  expect(r.version).toBe(1);
  expect(r.currentPlan).toBe(PLAN_V1);
  expect(r.status).toBe("pending");
});

test("assertDevEnv requires an explicit dev port + state dir (isolation guard)", () => {
  const savedPort = process.env.CARET_PORT;
  const savedState = process.env.XDG_STATE_HOME;
  try {
    // Missing port → reject.
    delete process.env.CARET_PORT;
    process.env.XDG_STATE_HOME = "/tmp/caret-dev-test";
    expect(() => assertDevEnv()).toThrow();
    // Production default port → reject (never touch the installed caret).
    process.env.CARET_PORT = "42718";
    expect(() => assertDevEnv()).toThrow();
    // Dev port but no isolated state dir → reject.
    process.env.CARET_PORT = "42719";
    delete process.env.XDG_STATE_HOME;
    expect(() => assertDevEnv()).toThrow();
    // Both explicit and non-default → ok.
    process.env.CARET_PORT = "42719";
    process.env.XDG_STATE_HOME = "/tmp/caret-dev-test";
    expect(() => assertDevEnv()).not.toThrow();
  } finally {
    if (savedPort === undefined) delete process.env.CARET_PORT;
    else process.env.CARET_PORT = savedPort;
    if (savedState === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedState;
  }
});
