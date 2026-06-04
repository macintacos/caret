import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type CaretServer } from "../src/daemon.ts";
import { type CaretLogger, createDaemonLogger } from "../src/log.ts";
import { VERSION } from "../src/paths.ts";
import { createStore, type Store } from "../src/store.ts";
import { recordingLog } from "./recording-log.ts";

let dir: string;
let store: Store;
let srv: CaretServer;
let base: string;

async function boot(
  opts: {
    idleMs?: number;
    heartbeatMs?: number;
    onShutdown?: () => void;
    log?: CaretLogger;
    routePlan?: Parameters<typeof createServer>[0]["routePlan"];
    lockPath?: string;
    buildId?: string;
    prefsPath?: string;
  } = {},
) {
  store = createStore(dir);
  await store.rehydrate();
  srv = createServer({
    store,
    port: 0,
    prefsPath: opts.prefsPath ?? join(dir, "prefs.json"),
    idleMs: opts.idleMs ?? 1_000_000,
    heartbeatMs: opts.heartbeatMs,
    onShutdown: opts.onShutdown ?? (() => {}),
    log: opts.log,
    routePlan: opts.routePlan,
    lockPath: opts.lockPath,
    buildId: opts.buildId,
  });
  base = `http://localhost:${srv.port}`;
}

async function prefMode(): Promise<string> {
  return ((await (await fetch(`${base}/api/prefs`)).json()) as { approveMode: string }).approveMode;
}

// The prefs write on /resolve is fire-and-forget (off the hook's blocking path),
// so poll briefly for it to land rather than asserting on a single fixed sleep.
async function waitForPrefMode(want: string): Promise<string> {
  let last = "";
  for (let i = 0; i < 20; i++) {
    last = await prefMode();
    if (last === want) return last;
    await Bun.sleep(10);
  }
  return last;
}

async function resolve(id: string, body: Record<string, unknown>) {
  await fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function newReview(body: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "S",
      cwd: "/tmp/p",
      plan: "# Title\n\nbody",
      ...body,
    }),
  });
  return (await res.json()) as { id: string };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-daemon-"));
});
afterEach(async () => {
  srv?.stop();
  await rm(dir, { recursive: true, force: true });
});

test("GET /api/health returns the caret identity signature", async () => {
  await boot();
  const body = await (await fetch(`${base}/api/health`)).json();
  expect(body).toMatchObject({ service: "caret" });
  expect(typeof body.version).toBe("string");
});

// ---- single-instance lock + graceful retire (EXC-406) ----

test("GET /api/health includes the build fingerprint", async () => {
  await boot({ buildId: "build-abc" });
  const body = (await (await fetch(`${base}/api/health`)).json()) as { build?: string };
  expect(body.build).toBe("build-abc");
});

test("the lock file is written on bind with pid/port/build/version", async () => {
  const lockPath = join(dir, "daemon.lock");
  await boot({ lockPath, buildId: "build-abc" });
  const lock = JSON.parse(readFileSync(lockPath, "utf-8")) as Record<string, unknown>;
  expect(lock.pid).toBe(process.pid);
  expect(lock.port).toBe(srv.port);
  expect(lock.build).toBe("build-abc");
  expect(typeof lock.version).toBe("string");
  expect(typeof lock.startedAt).toBe("number");
});

test("stop() removes the lock file", async () => {
  const lockPath = join(dir, "daemon.lock");
  await boot({ lockPath });
  expect(existsSync(lockPath)).toBe(true);
  srv.stop();
  expect(existsSync(lockPath)).toBe(false);
});

test("POST /api/retire returns 200, shuts down, and removes the lock", async () => {
  const lockPath = join(dir, "daemon.lock");
  let shutdowns = 0;
  await boot({ lockPath, onShutdown: () => shutdowns++ });
  const res = await fetch(`${base}/api/retire`, { method: "POST" });
  expect(res.status).toBe(200);
  // The graceful path defers stop()+onShutdown one tick so the 200 flushes first.
  await Bun.sleep(20);
  expect(shutdowns).toBe(1);
  expect(existsSync(lockPath)).toBe(false);
});

