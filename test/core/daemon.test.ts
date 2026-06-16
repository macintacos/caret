import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { APPROVE_VARIANTS } from "../../src/adapters/claude/approve.ts";
import { VERSION } from "../../src/build-id.ts";
import { isClientLive, LIVE_CLIENT_WINDOW_MS } from "../../src/daemon.ts";
import { createDaemonLogger } from "../../src/log.ts";
import { formatPlanMarkdown } from "../../src/plan-markdown.ts";
import type { Store } from "../../src/store.ts";
import type { UiAssets } from "../../src/ui-assets.ts";
import { type BootOptions, bootDaemon, type TestDaemon } from "../support/daemon.ts";
import { recordingLog } from "../support/recording-log.ts";
import { expectNeverLogsBody } from "../support/redaction.ts";

// A UiAssets handle over real temp files, so the daemon serves bytes through
// Bun.file (and its MIME) exactly as in production. Resolver injected as a dep —
// the core daemon stays tool-agnostic and never reaches into ui-assets.ts.
const assetDirs: string[] = [];
function fakeAssets(files: Record<string, string>): UiAssets {
  const root = mkdtempSync(join(tmpdir(), "caret-ui-assets-"));
  assetDirs.push(root);
  const map: Record<string, string> = {};
  let i = 0;
  for (const [urlPath, content] of Object.entries(files)) {
    // Keep the URL path's basename (extension included) so Bun.file derives the
    // same MIME the embedded path would; an index prefix avoids name collisions.
    const safe = join(root, `${i++}-${urlPath.split("/").pop()}`);
    writeFileSync(safe, content);
    map[urlPath] = safe;
  }
  return {
    paths: Object.keys(map).sort(),
    file: (urlPath) => (map[urlPath] ? Bun.file(map[urlPath]) : undefined),
  };
}

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

// Boot with the Claude adapter's declared approve variants — the recognized set
// the daemon's /resolve and prefs persistence gate on in production. The
// resolve/prefs tests exercise that token behavior ("acceptEdits"/"auto"), so
// they boot through the adapter's real declaration rather than a bare daemon
// (which recognizes only "default").
async function bootClaude(opts: BootOptions = {}) {
  await boot({ approveVariants: APPROVE_VARIANTS, ...opts });
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

// A controllable stand-in for the daemon's idle timer: captures the scheduled
// callback so a test fires it on demand (`fire()`) instead of racing a real
// `idleMs` delay. The idle timer is armed at boot with no request in flight, so
// under load the real one can fire in the boot->first-request window and shut the
// daemon down before the test's first request lands (EXC-647). Inject setTimer/
// clearTimer into boot() and the daemon arms/cancels through them exactly as it
// would the real timer — the arm/cancel/refresh logic stays real, only the delay
// is deterministic.
function manualTimer(): {
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  fire: () => void;
  pending: () => boolean;
} {
  let scheduled: (() => void) | null = null;
  let handle = 0;
  return {
    setTimer: (fn) => {
      scheduled = fn;
      handle += 1;
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (h) => {
      if ((h as unknown as number) === handle) scheduled = null;
    },
    // Run the armed callback (a no-op if nothing is scheduled). Cleared first so a
    // re-arm inside the callback (maybeShutdown's else-branch) schedules afresh.
    fire: () => {
      const fn = scheduled;
      scheduled = null;
      fn?.();
    },
    pending: () => scheduled !== null,
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
  for (const d of assetDirs.splice(0)) await rm(d, { recursive: true, force: true });
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

// ---- dev-build signal in health (EXC-556) ----

test("GET /api/health reports isDev as a boolean", async () => {
  // The UI's "local build" badge keys on this flag. It derives from
  // isCompiledBinary() (a process-constant), so assert it's present and a
  // boolean rather than a fixed value — the true/false truth table is proven
  // in test/core/build-id.test.ts.
  await boot();
  const body = (await (await fetch(`${base}/api/health`)).json()) as { isDev?: unknown };
  expect(typeof body.isDev).toBe("boolean");
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
  expect(one.currentPlan).toBe("# My Plan\n\ndetails\n");
  expect(one.version).toBe(1);
  expect(one.title).toBe("My Plan");
  expect(one.status).toBe("pending");
});

test("POST /api/reviews stores prettier-formatted plan text (EXC-574)", async () => {
  await boot();
  const raw =
    "# Wrap\n\nthis paragraph is one long unwrapped line that the daemon's ingest pass rewraps into the canonical stored representation before persisting the version";
  const { id } = await newReview({ plan: raw });
  const one = (await (await fetch(`${base}/api/reviews/${id}`)).json()) as {
    currentPlan: string;
  };
  expect(one.currentPlan).toBe(await formatPlanMarkdown(raw));
  expect(one.currentPlan).not.toBe(raw);
});

test("a revision posted after a deny stores prettier-formatted text (EXC-574)", async () => {
  await boot();
  const { id } = await newReview({ sessionId: "fmt-s", plan: "# v1\n\nfirst" });
  await resolve(id, { behavior: "deny", feedback: "rework" });
  const raw =
    "# v2\n\nthe revised plan body is one long unwrapped line that the ingest pass rewraps before appending it as the review's second stored version";
  const { id: appended } = await newReview({ sessionId: "fmt-s", plan: raw });
  expect(appended).toBe(id);
  const one = (await (await fetch(`${base}/api/reviews/${id}`)).json()) as {
    version: number;
    currentPlan: string;
  };
  expect(one.version).toBe(2);
  expect(one.currentPlan).toBe(await formatPlanMarkdown(raw));
  expect(one.currentPlan).not.toBe(raw);
});

// EXC-559: the hook foregrounds the browser only when no live UI client is
// already listening. The daemon tracks the last reviews-poll and reports
// hasLiveClient on the create response; the hook uses it to skip openBrowser so
// an open, backgrounded tab's away-gated notification isn't pre-empted.
async function postReviewRaw(body: Record<string, unknown> = {}) {
  const res = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan: "# P", ...body }),
  });
  return (await res.json()) as { id: string; hasLiveClient?: boolean };
}

