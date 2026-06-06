import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VERSION } from "../src/build-id.ts";
import { createDaemonLogger } from "../src/log.ts";
import type { Store } from "../src/store.ts";
import { type BootOptions, bootDaemon, type TestDaemon } from "./support/daemon.ts";
import { recordingLog } from "./support/recording-log.ts";
import { expectNeverLogsBody } from "./support/redaction.ts";

let dir: string;
let d: TestDaemon;
let store: Store;
let srv: { port: number; stop(): void };
let base: string;

async function boot(opts: BootOptions = {}) {
  // Default prefs into the temp dir so the prefs tests never touch the real
  // machine-global prefs file.
  d = await bootDaemon(dir, { prefsPath: join(dir, "prefs.json"), ...opts });
  store = d.store;
  srv = { port: d.port, stop: d.stop };
  base = d.url;
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

// A promise that resolves the first time the daemon's idle/retire shutdown fires,
// plus the onShutdown callback to hand to boot(). Awaiting the signal is the
// deterministic alternative to sleeping past idleMs and then polling a counter:
// the test proceeds the instant the daemon actually shuts down, never sooner and
// no slower. `fired` lets the negative tests assert a shutdown has NOT happened
// (within a bounded grace) without racing the promise.
function shutdownSignal(): {
  onShutdown: () => void;
  shutdown: Promise<void>;
  fired: () => boolean;
} {
  let resolved = false;
  let resolve!: () => void;
  const shutdown = new Promise<void>((r) => {
    resolve = r;
  });
  return {
    onShutdown: () => {
      resolved = true;
      resolve();
    },
    shutdown,
    fired: () => resolved,
  };
}

async function resolve(id: string, body: Record<string, unknown>) {
  await d.resolve(id, body);
}

async function newReview(body: Record<string, unknown> = {}) {
  return { id: await d.seed(body) };
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

test("health includes the commit when provided", async () => {
  await boot({ commit: "c0ffee00" });
  const body = (await (await fetch(`${base}/api/health`)).json()) as { commit?: string };
  expect(body.commit).toBe("c0ffee00");
});

test("health omits commit when the daemon has none", async () => {
  await boot();
  const body = (await (await fetch(`${base}/api/health`)).json()) as { commit?: string };
  expect(body.commit).toBeUndefined();
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

// ---- world identity in health + lock (EXC-461) ----

test("GET /api/health includes stateDir and instanceId when provided", async () => {
  await boot({ stateDir: "/x/caret", instanceId: "inst123" });
  const body = (await (await fetch(`${base}/api/health`)).json()) as {
    stateDir?: string;
    instanceId?: string;
  };
  expect(body.stateDir).toBe("/x/caret");
  expect(body.instanceId).toBe("inst123");
});

test("GET /api/health omits stateDir and instanceId when not provided", async () => {
  await boot();
  const body = (await (await fetch(`${base}/api/health`)).json()) as Record<string, unknown>;
  expect("stateDir" in body).toBe(false);
  expect("instanceId" in body).toBe(false);
});

// ---- adapter-declared approve variants in health (EXC-515) ----

test("GET /api/health publishes the adapter's declared approve variants", async () => {
  const variants = [
    { id: "approve", label: "Approve" },
    { id: "yolo", label: "Approve & auto", description: "all gas" },
  ];
  await boot({ approveVariants: variants });
  const body = (await (await fetch(`${base}/api/health`)).json()) as {
    approveVariants?: typeof variants;
  };
  expect(body.approveVariants).toEqual(variants);
});

test("GET /api/health omits approveVariants when the adapter declares none", async () => {
  await boot();
  const body = (await (await fetch(`${base}/api/health`)).json()) as Record<string, unknown>;
  expect("approveVariants" in body).toBe(false);
});

test("the lock file records stateDir and instanceId", async () => {
  const lockPath = join(dir, "daemon.lock");
  await boot({ lockPath, stateDir: "/x/caret", instanceId: "inst123" });
  const lock = JSON.parse(readFileSync(lockPath, "utf-8")) as Record<string, unknown>;
  expect(lock.stateDir).toBe("/x/caret");
  expect(lock.instanceId).toBe("inst123");
});

test("the listen record carries instanceId but never the state dir", async () => {
  const { recs, log } = recordingLog();
  await boot({ log, stateDir: "/secret-home/caret", instanceId: "inst123" });
  const listen = recs.find((r) => r.step === "listen");
  expect((listen?.extra as { instanceId?: string } | undefined)?.instanceId).toBe("inst123");
  // stateDir is identifying (contains the username) — it must never reach a log.
  expectNeverLogsBody(recs, "/secret-home");
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
  const sig = shutdownSignal();
  await boot({ lockPath, onShutdown: sig.onShutdown });
  const res = await fetch(`${base}/api/retire`, { method: "POST" });
  expect(res.status).toBe(200);
  // The graceful path defers stop()+onShutdown one tick so the 200 flushes first;
  // await the shutdown rather than sleeping past the defer.
  await sig.shutdown;
  expect(existsSync(lockPath)).toBe(false);
});

test("POST /api/retire from a foreign origin is blocked (403, no shutdown)", async () => {
  const lockPath = join(dir, "daemon.lock");
  const sig = shutdownSignal();
  await boot({ lockPath, onShutdown: sig.onShutdown });
  const res = await fetch(`${base}/api/retire`, {
    method: "POST",
    headers: { Origin: "http://evil.com" },
  });
  expect(res.status).toBe(403);
  // Proving the NON-event (no shutdown): no signal to await, so allow a small
  // grace for any (erroneous) deferred shutdown to have fired, then assert it didn't.
  await Bun.sleep(20);
  expect(sig.fired()).toBe(false);
  expect(existsSync(lockPath)).toBe(true);
});

test("idle auto-shutdown removes the lock file", async () => {
  const lockPath = join(dir, "daemon.lock");
  const sig = shutdownSignal();
  await boot({ lockPath, idleMs: 30, onShutdown: sig.onShutdown });
  expect(existsSync(lockPath)).toBe(true);
  await sig.shutdown;
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
  return d.draft(id, body);
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

test("caret.localhost vanity origin is allowed; other *.localhost hosts are not (EXC-426)", async () => {
  await boot();
  const vanity = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: `http://caret.localhost:${srv.port}`,
    },
    body: JSON.stringify({ sessionId: "S", plan: "# x" }),
  });
  expect(vanity.ok).toBe(true);
  // Only the exact vanity host is allowlisted — a sibling *.localhost is not.
  const sibling = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: `http://other.localhost:${srv.port}`,
    },
    body: JSON.stringify({ sessionId: "S2", plan: "# x" }),
  });
  expect(sibling.status).toBe(403);
});