test("POST /api/retire from a foreign origin is blocked (403, no shutdown)", async () => {
  const lockPath = join(dir, "daemon.lock");
  let shutdowns = 0;
  await boot({ lockPath, onShutdown: () => shutdowns++ });
  const res = await fetch(`${base}/api/retire`, {
    method: "POST",
    headers: { Origin: "http://evil.com" },
  });
  expect(res.status).toBe(403);
  await Bun.sleep(20);
  expect(shutdowns).toBe(0);
  expect(existsSync(lockPath)).toBe(true);
});

test("idle auto-shutdown removes the lock file", async () => {
  const lockPath = join(dir, "daemon.lock");
  let shutdowns = 0;
  await boot({ lockPath, idleMs: 30, onShutdown: () => shutdowns++ });
  expect(existsSync(lockPath)).toBe(true);
  await Bun.sleep(120);
  expect(shutdowns).toBeGreaterThanOrEqual(1);
  // stop() runs on idle shutdown and must clear the lock (one of the required
  // "every exit path" cases: idle, SIGTERM/SIGINT, uncaught).
  expect(existsSync(lockPath)).toBe(false);
});

test("POST then GET reviews exposes a pending ClientReview", async () => {
  await boot();
  const { id } = await newReview({ plan: "# My Plan\n\ndetails" });
  expect(id).toBeTruthy();

  const list = (await (await fetch(`${base}/api/reviews`)).json()) as Array<{
    id: string;
  }>;
  expect(list.map((r) => r.id)).toContain(id);

  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.currentPlan).toBe("# My Plan\n\ndetails");
  expect(one.version).toBe(1);
  expect(one.title).toBe("My Plan");
  expect(one.status).toBe("pending");
});

test("resolve's 200 flushes BEFORE the long-poll resolves (one-tick defer)", async () => {
  await boot();
  const { id } = await newReview();

  const events: string[] = [];
  const longPoll = fetch(`${base}/api/reviews/${id}/decision`).then(async (r) => {
    const d = await r.json();
    events.push("longpoll");
    return d;
  });
  await Bun.sleep(20); // let the long-poll register

  const resolve = fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "allow" }),
  }).then(() => events.push("resolve"));

  const [, decision] = await Promise.all([resolve, longPoll]);
  expect(events).toEqual(["resolve", "longpoll"]);
  expect(decision).toMatchObject({ behavior: "allow" });
});

test("GET /decision returns 204 when no decision arrives within the heartbeat window", async () => {
  await boot({ heartbeatMs: 30 });
  const { id } = await newReview();
  const res = await fetch(`${base}/api/reviews/${id}/decision`);
  expect(res.status).toBe(204);
});

test("GET /decision serves a persisted deny decision on reconnect", async () => {
  await boot({ heartbeatMs: 30 });
  const { id } = await newReview();
  await fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "deny", feedback: "rephrase" }),
  });
  // A hook that dropped its long-poll reconnects and re-requests the decision.
  const res = await fetch(`${base}/api/reviews/${id}/decision`);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ behavior: "deny", feedback: "rephrase" });
});

test("GET /decision serves a persisted allow decision after approve removed it from memory", async () => {
  await boot({ heartbeatMs: 30 });
  const { id } = await newReview();
  await fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "allow" }),
  });
  expect(store.get(id)).toBeUndefined(); // approve drops it from memory
  const res = await fetch(`${base}/api/reviews/${id}/decision`);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ behavior: "allow" });
});

test("approve removes the review from the active set; deny keeps it as rejected", async () => {
  await boot();

  const { id: a } = await newReview();
  await fetch(`${base}/api/reviews/${a}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "allow" }),
  });
  expect(store.get(a)).toBeUndefined();

  const { id: d } = await newReview();
  await fetch(`${base}/api/reviews/${d}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "deny", feedback: "fix it" }),
  });
  expect(store.get(d)?.status).toBe("rejected");
});

const ANNS = [
  {
    id: "an1",
    blockId: "b0",
    startOffset: 0,
    endOffset: 4,
    quote: "Titl",
    comment: "hm",
  },
];