test("isClientLive: never-polled, fresh, and stale windows (EXC-559)", () => {
  expect(isClientLive(0, 1_000_000, 6000)).toBe(false); // never polled
  expect(isClientLive(1_000_000, 1_000_000, 6000)).toBe(true); // just polled
  expect(isClientLive(1_000_000, 1_005_999, 6000)).toBe(true); // 5999ms < window
  expect(isClientLive(1_000_000, 1_006_000, 6000)).toBe(false); // 6000ms not < window
});

test("POST /api/reviews reports hasLiveClient=false when no UI has polled (EXC-559)", async () => {
  await boot();
  const r = await postReviewRaw();
  expect(r.hasLiveClient).toBe(false);
});

test("POST /api/reviews reports hasLiveClient=true right after a reviews poll (EXC-559)", async () => {
  await boot();
  await fetch(`${base}/api/reviews`); // a live UI client polling the pending list
  const r = await postReviewRaw();
  expect(r.hasLiveClient).toBe(true);
});

// EXC-562: the EXC-559 liveness window keyed on the 2s reviews poll is defeated
// by browser background-tab timer throttling — a hidden tab's poll is slowed to
// ~1/min, so a backgrounded-but-open tab read as not-live and the hook opened a
// redundant tab anyway. Three changes harden it: the window must comfortably
// exceed the throttle floor; an explicit close beacon (POST /api/ui/gone)
// retracts presence so a *closed* tab stops counting at once (which is what lets
// the window be long); and idle shutdown is gated on presence so the daemon
// doesn't die between throttled polls and forget the tab on respawn.

test("the live-client window covers Chrome's ~1/min background-throttle floor (EXC-562)", () => {
  // Contract, not the exact value: the window must exceed a minute so a hidden
  // tab throttled to ~one poll/min still reads as live rather than gone.
  expect(LIVE_CLIENT_WINDOW_MS).toBeGreaterThanOrEqual(60_000);
});

test("POST /api/ui/gone retracts presence so the next create reports hasLiveClient=false (EXC-562)", async () => {
  await boot();
  await fetch(`${base}/api/reviews`); // a tab polled → would otherwise read live
  const gone = await fetch(`${base}/api/ui/gone`, { method: "POST" });
  expect(gone.status).toBe(204);
  // The tab announced it is closing, so the hook must foreground the next plan.
  const r = await postReviewRaw();
  expect(r.hasLiveClient).toBe(false);
});