test("GET / serves HTML containing the app root", async () => {
  await boot();
  const html = await (await fetch(`${base}/`)).text();
  expect(html).toContain('<div id="app">');
});

// ---- routing fallthrough (the dispatcher's default response) ----
//
// The route table in src/daemon.ts branches on method+path and falls through to
// notFound() for everything else: there is no 405. Pinning these edges makes the
// contract a future client or second adapter exercises explicit rather than
// incidental — every unmatched request is a uniform 404 "not found".
describe("routing fallthrough", () => {
  test("an unknown path is a clean 404", async () => {
    await boot();
    for (const path of ["/api/nope", "/random", "/api/reviews/"]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("not found");
    }
  });

  test("a wrong method on a known path falls through to 404 (no 405)", async () => {
    await boot();
    const { id } = await newReview();
    // Each pair is a real route under a method it does not serve. The dispatcher
    // has no method-not-allowed branch, so all of these are 404.
    const cases: Array<[string, string]> = [
      ["DELETE", "/api/reviews"],
      ["GET", "/api/retire"],
      ["POST", "/api/health"],
      ["DELETE", "/api/prefs"],
      ["PUT", `/api/reviews/${id}/resolve`], // /resolve is POST-only
      ["GET", `/api/reviews/${id}/resolve`],
      ["DELETE", `/api/reviews/${id}/decision`],
      ["POST", `/api/reviews/${id}/draft`], // /draft is PUT-only
    ];
    for (const [method, path] of cases) {
      const res = await fetch(`${base}${path}`, { method });
      expect(res.status).toBe(404);
    }
  });

  test("GET /api/reviews/:id for a nonexistent id is 404", async () => {
    await boot();
    const res = await fetch(`${base}/api/reviews/does-not-exist`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });

  test("a malformed :id sub-path is 404 (not a partial match)", async () => {
    await boot();
    const { id } = await newReview();
    // /bogus is not one of the recognized sub-routes (decision/resolve/draft/
    // expire), so the id-route regex doesn't match and the request 404s rather
    // than dispatching to the wrong handler.
    for (const method of ["GET", "POST", "PUT"]) {
      const res = await fetch(`${base}/api/reviews/${id}/bogus`, { method });
      expect(res.status).toBe(404);
    }
  });

  test("the :id path segment is URL-decoded (a percent-encoded id round-trips)", async () => {
    await boot();
    const { id } = await newReview();
    // Percent-encode the id's first char; the dispatcher decodes the segment, so
    // the encoded form resolves to the same review (200), not a 404. This pins
    // the decodeURIComponent contract a client building URLs relies on.
    const encId = `%${id.charCodeAt(0).toString(16).toUpperCase()}${id.slice(1)}`;
    const res = await fetch(`${base}/api/reviews/${encId}`);
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(id);
  });

  test("oversize/malformed bodies on the zod routes stay lenient, not 400", async () => {
    await boot();
    const { id } = await newReview();
    // The /reviews, /resolve, /draft bodies are zod-validated but deliberately
    // lenient: a malformed body degrades to the schema fallback rather than
    // rejecting (the cast-and-trust behavior these schemas replaced). Confirm a
    // garbage body never turns into a 4xx on these routes.
    const garbage = "{not valid json at all";

    const create = await fetch(`${base}/api/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: garbage,
    });
    // The plan input falls back to {}; the router still creates a review (200).
    expect(create.ok).toBe(true);

    const resolveRes = await fetch(`${base}/api/reviews/${id}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: garbage,
    });
    // behavior falls back to "allow" (fail-safe never denies on a garbled body),
    // so the still-pending review resolves with a 200 rather than a 400.
    expect(resolveRes.ok).toBe(true);

    const { id: id2 } = await newReview();
    const draftRes = await fetch(`${base}/api/reviews/${id2}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: garbage,
    });
    // Both draft fields fall back to undefined (left untouched), a no-op 200.
    expect(draftRes.ok).toBe(true);
  });
});

test("idle shutdown fires when empty, not while a review is pending", async () => {
  const sig = shutdownSignal();
  await boot({ idleMs: 30, onShutdown: sig.onShutdown });
  // A review is created before the idle timer would fire — keeps it alive.
  const { id } = await newReview();
  // Negative leg: a pending review must hold the daemon open. No event to await,
  // so allow well past idleMs and assert no shutdown fired.
  await Bun.sleep(80);
  expect(sig.fired()).toBe(false);
  // Approve → removed → 1→0 transition arms idle → shutdown; await it.
  await fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "allow" }),
  });
  await sig.shutdown;
});

test("a superseded review's decision entry does not pin idle shutdown", async () => {
  const sig = shutdownSignal();
  await boot({ idleMs: 30, heartbeatMs: 20, onShutdown: sig.onShutdown });
  const { id: stale } = await newReview();
  // The (timed-out) hook long-polled once, leaving an unsettled decision entry.
  expect((await fetch(`${base}/api/reviews/${stale}/decision`)).status).toBe(204);
  // The session resubmits: the stale review is superseded by a fresh thread.
  const { id: fresh } = await newReview();
  expect(fresh).not.toBe(stale);
  await resolve(fresh, { behavior: "allow" });
  // The stale entry was cleared along with the supersede, so idle can fire — await it.
  await sig.shutdown;
});

// ---- hook-initiated expire (EXC-454) ----

test("POST /expire ends a pending review: terminal on disk, gone from the queue", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  const { id } = await newReview();
  const res = await fetch(`${base}/api/reviews/${id}/expire`, { method: "POST" });
  expect(res.status).toBe(200);
  expect(store.get(id)).toBeUndefined(); // dropped from memory
  const list = (await (await fetch(`${base}/api/reviews`)).json()) as unknown[];
  expect(list).toEqual([]);
  // Terminal on disk: a still-pending record would rehydrate as an orphan.
  const onDisk = JSON.parse(readFileSync(join(dir, `${id}.json`), "utf-8")) as { status: string };
  expect(onDisk.status).toBe("expired");
  // The contract is the record's level/step/structured extra; the message prose
  // is deliberately mutable, so match it loosely on the stable id prefix.
  const expired = recs.find((r) => r.step === "review" && r.msg.includes(id.slice(0, 8)));
  expect(expired).toMatchObject({
    level: "info",
    step: "review",
    extra: { reviewId: id, sessionId: "S" },
  });
});

test("POST /expire refuses a non-pending review", async () => {
  await boot();
  const { id } = await newReview();
  await resolve(id, { behavior: "deny", feedback: "no" });
  const res = await fetch(`${base}/api/reviews/${id}/expire`, { method: "POST" });
  expect(res.status).toBe(404);
  expect(store.get(id)?.status).toBe("rejected"); // untouched
});

test("POST /expire clears the decision entry even when the review is gone", async () => {
  const sig = shutdownSignal();
  await boot({ idleMs: 30, heartbeatMs: 20, onShutdown: sig.onShutdown });
  // A zombie hook polls a review that no longer exists, re-creating an
  // unsettled entry that would pin openDecisionCount forever.
  expect((await fetch(`${base}/api/reviews/ghost/decision`)).status).toBe(204);
  const res = await fetch(`${base}/api/reviews/ghost/expire`, { method: "POST" });
  expect(res.status).toBe(404);
  await sig.shutdown; // entry cleared → idle fired
});

test("idle shutdown fires after a pending review is expired", async () => {
  const sig = shutdownSignal();
  await boot({ idleMs: 30, heartbeatMs: 20, onShutdown: sig.onShutdown });
  const { id } = await newReview();
  // The hook long-polled once (unsettled entry), then timed out and expired.
  expect((await fetch(`${base}/api/reviews/${id}/decision`)).status).toBe(204);
  await fetch(`${base}/api/reviews/${id}/expire`, { method: "POST" });
  await sig.shutdown;
});

test("idle shutdown fires when the daemon boots with no reviews", async () => {
  const sig = shutdownSignal();
  await boot({ idleMs: 30, onShutdown: sig.onShutdown });
  await sig.shutdown;
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
  const sig = shutdownSignal();
  await boot({ idleMs: 30, onShutdown: sig.onShutdown });
  const { id } = await newReview();
  await fetch(`${base}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ behavior: "deny", feedback: "redo" }),
  });
  expect(store.get(id)?.status).toBe("rejected"); // kept on disk for the revision
  await sig.shutdown; // but idle still fires
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
  // Pin level + structured extra (the contract); the message is mutable prose,
  // so assert only that it carries the stable id prefix.
  expect(review[0]).toMatchObject({
    level: "info",
    extra: { reviewId: id, sessionId: "S", action: "new", version: 1 },
  });
  expect(review[0]?.msg).toContain(id.slice(0, 8));
});