async function putDraft(id: string, body: Record<string, unknown>) {
  return fetch(`${base}/api/reviews/${id}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("PUT draft updates the current version's annotations", async () => {
  await boot();
  const { id } = await newReview();
  await putDraft(id, { annotations: ANNS });
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.annotations).toEqual(ANNS);
});

test("PUT draft persists and restores the general comment draft", async () => {
  await boot();
  const { id } = await newReview();
  await putDraft(id, { generalCommentDraft: "rethink the rollout" });
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.generalCommentDraft).toBe("rethink the rollout");
});

test("PUT draft does not clobber the other field (either direction)", async () => {
  await boot();
  const { id } = await newReview();
  // annotations-only write, then draft-only write: the draft must not wipe annotations.
  await putDraft(id, { annotations: ANNS });
  await putDraft(id, { generalCommentDraft: "keep both" });
  let one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.annotations).toEqual(ANNS);
  expect(one.generalCommentDraft).toBe("keep both");

  // The reverse: an annotations-only write must not wipe the existing draft.
  await putDraft(id, { annotations: [] });
  one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.annotations).toEqual([]);
  expect(one.generalCommentDraft).toBe("keep both");
});

test("PUT draft treats an explicit null field as absent (not a clobber)", async () => {
  await boot();
  const { id } = await newReview();
  await putDraft(id, { annotations: ANNS, generalCommentDraft: "keep me" });
  // A malformed null payload must not null out a typed field — annotations
  // would otherwise reach the client as null and crash its `.map`.
  await putDraft(id, { annotations: null, generalCommentDraft: null });
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.annotations).toEqual(ANNS);
  expect(one.generalCommentDraft).toBe("keep me");
});

test("resolve clears the draft on the deny/rejected path", async () => {
  await boot();
  const { id } = await newReview();
  await putDraft(id, { generalCommentDraft: "unsent feedback" });
  await resolve(id, { behavior: "deny", feedback: "fix it" });
  // Deny keeps the review on disk as rejected — it must not retain a stale draft,
  // and the plan text survives for the revision.
  expect(store.get(id)?.status).toBe("rejected");
  expect(store.get(id)?.generalCommentDraft).toBe("");
  expect(store.get(id)?.versions.at(-1)?.plan).toBe("# Title\n\nbody");
});

test("resolve clears the draft on the approve path", async () => {
  await boot();
  const { id } = await newReview();
  await putDraft(id, { generalCommentDraft: "unsent feedback" });
  await resolve(id, { behavior: "allow" });
  // Approve removes the review from memory; store.remove flushes the cleared
  // draft to disk first, so the persisted record carries an empty draft.
  expect(store.get(id)).toBeUndefined();
  expect((await store.persisted(id))?.generalCommentDraft).toBe("");
});

test("cross-origin mutating requests are blocked (CSRF guard)", async () => {
  await boot();
  const foreign = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "http://evil.com" },
    body: JSON.stringify({ sessionId: "S", plan: "# x" }),
  });
  expect(foreign.status).toBe(403);
  // Same-origin (loopback) origin is allowed.
  const local = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: `http://localhost:${srv.port}`,
    },
    body: JSON.stringify({ sessionId: "S", plan: "# x" }),
  });
  expect(local.ok).toBe(true);
});

test("GET / serves HTML containing the app root", async () => {
  await boot();
  const html = await (await fetch(`${base}/`)).text();
  expect(html).toContain('<div id="app">');
});

test("idle shutdown fires when empty, not while a review is pending", async () => {
  let shutdowns = 0;
  await boot({ idleMs: 30, onShutdown: () => shutdowns++ });
  // A review is created before the idle timer would fire — keeps it alive.
  const { id } = await newReview();
  await Bun.sleep(80);
  expect(shutdowns).toBe(0);
  // Approve → removed → 1→0 transition arms idle → shutdown.
  await fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "allow" }),
  });
  await Bun.sleep(120);
  expect(shutdowns).toBeGreaterThanOrEqual(1);
});