test("a present UI tab keeps the daemon alive past idle; /api/ui/gone lets it shut down (EXC-562)", async () => {
  const sig = shutdownSignal();
  const timer = manualTimer();
  await boot({
    idleMs: 30,
    onShutdown: sig.onShutdown,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });
  await fetch(`${base}/api/reviews`); // a live tab is present
  // A present tab must hold the daemon open even when idle fires while it's still
  // around (it can poll slower than idle) — otherwise the daemon dies and forgets
  // the tab on respawn. Firing the idle timer here must re-arm, not shut down.
  timer.fire();
  expect(sig.fired()).toBe(false);
  expect(timer.pending()).toBe(true); // re-armed, still watching
  // Once the tab announces it closed, presence is gone and the next idle fires.
  await fetch(`${base}/api/ui/gone`, { method: "POST" });
  timer.fire();
  await sig.shutdown;
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

// EXC-590: a revision resubmit must NOT receive the prior decision. After a
// request-changes deny, handleResolve's one-tick-deferred resolveDecision settles
// a registry entry; with no hook long-polling it settles a fresh entry nobody is
// awaiting — an orphan. When the agent resubmits, routeIncomingPlan appends a
// version onto the same id, re-pends the review, and clears the STORE decision —
// but the in-memory registry orphan must be cleared too, or the revision's
// long-poll reads it and re-serves the stale deny before any human decides.
test("a revision append clears the orphaned registry decision so /decision heartbeats instead of serving the stale deny (EXC-590)", async () => {
  await boot({ heartbeatMs: 30 });
  const { id } = await newReview({ sessionId: "stale-decision-s", plan: "# v1\n\nfirst" });
  await resolve(id, { behavior: "deny", feedback: "needs a rollout plan" });
  // Let the deferred resolveDecision fire and form the orphan registry entry.
  await Bun.sleep(20);
  // Same session + the review is now rejected → this APPENDS v2 onto the same id.
  const { id: appended } = await newReview({
    sessionId: "stale-decision-s",
    plan: "# v2\n\nrevised",
  });
  expect(appended).toBe(id);
  const review = (await (await fetch(`${base}/api/reviews/${id}`)).json()) as {
    version: number;
    status: string;
  };
  expect(review.version).toBe(2);
  expect(review.status).toBe("pending");
  // The re-pended revision has no decision yet, so the long-poll must block to the
  // heartbeat (204) — never 200 carrying the prior deny from a stale registry entry.
  const res = await fetch(`${base}/api/reviews/${id}/decision`);
  expect(res.status).toBe(204);
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
  // ANNS carries no prefix/suffix — the old on-disk shape round-trips unchanged.
  expect(one.annotations).toEqual(ANNS);
});

test("PUT draft round-trips the optional prefix/suffix anchor context", async () => {
  await boot();
  const { id } = await newReview();
  const withContext = [{ ...ANNS[0], id: "an2", prefix: "before ", suffix: " after" }];
  await putDraft(id, { annotations: withContext });
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.annotations).toEqual(withContext);
});

test("PUT draft persists and restores the general comment draft", async () => {
  await boot();
  const { id } = await newReview();
  await putDraft(id, { generalCommentDraft: "rethink the rollout" });
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.generalCommentDraft).toBe("rethink the rollout");
});

const SCRATCHES = [
  { startLine: 3, endLine: 5, text: "tighten this range" },
  { startLine: 12, endLine: 12, text: "stray todo here?" },
];

test("PUT draft persists and restores composer scratches (round-trips through GET)", async () => {
  await boot();
  const { id } = await newReview();
  await putDraft(id, { composerScratches: SCRATCHES });
  // The seam's full public round-trip: PUT /draft -> store -> GET /reviews/:id.
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.composerScratches).toEqual(SCRATCHES);
});

test("GET defaults composerScratches to [] when a record predates the field", async () => {
  await boot();
  const { id } = await newReview();
  // A review that never received a scratch write still serves the total wire shape.
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.composerScratches).toEqual([]);
});