test("the resolve record carries reviewId, sessionId, and acceptMode extras", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  const { id } = await newReview();
  await resolve(id, { behavior: "allow", acceptMode: "acceptEdits" });
  const rec = recs.find((r) => r.step === "resolve");
  expect(rec).toMatchObject({
    level: "info",
    extra: { reviewId: id, sessionId: "S", acceptMode: "acceptEdits" },
  });
  // The behavior rides only in the message prose (no `behavior` extra), so match
  // it loosely: the stable id prefix plus the resolved behavior token.
  expect(rec?.msg).toContain(id.slice(0, 8));
  expect(rec?.msg).toMatch(/\ballow\b/);
});

test("the listen record carries the build fingerprint and version", async () => {
  const { recs, log } = recordingLog();
  await boot({ log, buildId: "b123" });
  const rec = recs.find((r) => r.step === "listen");
  expect(rec?.extra).toMatchObject({ build: "b123", version: VERSION });
});

test("the listen record carries the commit the server runs from", async () => {
  const { recs, log } = recordingLog();
  await boot({ log, commit: "c0ffee0123456789abcdef0123456789abcdef01" });
  const rec = recs.find((r) => r.step === "listen");
  expect(rec?.extra).toMatchObject({ commit: "c0ffee0123456789abcdef0123456789abcdef01" });
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
  // Level + step + reviewId are the contract; the message is mutable prose,
  // matched loosely on the id prefix.
  const saved = recs.find((r) => r.step === "draft" && r.msg.includes(id.slice(0, 8)));
  expect(saved).toMatchObject({ level: "debug", step: "draft", extra: { reviewId: id } });
  // Draft text is reviewer prose — it must never appear in any record.
  expectNeverLogsBody(recs, "secret draft text");
});