test("a superseded review's decision entry does not pin idle shutdown", async () => {
  let shutdowns = 0;
  await boot({ idleMs: 30, heartbeatMs: 20, onShutdown: () => shutdowns++ });
  const { id: stale } = await newReview();
  // The (timed-out) hook long-polled once, leaving an unsettled decision entry.
  expect((await fetch(`${base}/api/reviews/${stale}/decision`)).status).toBe(204);
  // The session resubmits: the stale review is superseded by a fresh thread.
  const { id: fresh } = await newReview();
  expect(fresh).not.toBe(stale);
  await resolve(fresh, { behavior: "allow" });
  await Bun.sleep(120);
  // The stale entry was cleared along with the supersede, so idle can fire.
  expect(shutdowns).toBeGreaterThanOrEqual(1);
});

test("idle shutdown fires when the daemon boots with no reviews", async () => {
  let shutdowns = 0;
  await boot({ idleMs: 30, onShutdown: () => shutdowns++ });
  await Bun.sleep(120);
  expect(shutdowns).toBeGreaterThanOrEqual(1);
});

test("lifecycle events are logged at info: listen, review created, resolved", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  const created = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "S", plan: "# x" }),
  });
  const { id } = (await created.json()) as { id: string };
  await resolve(id, { behavior: "deny", feedback: "no" });
  const info = recs.filter((r) => r.level === "info");
  expect(info.some((r) => r.step === "listen" && r.msg.includes("listening on"))).toBe(true);
  expect(
    info.some((r) => r.step === "review" && r.msg.includes(`review created: ${id.slice(0, 8)}`)),
  ).toBe(true);
  expect(info.some((r) => r.step === "resolve" && r.msg.includes("resolved: deny"))).toBe(true);
});

test("a handler exception is logged at error level before returning the 500", async () => {
  const { recs, log } = recordingLog();
  await boot({
    log,
    routePlan: async () => {
      throw new Error("kaboom");
    },
  });
  const res = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "S", plan: "# x" }),
  });
  expect(res.status).toBe(500);
  const rec = recs.find((r) => r.level === "error");
  expect(rec?.step).toBe("request");
  expect(rec?.msg).toContain("kaboom");
});

test("a throwing log sink during a handler error still returns the clean 500", async () => {
  const { log } = recordingLog();
  await boot({
    // Only the handler-error log throws; the lifecycle logs at startup are fine.
    log: {
      ...log,
      error: () => {
        throw new Error("log sink broken");
      },
    },
    routePlan: async () => {
      throw new Error("kaboom");
    },
  });
  const res = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId: "S", plan: "# x" }),
  });
  expect(res.status).toBe(500);
  expect(await res.text()).toBe("internal error");
});

test("a rejected (changes-requested) review does NOT keep the daemon alive", async () => {
  let shutdowns = 0;
  await boot({ idleMs: 30, onShutdown: () => shutdowns++ });
  const { id } = await newReview();
  await fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "deny", feedback: "redo" }),
  });
  expect(store.get(id)?.status).toBe("rejected"); // kept on disk for the revision
  await Bun.sleep(120);
  expect(shutdowns).toBeGreaterThanOrEqual(1); // but idle still fires
});

test("resolving an already-resolved review is rejected (double-resolve guard)", async () => {
  await boot();
  const { id } = await newReview();
  const first = await fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "deny", feedback: "x" }),
  });
  expect(first.ok).toBe(true);
  const second = await fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "allow" }),
  });
  expect(second.status).toBe(404); // already rejected — not pending
  expect(store.get(id)?.status).toBe("rejected"); // unchanged by the 2nd resolve
});

test("a revision re-pends the review and clears the prior decision (no stale re-serve)", async () => {
  await boot({ heartbeatMs: 50 });
  const { id } = await newReview();
  // The driver/hook is already long-polling when the browser requests changes,
  // so the deny is delivered through the decision pipe (which drains it).
  const poll = fetch(`${base}/api/reviews/${id}/decision`);
  await Bun.sleep(10); // let the long-poll register before the resolve
  await fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "deny", feedback: "redo" }),
  });
  expect(await (await poll).json()).toMatchObject({ behavior: "deny" });
  // Agent posts a revision in the same session → appends v2, re-pends to pending.
  await newReview({ plan: "# v2" });
  expect(store.get(id)?.status).toBe("pending");
  expect(store.get(id)?.decision).toBeUndefined(); // the old deny must not linger
  // The next long-poll must wait (204), not re-serve the stale deny.
  const res = await fetch(`${base}/api/reviews/${id}/decision`);
  expect(res.status).toBe(204);
});