test("PUT draft degrades a malformed composerScratches entry (no clobber, no 400)", async () => {
  await boot();
  const { id } = await newReview();
  await putDraft(id, { composerScratches: SCRATCHES });
  // A bad entry (text missing) trips the schema; like every other draft field it
  // degrades to absent rather than rejecting, so the prior scratches survive.
  const res = await putDraft(id, { composerScratches: [{ startLine: 1, endLine: 1 }] });
  expect(res.status).toBe(200);
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.composerScratches).toEqual(SCRATCHES);
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

const LINE_ANNS = [{ id: "ln1", startLine: 3, endLine: 5, comment: "tighten this range" }];

test("PUT draft persists a line-anchored annotation", async () => {
  await boot();
  const { id } = await newReview();
  const res = await putDraft(id, { annotations: LINE_ANNS });
  expect(res.status).toBe(200);
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.annotations).toEqual(LINE_ANNS);
});

test("PUT draft round-trips a line annotation's optional ReviewStatus state", async () => {
  await boot();
  const { id } = await newReview();
  // The per-comment state rides the line-anchored shape; the schema preserves it
  // (rather than stripping it as an unknown key) so a stated comment persists.
  const stated = [{ id: "s1", startLine: 2, endLine: 2, comment: "ok now", state: "approved" }];
  await putDraft(id, { annotations: stated });
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.annotations).toEqual(stated);
});

test("PUT draft persists a mixed legacy + line array, preserving both shapes", async () => {
  await boot();
  const { id } = await newReview();
  const mixed = [...ANNS, ...LINE_ANNS];
  await putDraft(id, { annotations: mixed });
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.annotations).toEqual(mixed);
});

test("PUT draft rejects a line anchor with startLine < 1 (400, nothing persisted)", async () => {
  await boot();
  const { id } = await newReview();
  await putDraft(id, { annotations: ANNS });
  const res = await putDraft(id, {
    annotations: [{ id: "bad", startLine: 0, endLine: 2, comment: "x" }],
  });
  expect(res.status).toBe(400);
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.annotations).toEqual(ANNS);
});

test("PUT draft rejects a line anchor with endLine < startLine (400, nothing persisted)", async () => {
  await boot();
  const { id } = await newReview();
  const res = await putDraft(id, {
    annotations: [{ id: "bad", startLine: 5, endLine: 3, comment: "x" }],
  });
  expect(res.status).toBe(400);
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.annotations).toEqual([]);
});

test("PUT draft keeps the degrade tolerance for non-line-shaped junk", async () => {
  await boot();
  const { id } = await newReview();
  await putDraft(id, { annotations: ANNS });
  // A junk body that claims neither shape degrades to a no-op, exactly as a
  // malformed legacy body always has — never a 400, never a clobber.
  const res = await putDraft(id, { annotations: [{ nonsense: true }] });
  expect(res.status).toBe(200);
  const one = await (await fetch(`${base}/api/reviews/${id}`)).json();
  expect(one.annotations).toEqual(ANNS);
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
  expect(store.get(id)?.versions.at(-1)?.plan).toBe("# Title\n\nbody\n");
});

