import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type CaretServer } from "../src/daemon.ts";
import { createStore, type Store } from "../src/store.ts";

let dir: string;
let store: Store;
let srv: CaretServer;
let base: string;

async function boot(
  opts: {
    idleMs?: number;
    heartbeatMs?: number;
    onShutdown?: () => void;
    log?: (msg: string) => void;
    routePlan?: Parameters<typeof createServer>[0]["routePlan"];
  } = {},
) {
  store = createStore(dir);
  await store.rehydrate();
  srv = createServer({
    store,
    port: 0,
    prefsPath: join(dir, "prefs.json"),
    idleMs: opts.idleMs ?? 1_000_000,
    heartbeatMs: opts.heartbeatMs,
    onShutdown: opts.onShutdown ?? (() => {}),
    log: opts.log,
    routePlan: opts.routePlan,
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

test("idle shutdown fires when the daemon boots with no reviews", async () => {
  let shutdowns = 0;
  await boot({ idleMs: 30, onShutdown: () => shutdowns++ });
  await Bun.sleep(120);
  expect(shutdowns).toBeGreaterThanOrEqual(1);
});

test("a handler exception is logged before returning the 500", async () => {
  const logs: string[] = [];
  await boot({
    log: (m) => logs.push(m),
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
  expect(logs.some((m) => m.includes("kaboom"))).toBe(true);
});

test("a throwing log sink during a handler error still returns the clean 500", async () => {
  await boot({
    // Only the handler-error log throws; the lifecycle logs at startup are fine.
    log: (m) => {
      if (m.includes("request error")) throw new Error("log sink broken");
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