test("GET /api/prefs defaults to 'default' on a fresh daemon", async () => {
  await boot();
  const res = await fetch(`${base}/api/prefs`);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ approveMode: "default" });
});

test("an allow remembers the chosen acceptMode (incl. auto)", async () => {
  await boot();
  for (const mode of ["acceptEdits", "auto"] as const) {
    const { id } = await newReview();
    await resolve(id, { behavior: "allow", acceptMode: mode });
    expect(await waitForPrefMode(mode)).toBe(mode);
  }
});

test("a deny does not change the remembered approve mode", async () => {
  await boot();
  const { id: a } = await newReview();
  await resolve(a, { behavior: "allow", acceptMode: "acceptEdits" });
  expect(await waitForPrefMode("acceptEdits")).toBe("acceptEdits");

  const { id: d } = await newReview();
  // Even a deny that carries an acceptMode must not move the remembered value —
  // the write is gated on behavior === "allow", not on the token's absence.
  await resolve(d, { behavior: "deny", acceptMode: "auto", feedback: "redo" });
  await Bun.sleep(30); // give any (erroneous) write a chance to land
  expect(await prefMode()).toBe("acceptEdits");
});

test("an allow with an unrecognized acceptMode leaves prefs at 'default'", async () => {
  await boot();
  const { id } = await newReview();
  await resolve(id, { behavior: "allow", acceptMode: "turbo" });
  await Bun.sleep(30); // the daemon's isAcceptMode guard should reject the write
  expect(await prefMode()).toBe("default");
});

test("the remembered approve mode survives a daemon restart", async () => {
  await boot();
  const { id } = await newReview();
  await resolve(id, { behavior: "allow", acceptMode: "auto" });
  expect(await waitForPrefMode("auto")).toBe("auto");

  // Restart: stop the server, boot a fresh one against the same state dir.
  srv.stop();
  await boot();
  expect(await prefMode()).toBe("auto");
});

// ---- instrumentation (EXC-444) ----

test("the review record is emitted once, by the router, with threading extras", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  const { id } = await newReview();
  const review = recs.filter((r) => r.step === "review");
  expect(review).toHaveLength(1);
  expect(review[0]).toMatchObject({
    level: "info",
    msg: `review created: ${id.slice(0, 8)}`,
    extra: { reviewId: id, sessionId: "S", action: "new", version: 1 },
  });
});

test("the resolve record carries reviewId, sessionId, and acceptMode extras", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  const { id } = await newReview();
  await resolve(id, { behavior: "allow", acceptMode: "acceptEdits" });
  const rec = recs.find((r) => r.step === "resolve");
  expect(rec).toMatchObject({
    level: "info",
    msg: `review ${id.slice(0, 8)} resolved: allow`,
    extra: { reviewId: id, sessionId: "S", acceptMode: "acceptEdits" },
  });
});

test("the listen record carries the build fingerprint and version", async () => {
  const { recs, log } = recordingLog();
  await boot({ log, buildId: "b123" });
  const rec = recs.find((r) => r.step === "listen");
  expect(rec?.extra).toMatchObject({ build: "b123", version: VERSION });
});

test("a draft autosave is logged at debug with the review id only", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  const { id } = await newReview();
  await fetch(`${base}/api/reviews/${id}/draft`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ generalCommentDraft: "secret draft text" }),
  });
  expect(recs).toContainEqual({
    level: "debug",
    step: "draft",
    msg: `draft saved: ${id.slice(0, 8)}`,
    extra: { reviewId: id },
  });
  // Draft text is reviewer prose — it must never appear in any record.
  expect(JSON.stringify(recs)).not.toContain("secret draft text");
});

test("a decision served from disk after a memory miss is logged at debug", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  const { id } = await newReview();
  await resolve(id, { behavior: "allow" }); // approve removes it from memory
  const res = await fetch(`${base}/api/reviews/${id}/decision`);
  expect(((await res.json()) as { behavior: string }).behavior).toBe("allow");
  expect(recs).toContainEqual({
    level: "debug",
    step: "decision",
    msg: `decision served from disk: ${id.slice(0, 8)}`,
    extra: { reviewId: id },
  });
});