test("resolve clears composer scratches on the deny/rejected path", async () => {
  await boot();
  const { id } = await newReview();
  await putDraft(id, { composerScratches: SCRATCHES });
  await resolve(id, { behavior: "deny", feedback: "fix it" });
  // Same terminal invariant as the general-comment draft: a resolved record keeps
  // no unsent scratches.
  expect(store.get(id)?.composerScratches).toEqual([]);
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

test("a cross-origin non-safe method is blocked even off the POST/PUT list (CSRF guard)", async () => {
  // The guard gates every non-safe verb, not a fixed POST/PUT allowlist, so a
  // mutating method the route table doesn't serve is still 403 at the wrapper —
  // never reaching dispatch's uniform 404. This pins that a future mutating verb
  // (DELETE/PATCH) is CSRF-protected by default.
  await boot();
  const { id } = await newReview();
  for (const method of ["DELETE", "PATCH"]) {
    const res = await fetch(`${base}/api/reviews/${id}`, {
      method,
      headers: { Origin: "http://evil.com" },
    });
    // 403 from the guard, NOT the 404 the same-origin method-mismatch matrix gets.
    expect(res.status).toBe(403);
  }
});

// ---- read-confidentiality posture (EXC-540) ----
//
// The daemon's read-confidentiality (a foreign page must not read plan bodies)
// rests on the loopback bind plus the browser same-origin policy — NOT on the
// CSRF guard, which gates only non-safe methods. These tests pin the two halves
// of that posture so a future "fix" can't silently erode it: the daemon emits no
// Access-Control-* header on any route (so SOP keeps blocking cross-origin
// reads), and a cross-origin GET is deliberately allowed *through* the guard
// (the read-confidentiality tax — the asymmetry on the allow side, not just the
// block side).
describe("read-confidentiality posture", () => {
  const CORS_HEADERS = [
    "access-control-allow-origin",
    "access-control-allow-methods",
    "access-control-allow-headers",
  ];

  // Assert a response carries no CORS-grant header at all. Checks the three named
  // grant headers explicitly, then sweeps every header for an "access-control-"
  // prefix so a future credentials/expose/max-age header trips the same wire too.
  function expectNoCorsHeaders(res: Response, where: string) {
    for (const h of CORS_HEADERS) {
      expect(res.headers.get(h), `${where} must not emit ${h}`).toBeNull();
    }
    for (const [name] of res.headers) {
      expect(
        name.toLowerCase().startsWith("access-control-"),
        `${where} must emit no Access-Control-* header (saw ${name})`,
      ).toBe(false);
    }
  }

  test("no route family emits an Access-Control-* header", async () => {
    // A representative request to every route family. A future permissive-CORS
    // 'fix' on any handler would fail loudly here rather than silently breaking
    // read confidentiality.
    // Short heartbeat so the /decision long-poll returns its 204 promptly.
    await boot({
      heartbeatMs: 30,
      assets: fakeAssets({
        "/index.html": '<!doctype html><html><body><div id="app"></div></body></html>',
        "/assets/index-AB12.js": "export const x = 1;\n",
      }),
    });
    const { id } = await newReview();
    const cases: Array<[string, () => Promise<Response>]> = [
      ["GET /api/health", () => fetch(`${base}/api/health`)],
      ["GET /api/reviews", () => fetch(`${base}/api/reviews`)],
      ["GET /api/reviews/:id", () => fetch(`${base}/api/reviews/${id}`)],
      ["GET /api/reviews/:id/decision", () => fetch(`${base}/api/reviews/${id}/decision`)],
      ["GET /api/prefs", () => fetch(`${base}/api/prefs`)],
      ["GET / (index)", () => fetch(`${base}/`)],
      ["GET /assets/* (asset)", () => fetch(`${base}/assets/index-AB12.js`)],
      [
        "PUT /api/reviews/:id/draft",
        () =>
          fetch(`${base}/api/reviews/${id}/draft`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ generalCommentDraft: "x" }),
          }),
      ],
      [
        "POST /api/logs",
        () =>
          fetch(`${base}/api/logs`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ events: [{ level: "info", step: "ui", msg: "x" }] }),
          }),
      ],
      ["POST /api/retire", () => fetch(`${base}/api/retire`, { method: "POST" })],
      ["a 404 fallthrough", () => fetch(`${base}/api/nope`)],
    ];
    // /resolve and /expire are terminal (they consume the pending review), so
    // give each its own seeded id and run them last.
    for (const [label, send] of cases) {
      const res = await send();
      expectNoCorsHeaders(res, label);
    }
    const { id: rid } = await newReview();
    expectNoCorsHeaders(
      await fetch(`${base}/api/reviews/${rid}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ behavior: "allow" }),
      }),
      "POST /api/reviews/:id/resolve",
    );
    const { id: eid } = await newReview();
    expectNoCorsHeaders(
      await fetch(`${base}/api/reviews/${eid}/expire`, { method: "POST" }),
      "POST /api/reviews/:id/expire",
    );
  });

  test("a cross-origin GET is allowed through (the read-confidentiality tax)", async () => {
    // The CSRF guard does NOT block safe methods, so a foreign page's GET reaches
    // the handler and returns 200 — read protection is the browser's same-origin
    // policy (no CORS header above), not this guard. This documents the asymmetry
    // on the allow side: cross-origin writes 403, cross-origin reads pass.
    await boot();
    const { id } = await newReview();
    const res = await fetch(`${base}/api/reviews/${id}`, {
      headers: { Origin: "http://evil.com" },
    });
    expect(res.status).toBe(200);
    expectNoCorsHeaders(res, "cross-origin GET /api/reviews/:id");
  });
});

// ---- UI serving (index document + hashed sibling assets) ----
//
// The daemon serves the injected UiAssets by exact URL-path match: the index
// document with no-cache (so a redeploy never references stale hashed names),
// hashed siblings with Bun.file's MIME and a long immutable cache. With no
// assets injected (the bare daemon) it serves only the built-in placeholder at /
// and 404s every other UI path — the posture existing tests pin.
describe("UI serving", () => {
  // A representative built UI: an index that references its hashed siblings, a JS
  // chunk, and a CSS chunk under /assets/.
  const INDEX = '<!doctype html><html><body><div id="app"></div></body></html>';
  const JS = "export const x = 1;\n";
  const CSS = ":root{--paper:#fff}\n";
  function bootUi() {
    return boot({
      assets: fakeAssets({
        "/index.html": INDEX,
        "/assets/index-AB12.js": JS,
        "/assets/index-CD34.css": CSS,
      }),
    });
  }

  test("GET / serves the placeholder with no-cache when no UI is built", async () => {
    await boot();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain('<div id="app">');
  });

  test("GET / serves the built index document with no-cache", async () => {
    await bootUi();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toBe(INDEX);
  });

  test("GET /index.html serves the same index document as GET /", async () => {
    await bootUi();
    const res = await fetch(`${base}/index.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toBe(INDEX);
  });

  test("GET a hashed JS asset returns 200 with the JS MIME and an immutable cache", async () => {
    await bootUi();
    const res = await fetch(`${base}/assets/index-AB12.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe(JS);
  });

  test("GET a hashed CSS asset returns 200 with the CSS MIME and an immutable cache", async () => {
    await bootUi();
    const res = await fetch(`${base}/assets/index-CD34.css`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/css");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(await res.text()).toBe(CSS);
  });

  test("a non-/assets root asset (not content-hashed) is served with no-cache", async () => {
    // A public/-copied file (e.g. favicon.ico) lands as a root manifest key, not
    // under /assets/, and is NOT content-addressed. Only /assets/* names earn the
    // immutable year-long cache; this one must stay re-fetchable across redeploys.
    await boot({
      assets: fakeAssets({
        "/index.html": INDEX,
        "/favicon.ico": "icon-bytes",
      }),
    });
    const res = await fetch(`${base}/favicon.ico`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  test("GET an asset path that isn't a manifest key is a clean 404", async () => {
    await bootUi();
    const res = await fetch(`${base}/assets/missing-ZZ99.js`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("not found");
  });

  test("a bare daemon 404s asset paths (only the placeholder index is served)", async () => {
    await boot();
    const res = await fetch(`${base}/assets/index-AB12.js`);
    expect(res.status).toBe(404);
  });

  // Traversal-shaped requests over HTTP are a uniform 404. By the time a path
  // reaches handleAsset, new URL().pathname has already collapsed every ".." and
  // "%2e%2e" segment, so the allowlist only ever sees a normalized path (e.g.
  // "/src/cli.ts") — just another unknown key. This pins the runtime's
  // normalization + the dispatcher's fall-through, not caret's allowlist guard
  // itself; the falsifiable exact-match-vs-filesystem-join assertion lives at the
  // resolver layer (ui-assets.test.ts), where no URL normalization runs first.
  test("traversal-shaped requests are a clean 404", async () => {
    await bootUi();
    for (const path of [
      "/../src/cli.ts",
      "/assets/../../src/cli.ts",
      "/assets/%2e%2e/%2e%2e/src/cli.ts",
      "/etc/passwd",
    ]) {
      const res = await fetch(`${base}${path}`);
      expect(res.status).toBe(404);
    }
  });
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
    // Each pair is a real route under a method it does not serve, sent SAME-ORIGIN
    // (no Origin header) so the CSRF guard passes and the request reaches the
    // dispatcher. The dispatcher has no method-not-allowed branch, so all of these
    // are 404. (A cross-origin non-safe method 403s at the guard before dispatch —
    // see the CSRF-guard test in the read-confidentiality block above.)
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
  const timer = manualTimer();
  await boot({
    idleMs: 30,
    heartbeatMs: 20,
    onShutdown: sig.onShutdown,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });
  const { id: stale } = await newReview();
  // The (timed-out) hook long-polled once, leaving an unsettled decision entry.
  expect((await fetch(`${base}/api/reviews/${stale}/decision`)).status).toBe(204);
  // The session resubmits: the stale review is superseded by a fresh thread.
  const { id: fresh } = await newReview();
  expect(fresh).not.toBe(stale);
  await resolve(fresh, { behavior: "allow" });
  // The stale entry was cleared along with the supersede, so nothing pins
  // openDecisionCount and the armed idle timer shuts the daemon down when it fires.
  timer.fire();
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
  const timer = manualTimer();
  await boot({
    idleMs: 30,
    heartbeatMs: 20,
    onShutdown: sig.onShutdown,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });
  // A zombie hook polls a review that no longer exists, re-creating an
  // unsettled entry that would pin openDecisionCount forever.
  expect((await fetch(`${base}/api/reviews/ghost/decision`)).status).toBe(204);
  const res = await fetch(`${base}/api/reviews/ghost/expire`, { method: "POST" });
  expect(res.status).toBe(404);
  timer.fire();
  await sig.shutdown; // entry cleared → idle fired
});

test("idle shutdown fires after a pending review is expired", async () => {
  const sig = shutdownSignal();
  const timer = manualTimer();
  await boot({
    idleMs: 30,
    heartbeatMs: 20,
    onShutdown: sig.onShutdown,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });
  const { id } = await newReview();
  // The hook long-polled once (unsettled entry), then timed out and expired.
  expect((await fetch(`${base}/api/reviews/${id}/decision`)).status).toBe(204);
  await fetch(`${base}/api/reviews/${id}/expire`, { method: "POST" });
  timer.fire();
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
  await bootClaude();
  for (const mode of ["acceptEdits", "auto"] as const) {
    const { id } = await newReview();
    await resolve(id, { behavior: "allow", acceptMode: mode });
    expect(await waitForPrefMode(mode)).toBe(mode);
  }
});

test("a deny does not change the remembered approve mode", async () => {
  await bootClaude();
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
  await bootClaude();
  const { id } = await newReview();
  await resolve(id, { behavior: "allow", acceptMode: "turbo" });
  await Bun.sleep(30); // an id outside the declared set must not seed prefs
  expect(await prefMode()).toBe("default");
});

test("the remembered approve mode survives a daemon restart", async () => {
  await bootClaude();
  const { id } = await newReview();
  await resolve(id, { behavior: "allow", acceptMode: "auto" });
  expect(await waitForPrefMode("auto")).toBe("auto");

  // Restart: stop the server, boot a fresh one against the same state dir.
  srv.stop();
  await bootClaude();
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
  await bootClaude({ log });
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
    body: JSON.stringify({
      generalCommentDraft: "secret draft text",
      composerScratches: [{ startLine: 1, endLine: 1, text: "secret scratch text" }],
    }),
  });
  // Level + step + reviewId are the contract; the message is mutable prose,
  // matched loosely on the id prefix.
  const saved = recs.find((r) => r.step === "draft" && r.msg.includes(id.slice(0, 8)));
  expect(saved).toMatchObject({ level: "debug", step: "draft", extra: { reviewId: id } });
  // Draft text — the general comment and the composer scratches alike — is
  // reviewer prose; it must never appear in any record.
  expectNeverLogsBody(recs, ["secret draft text", "secret scratch text"]);
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
  const timer = manualTimer();
  await boot({
    idleMs: 30,
    onShutdown: sig.onShutdown,
    setTimer: timer.setTimer,
    clearTimer: timer.clearTimer,
  });
  // A log POST defers idle while in flight (like any request); once it returns
  // and no reviews are pending, the idle timer must re-arm and fire.
  const res = await postLogs([{ level: "info", step: "ui", msg: "heartbeat" }]);
  expect(res.status).toBe(204);
  timer.fire();
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
  await bootClaude({ log, prefsPath: join(blocker, "prefs.json") });
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