test("a decision served from disk after a memory miss is logged at debug", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  const { id } = await newReview();
  await resolve(id, { behavior: "allow" }); // approve removes it from memory
  const res = await fetch(`${base}/api/reviews/${id}/decision`);
  expect(((await res.json()) as { behavior: string }).behavior).toBe("allow");
  // Level + step + reviewId are the contract; match the mutable message loosely.
  const served = recs.find((r) => r.step === "decision" && r.msg.includes(id.slice(0, 8)));
  expect(served).toMatchObject({ level: "debug", step: "decision", extra: { reviewId: id } });
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

test("POST /api/logs drops a client-forged extra.caller", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  await postLogs([
    {
      level: "info",
      step: "ui",
      msg: "forge caller",
      extra: { caller: "src/evil.ts:1", keep: "me" },
    },
  ]);
  const extra = recs.find((r) => r.msg === "forge caller")?.extra as Record<string, unknown>;
  // caller is a structural field stamped by src/log.ts; a client-sent one is a
  // forgery and must be stripped, while the innocent key survives and source forced.
  expect(extra.caller).toBeUndefined();
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
  const sig = shutdownSignal();
  await boot({ idleMs: 30, onShutdown: sig.onShutdown });
  // A log POST defers idle while in flight (like any request); once it returns
  // and no reviews are pending, the idle timer must re-arm and fire.
  const res = await postLogs([{ level: "info", step: "ui", msg: "heartbeat" }]);
  expect(res.status).toBe(204);
  await sig.shutdown;
});

test("a rejected log batch logs exactly one warn under step 'ui'", async () => {
  const { recs, log } = recordingLog();
  await boot({ log });
  await postLogs([{ level: "trace", step: "ui", msg: "x" }]); // bad level → 400
  const warns = recs.filter((r) => r.level === "warn" && r.step === "ui");
  expect(warns).toHaveLength(1);
  // The contract is one warn under step 'ui' carrying the rejected status; the
  // message itself is mutable prose.
  expect(warns[0]).toMatchObject({
    level: "warn",
    step: "ui",
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
  expectNeverLogsBody(text, "secret plan body");
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