// ---- POST /api/logs UI log bridge (EXC-445) ----

async function postLogs(
  events: unknown,
  init: { origin?: string; rawBody?: string; contentLength?: string } = {},
) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.origin) headers.Origin = init.origin;
  if (init.contentLength) headers["Content-Length"] = init.contentLength;
  return fetch(`${base}/api/logs`, {
    method: "POST",
    headers,
    body: init.rawBody ?? JSON.stringify({ events }),
  });
}

test("POST /api/logs accepts a mixed-level batch (204) and records each event", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  const res = await postLogs([
    { level: "info", step: "ui", msg: "panel opened" },
    { level: "warn", step: "render", msg: "slow frame", extra: { ms: 50 } },
  ]);
  expect(res.status).toBe(204);
  const ui = recs.filter((r) => r.step === "ui" || r.step === "render");
  expect(ui.find((r) => r.msg === "panel opened")).toMatchObject({
    level: "info",
    step: "ui",
    extra: { source: "ui" },
  });
  expect(ui.find((r) => r.msg === "slow frame")).toMatchObject({
    level: "warn",
    step: "render",
    extra: { ms: 50, source: "ui" },
  });
});

test("a client-forged extra.source is overwritten with 'ui'", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  await postLogs([{ level: "info", step: "ui", msg: "x", extra: { source: "hook" } }]);
  const rec = recs.find((r) => r.msg === "x");
  expect((rec?.extra as { source?: string }).source).toBe("ui");
});

test("POST /api/logs rejects structurally invalid batches with 400", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });

  // bad level (not in the 4-value enum)
  expect((await postLogs([{ level: "trace", step: "ui", msg: "x" }])).status).toBe(400);
  // bad step: uppercase
  expect((await postLogs([{ level: "info", step: "UI", msg: "x" }])).status).toBe(400);
  // bad step: spaces
  expect((await postLogs([{ level: "info", step: "a b", msg: "x" }])).status).toBe(400);
  // non-array events
  expect((await postLogs(undefined, { rawBody: JSON.stringify({ events: "no" }) })).status).toBe(
    400,
  );
  // non-object envelope
  expect((await postLogs(undefined, { rawBody: "[]" })).status).toBe(400);
  // malformed JSON body
  expect((await postLogs(undefined, { rawBody: "{not json" })).status).toBe(400);

  // No forwarded events — only the per-batch rejection warns landed.
  expect(recs.every((r) => r.step === "ui" || r.step === "listen")).toBe(true);
  expect(recs.some((r) => r.msg === "x")).toBe(false);
});

test("POST /api/logs caps event count and body size with 413", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });

  // 101 events exceeds MAX_EVENTS (100).
  const many = Array.from({ length: 101 }, () => ({ level: "info", step: "ui", msg: "x" }));
  expect((await postLogs(many)).status).toBe(413);

  // A body over 64 KiB exceeds MAX_BODY_BYTES (measured from the read text).
  const big = "y".repeat(70 * 1024);
  const res = await postLogs([{ level: "info", step: "ui", msg: big }]);
  expect(res.status).toBe(413);

  // Nothing forwarded — only the rejection warns landed.
  expect(recs.some((r) => r.msg === "x" || r.msg.startsWith("y"))).toBe(false);
});

test("POST /api/logs strips control chars from msg but keeps TAB", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  // Newline (a C0 control) is stripped — NDJSON line-forging defense — but TAB
  // (U+0009) survives. Spaces are printable and are NOT stripped.
  await postLogs([{ level: "info", step: "ui", msg: "a\nb\tc" }]);
  const rec = recs.find((r) => r.step === "ui" && r.msg.includes("a"));
  expect(rec?.msg).toBe("ab\tc");
});

test("POST /api/logs truncates an over-length msg to 256 chars (still 204)", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  const long = "z".repeat(300);
  const res = await postLogs([{ level: "info", step: "ui", msg: long }]);
  expect(res.status).toBe(204);
  const rec = recs.find((r) => r.step === "ui" && r.msg.startsWith("z"));
  expect(rec?.msg.length).toBe(256);
});

test("POST /api/logs drops extra keys that collide with record fields", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  await postLogs([
    {
      level: "info",
      step: "ui",
      msg: "collide",
      extra: { step: "forged", pid: 999, keep: "me" },
    },
  ]);
  const extra = recs.find((r) => r.msg === "collide")?.extra as Record<string, unknown>;
  // Reserved keys (step/pid) are stripped; unreserved keys survive; source forced.
  expect(extra.step).toBeUndefined();
  expect(extra.pid).toBeUndefined();
  expect(extra.keep).toBe("me");
  expect(extra.source).toBe("ui");
});

test("POST /api/logs forwards an error-level event at level 'error'", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  // CaretLogger.error takes err: unknown; passing the sanitized string makes the
  // record's msg the string (a non-Error is stringified).
  await postLogs([{ level: "error", step: "ui", msg: "render failed" }]);
  const rec = recs.find((r) => r.msg === "render failed");
  expect(rec?.level).toBe("error");
  expect(rec?.step).toBe("ui");
  expect((rec?.extra as { source?: string }).source).toBe("ui");
});

test("POST /api/logs from a foreign origin is blocked (403, nothing recorded)", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  const res = await postLogs([{ level: "info", step: "ui", msg: "should not record" }], {
    origin: "https://evil.example",
  });
  expect(res.status).toBe(403);
  // The CSRF guard runs before the route body, so neither a forward nor a
  // rejection warn is emitted.
  expect(recs.some((r) => r.msg === "should not record")).toBe(false);
  expect(recs.some((r) => r.step === "ui")).toBe(false);
});

test("POST /api/logs does not permanently defer idle shutdown", async () => {
  let shutdowns = 0;
  await boot({ idleMs: 30, onShutdown: () => shutdowns++ });
  // A log POST defers idle while in flight (like any request); once it returns
  // and no reviews are pending, the idle timer must re-arm and fire.
  const res = await postLogs([{ level: "info", step: "ui", msg: "heartbeat" }]);
  expect(res.status).toBe(204);
  await Bun.sleep(120);
  expect(shutdowns).toBeGreaterThanOrEqual(1);
});

test("a rejected log batch logs exactly one warn under step 'ui'", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  await postLogs([{ level: "trace", step: "ui", msg: "x" }]); // bad level → 400
  const warns = recs.filter((r) => r.level === "warn" && r.step === "ui");
  expect(warns).toHaveLength(1);
  expect(warns[0]).toMatchObject({
    level: "warn",
    step: "ui",
    msg: "ui log batch rejected",
    extra: { status: 400 },
  });
});

test("a real daemon logger censors a forged plan body on the wire path", async () => {
  // recordingLog captures extra BEFORE wrap()'s scrub, so this is the one
  // end-to-end assertion that wire → CaretLogger → scrubValue censors a
  // DENY_KEYS body — the bridge's core redaction promise.
  const dest = join(dir, "daemon-e2e.log");
  await boot({ log: createDaemonLogger(() => "info", dest) });
  const res = await postLogs([
    { level: "info", step: "ui", msg: "m", extra: { plan: "secret plan body" } },
  ]);
  expect(res.status).toBe(204);
  const text = readFileSync(dest, "utf-8");
  expect(text).toContain('"source":"ui"');
  expect(text).toContain('"plan":"<redacted>"');
  expect(text).not.toContain("secret plan body");
});

test("a failed fire-and-forget prefs write is logged at warn", async () => {
  const { recs, log } = recordingLog();
  // prefsPath nested under a regular FILE so writeApproveMode's mkdir fails.
  const blocker = join(dir, "blocker");
  await Bun.write(blocker, "i am a file, not a directory");
  await boot({ log, prefsPath: join(blocker, "prefs.json") });
  const { id } = await newReview();
  await resolve(id, { behavior: "allow", acceptMode: "auto" });
  // Fire-and-forget: poll briefly for the warn to land.
  let warn: (typeof recs)[number] | undefined;
  for (let i = 0; i < 20 && !warn; i++) {
    warn = recs.find((r) => r.level === "warn" && r.step === "prefs");
    await Bun.sleep(10);
  }
  expect(warn?.msg).toBe("approve mode write failed");
});
