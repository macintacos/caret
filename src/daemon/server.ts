// The caret daemon: a single Bun.serve that holds reviews in memory, serves the
// built UI (index document plus its hashed sibling assets), bridges the hook's
// long-poll to the browser's decision, and idle-auto-shuts-down when no reviews
// remain.

import { renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { deriveIdleTimeoutSec } from "@/config/constants.ts";
import { ensureStateDir, prefsFile } from "@/config/paths.ts";
import {
  type ApproveModeSet,
  createPrefsWriter,
  readApproveMode,
  writeApproveMode,
} from "@/config/prefs.ts";
import { DEFAULTS } from "@/config/settings.ts";
import {
  isClientLive,
  isCrossOrigin,
  isForeignHost,
  isSafeMethod,
  LIVE_CLIENT_WINDOW_MS,
} from "@/daemon/guards.ts";
import {
  DraftBodySchema,
  FileRefsBodySchema,
  FileSearchBodySchema,
  MAX_FILE_REFS,
  malformedLineAnchor,
  PlanInputSchema,
  PrefsPatchSchema,
  parseBody,
  ResolveBodySchema,
} from "@/daemon/schemas.ts";
import { type DaemonLock, IDENTITY, isCompiledBinary } from "@/lib/build-id.ts";
import { markPaneRead as clearCmuxMark } from "@/lib/cmux.ts";
import { type CaretLogger, noopLogger, shortId } from "@/lib/log.ts";
import {
  type ApproveVariant,
  type CmuxPane,
  currentVersion,
  type DaemonDiagnostics,
  type Decision,
  type DraftBody,
  type FileRefKind,
  type FileRefsResponse,
  type HealthIdentity,
  type PlanInput,
  type PrefsResponse,
  type ResolveBody,
  type RouteResult,
  type SkillDescriptionResponse,
  type SkillRef,
  toClientReview,
  type UpdateReport,
} from "@/lib/types.ts";
import { listDirectory } from "@/plan/directory.ts";
import { isFileTooLargeToPreview, readFileExcerpt, resolveInCwd } from "@/plan/excerpt.ts";
import { searchFiles } from "@/plan/file-search.ts";
import { createDecisions } from "@/review/decisions.ts";
import type { Store } from "@/review/store.ts";
import { routeIncomingPlan } from "@/review/threading.ts";
import type { UiAssets } from "@/ui/assets.ts";
import { MAX_BODY_BYTES, parseUiLogBatch } from "@/ui/log-bridge.ts";

const PLACEHOLDER_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>caret</title></head><body><div id="app">caret daemon — UI not built yet</div></body></html>`;

// The index document is served with no-cache so a redeploy never references stale
// hashed assets; hashed siblings under /assets/* are content-addressed, so they
// get a long immutable cache. (Vite's documented hashing guidance.)
const INDEX_CACHE_CONTROL = "no-cache";
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const INDEX_PATH = "/index.html";

/** Decides whether an incoming plan starts a new review or appends a version.
 * The router owns the review record (created vs appended), so it receives the
 * daemon's logger. */
export type RoutePlan = (input: PlanInput, store: Store, log?: CaretLogger) => Promise<RouteResult>;

export interface CreateServerOptions {
  store: Store;
  port?: number;
  /** Idle auto-shutdown delay (ms); defaults to the schema default. runDaemon
   * passes the env/file-resolved value (settings.idleMs) captured at boot. */
  idleMs?: number;
  /** Decision long-poll heartbeat window (ms); defaults to the schema default.
   * runDaemon passes the env/file-resolved value (settings.heartbeatMs)
   * captured at boot. The pure defaults keep createServer free of config-file
   * reads, so tests stay hermetic. */
  heartbeatMs?: number;
  /** The resolved UI asset set (ui-assets.ts loadUiAssets): its URL paths form the
   * exact-match allowlist the daemon serves, and each path reads through Bun.file
   * (carrying its MIME). Omitted (default) means no UI — `GET /` serves the
   * built-in placeholder and every other UI path 404s, the posture existing tests
   * pin. */
  assets?: UiAssets;
  onShutdown?: () => void;
  routePlan?: RoutePlan;
  /** Path to the machine-global prefs file; defaults to paths.prefsFile(). */
  prefsPath?: string;
  /** Single-instance lock file path. When set, the daemon writes the lock on a
   * successful bind and removes it on stop(); omitted (default) means no lock is
   * managed, so existing call sites/tests are unaffected. */
  lockPath?: string;
  /** Build fingerprint (paths.buildHash of the served UI) reported in
   * /api/health and recorded in the lock, so a newer caret can detect staleness. */
  buildId?: string;
  /** Commit the server runs from (build-id.ts resolveCommit), reported in the listen
   * record so daemon.log ties a boot back to a source revision (EXC-452). */
  commit?: string;
  /** The daemon's resolved state dir — its world identity (EXC-461), reported
   * in /api/health and recorded in the lock so a hook can refuse to
   * cross-attach to a foreign world. Identifying (contains the username):
   * never logged — the listen record carries instanceId instead. */
  stateDir?: string;
  /** Per-boot opaque id (EXC-461). /api/health carries it for the UI's swap
   * detection; the lock and listen-record copies tie a lock file and a
   * daemon.log boot back to the same boot for diagnostics. Safe to log. */
  instanceId?: string;
  /** The active adapter's declared approve variants, published in /api/health so
   * the UI renders its approve split-button from the adapter capability. Omitted
   * (default) means the field is absent from the health body and the UI uses its
   * built-in fallback set. */
  approveVariants?: readonly ApproveVariant[];
  /** The active adapter's id (e.g. "claude" | "opencode"), published in
   * /api/health as `source` so the UI can adapt to the environment — e.g. an
   * OpenCode session (EXC-791). Omitted (default) drops the field from the body. */
  source?: string;
  /** Enumerate the skills the active adapter's agent can reach for a review rooted
   * at `cwd`, served by GET /api/reviews/:id/skills (EXC-1176) so the feedback
   * editors can complete `/` names. Omitted (default) → the route 404s, so a
   * daemon that wires no adapter capability is unaffected; the e2e fixture daemon
   * deliberately leaves it unwired rather than enumerating the developer's own
   * skills. runDaemon wires the active adapter's `listSkills`. */
  listSkills?: (cwd: string) => Promise<SkillRef[]>;
  /** Read one enumerated skill's own description, served by
   * GET /api/reviews/:id/skill-description (EXC-1186) so the `/` completion's
   * preview panel can say what the highlighted name does. A second capability
   * beside `listSkills` rather than a field on it: the list names skills, this
   * opens one. Omitted (default) → the route 404s, and the e2e fixture daemon
   * leaves it unwired for the reason it leaves `listSkills` unwired. runDaemon
   * wires the active adapter's `readSkillDescription`. */
  readSkillDescription?: (cwd: string, skill: SkillRef) => Promise<string | null>;
  /** A thunk returning the daemon self-diagnostics served by GET /api/diagnostics
   * (EXC-842): system/runtime identity, uptime, the live parsed settings, and the
   * config path + env overrides. Omitted (default) → the route 404s, so existing
   * call sites/tests that don't wire it are unaffected. runDaemon wires the prod
   * thunk, which reads live settings so a config edit hot-reloads. */
  diagnostics?: () => DaemonDiagnostics;
  /** A thunk returning whether the running caret is behind, served by GET /api/update
   * (EXC-1205): the install kind, the running version/commit, and the verdict. Omitted
   * (default) → the route 404s, so a bare test daemon is unaffected. runDaemon wires a
   * thunk over a locally held status — reading it never triggers a network call. The e2e
   * fixture daemon wires a synthetic one (EXC-1207): the UI reads this route on every
   * load, so an unwired route there would 404 into every spec's page load. */
  updateReport?: () => UpdateReport | Promise<UpdateReport>;
  /** Called after a landed POST /api/prefs patch whose `updates.check` is `true`
   * (EXC-1210). A user action is exactly what the 24h throttle's constraint permits a
   * call for, so runDaemon wires it to the same check boot runs — without it, a reviewer
   * who opted out long ago would wait a whole daemon lifetime for a verdict. The daemon
   * does not read the prior value, so a redundant write of `true` fires it too; the
   * throttle is what bounds the cost. Fire-and-forget — it never delays the response.
   * Omitted (default) → the flip just lands, so a bare test daemon is unaffected. */
  onUpdatesEnabled?: () => void;
  /** Clear the unread mark on the cmux pane a review was submitted from
   * (EXC-961). Defaults to the real spawn; injectable so tests assert on the
   * argv without spawning. Fire-and-forget — it never delays a response. */
  markPaneRead?: (pane: CmuxPane) => void;
  /** Leveled lifecycle logger (see log.ts CaretLogger); defaults to a no-op so
   * tests stay quiet. Lifecycle events log at info, handler failures at error. */
  log?: CaretLogger;
  /** Schedule the idle-shutdown timer; injectable so tests fire it deterministically
   * instead of racing a real delay. Defaults to setTimeout. (The idle timer is the
   * only one armed at boot with no request in flight, so it's the one a test must be
   * able to control — the long-poll heartbeat timer is always awaited inside a
   * request and never races test setup.) */
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** Cancel a scheduled idle-shutdown timer. Defaults to clearTimeout. */
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

export interface CaretServer {
  port: number;
  stop(): void;
}

/** The createServer options resolved against their defaults once, so the route
 * handlers and lifecycle close over a single config object instead of a dozen
 * destructured locals. */
interface ResolvedOptions {
  store: Store;
  idle: number;
  heartbeat: number;
  assets: UiAssets | undefined;
  onShutdown: () => void;
  routePlan: RoutePlan;
  prefsPath: string;
  lockPath: string | undefined;
  buildId: string | undefined;
  commit: string | undefined;
  stateDir: string | undefined;
  instanceId: string | undefined;
  approveVariants: readonly ApproveVariant[] | undefined;
  source: string | undefined;
  listSkills: ((cwd: string) => Promise<SkillRef[]>) | undefined;
  readSkillDescription: ((cwd: string, skill: SkillRef) => Promise<string | null>) | undefined;
  diagnostics: (() => DaemonDiagnostics) | undefined;
  updateReport: (() => UpdateReport | Promise<UpdateReport>) | undefined;
  onUpdatesEnabled: (() => void) | undefined;
  markPaneRead: (pane: CmuxPane) => void;
  log: CaretLogger;
}

function resolveOptions(opts: CreateServerOptions): ResolvedOptions {
  return {
    store: opts.store,
    idle: opts.idleMs ?? DEFAULTS.daemon.idle_ms,
    heartbeat: opts.heartbeatMs ?? DEFAULTS.daemon.heartbeat_ms,
    assets: opts.assets,
    onShutdown: opts.onShutdown ?? (() => process.exit(0)),
    routePlan: opts.routePlan ?? routeIncomingPlan,
    prefsPath: opts.prefsPath ?? prefsFile(),
    lockPath: opts.lockPath,
    buildId: opts.buildId,
    commit: opts.commit,
    stateDir: opts.stateDir,
    instanceId: opts.instanceId,
    approveVariants: opts.approveVariants,
    source: opts.source,
    listSkills: opts.listSkills,
    readSkillDescription: opts.readSkillDescription,
    diagnostics: opts.diagnostics,
    updateReport: opts.updateReport,
    onUpdatesEnabled: opts.onUpdatesEnabled,
    markPaneRead: opts.markPaneRead ?? ((pane) => clearCmuxMark(pane, { log: opts.log })),
    log: opts.log ?? noopLogger,
  };
}

// A request matched to one of the :id sub-routes, with the review id decoded and
// the optional sub-path (/decision, /resolve, /draft, /expire, /seen, /file-refs,
// /file-search, /file, /dir, /skills, /skill-description) split out. The trailing
// `$` is what keeps /file from swallowing the /file-refs and /file-search
// prefixes: a /file match cannot then reach end-of-input, so the engine
// backtracks into the longer alternative. The order the literals appear in is
// therefore NOT load-bearing — a route added in the wrong place still matches,
// which is why /skill-description sits after /skills rather than being wedged in
// ahead of it. (Those two do not collide anyway — /skills needs an `s` where
// /skill-description has a `-` — but relying on that would make the next such
// pair a trap.)
interface IdRoute {
  id: string;
  sub: string | undefined;
}

const ID_ROUTE_RE =
  /^\/api\/reviews\/([^/]+)(\/decision|\/resolve|\/draft|\/expire|\/seen|\/file-refs|\/file-search|\/file|\/dir|\/skills|\/skill-description)?$/;

/** Match an /api/reviews/:id[/sub] path, decoding the id; null for any other path. */
function matchIdRoute(path: string): IdRoute | null {
  const m = path.match(ID_ROUTE_RE);
  if (!m) return null;
  return { id: decodeURIComponent(m[1] as string), sub: m[2] };
}

export function createServer(opts: CreateServerOptions): CaretServer {
  const cfg = resolveOptions(opts);
  const { store, idle, heartbeat, assets, onShutdown, routePlan, prefsPath, log } = cfg;
  const { buildId, commit, stateDir, instanceId, approveVariants, source, lockPath } = cfg;
  const { awaitDecision, resolveDecision, clearDecision, openDecisionCount } = createDecisions(log);

  // The set of approve-variant ids the resolve route and prefs persistence gate
  // on, derived from the active adapter's declared variants — the daemon stays
  // tool-agnostic, recognizing whatever the adapter declares rather than a baked
  // enum. The fallback is the first declared id (for the Claude adapter that is
  // "default"); a daemon with no declared variants recognizes only "default", so
  // a fresh /api/prefs still reads "default".
  const approveModeSet: ApproveModeSet =
    approveVariants && approveVariants.length > 0
      ? { valid: approveVariants.map((v) => v.id), fallback: approveVariants[0]?.id ?? "default" }
      : { valid: ["default"], fallback: "default" };

  // ONE writer for the two paths that write prefs.json — the resolve path's approve
  // mode and POST /api/prefs. Sharing it is what serializes them: two writers would
  // each hold their own queue and could still interleave a read-modify-write.
  const prefsWriter = createPrefsWriter(prefsPath);

  // Wait for a decision but no longer than `ms` — resolves to null on timeout so
  // the handler can return a 204 heartbeat. The pending promise is left intact
  // (not settled or cleared) so the next poll reuses it.
  function raceDecision(id: string, ms: number): Promise<Decision | null> {
    return new Promise<Decision | null>((resolve) => {
      const t = setTimeout(() => resolve(null), ms);
      awaitDecision(id).then((d) => {
        clearTimeout(t);
        resolve(d);
      });
    });
  }

  // Idle-timer scheduling is injectable (default: real timers) so tests drive it
  // deterministically — see CreateServerOptions.setTimer. Read from opts directly,
  // like opts.port below, rather than threading through resolveOptions.
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h));

  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = 0;
  let stopped = false;
  // Last time a UI client polled GET /api/reviews — the live-client signal the
  // hook reads to skip foregrounding the browser (EXC-559). 0 = never polled
  // (or retracted by a tab-close beacon, see handleUiGone).
  let lastReviewsPollAt = 0;
  // A UI tab counts as present while its last poll is within the live-client
  // window. Gates idle shutdown (EXC-562): a throttled-but-open tab must not get
  // the daemon shut from under it, since a respawn forgets the tab and the next
  // plan would open a redundant browser tab.
  const uiPresent = () => isClientLive(lastReviewsPollAt, Date.now(), LIVE_CLIENT_WINDOW_MS);

  function cancelIdle() {
    if (idleTimer) {
      clearTimer(idleTimer);
      idleTimer = null;
    }
  }
  function armIdle() {
    if (idleTimer || stopped || store.pendingCount() !== 0) return;
    idleTimer = setTimer(maybeShutdown, idle);
  }
  // Arm when no review is awaiting a decision; cancel while one is pending.
  // (A `rejected` review persists to disk and rehydrates when its revision
  // arrives, so it must not keep the daemon alive.)
  function refreshIdle() {
    if (store.pendingCount() === 0) armIdle();
    else cancelIdle();
  }
  function maybeShutdown() {
    idleTimer = null;
    // Re-check liveness atomically (single-threaded loop): never exit while a
    // review is pending, a hook is mid-long-poll, a request is in flight, or a
    // UI tab is still present (EXC-562) — an open tab is the daemon's reason to
    // stay up. When only a UI holds it open the else-branch re-arms, so the
    // daemon shuts down once the tab goes away (its close beacon, or a poll that
    // ages past the live-client window).
    if (store.pendingCount() === 0 && openDecisionCount() === 0 && inFlight === 0 && !uiPresent()) {
      log.info("idle", "idle shutdown");
      stop();
      onShutdown();
    } else if (store.pendingCount() === 0) {
      armIdle();
    }
  }

  function notFound() {
    return new Response("not found", { status: 404 });
  }

  function tooLarge() {
    return new Response("too large", { status: 413 });
  }

  // GET /api/health — the daemon's identity signature.
  function handleHealth(): Response {
    // Undefined fields are dropped from the JSON, so a daemon missing any
    // reports the bare {service, version}. `commit` is the commit this daemon
    // runs from (EXC-452), surfaced for a diagnostics client's discovery report;
    // stateDir (world) and instanceId (boot) are the EXC-461 identity fields
    // that let a hook and the UI tell daemons apart. `approveVariants` is the
    // active adapter's declared approve set, which the UI renders its split-
    // button from (an absent field means the UI uses its built-in fallback).
    // `isDev` (EXC-556) drives the UI's "local build" badge — always a boolean
    // (a process-constant), so it's emitted unconditionally rather than dropped.
    const body: HealthIdentity = {
      ...IDENTITY,
      build: buildId,
      commit,
      stateDir,
      instanceId,
      isDev: !isCompiledBinary(),
      // Only the dev --fresh boot sets CARET_FRESH; production omits the field
      // entirely so the wire stays byte-identical there (EXC-781).
      ...(process.env.CARET_FRESH === "1" ? { fresh: true } : {}),
      ...(approveVariants ? { approveVariants: [...approveVariants] } : {}),
      // The active adapter's id (EXC-791): the "source" the UI adapts to (e.g.
      // OpenCode's single-variant approve). Absent when the daemon declares none.
      ...(source ? { source } : {}),
    };
    return Response.json(body);
  }

  // GET /api/diagnostics — the daemon's self-diagnostics for the settings
  // Advanced pane (EXC-842): system/runtime identity, uptime, the live parsed
  // settings (scrubbed), and the config path + env overrides in effect. Distinct
  // from /api/health, a cross-daemon identity probe — this is the local daemon
  // describing itself to its own UI. With no diagnostics thunk wired (default;
  // e.g. a bare test daemon) the route 404s, like any absent optional capability.
  function handleDiagnostics(): Response {
    if (!cfg.diagnostics) return notFound();
    return Response.json(cfg.diagnostics());
  }

  // GET /api/update — whether the caret this daemon is, is behind (EXC-1205): the
  // install kind, the running version/commit, whether the check is on, and the verdict
  // with the command that would take the upgrade. The thunk reads a verdict the daemon
  // already holds, so serving this never makes a network call — but it does fold in the
  // LIVE `updates.check` (EXC-1210), a prefs.json read, which is why it may be async.
  // With no thunk wired (default; e.g. a bare test daemon) the route 404s, like any
  // absent optional capability.
  async function handleUpdate(): Promise<Response> {
    if (!cfg.updateReport) return notFound();
    return Response.json(await cfg.updateReport());
  }

  // POST /api/retire — graceful single-instance retire (EXC-406): a newer caret
  // asks this daemon to step down so it can take over the port. Loopback-guarded
  // by the cross-origin check in the wrapper. Pending reviews are already
  // write-through to disk (store), so they rehydrate on the next daemon's start.
  function handleRetire(): Response {
    log.info("retire", "retire requested");
    // Defer one tick so this 200 flushes before stop()/onShutdown (which may
    // process.exit) — same pattern as the /resolve unblock below.
    setTimeout(() => {
      stop();
      onShutdown();
    }, 0);
    return new Response(null, { status: 200 });
  }

  // GET / or /index.html — the UI's index document, served with no-cache so a
  // redeploy never references stale hashed asset names. Falls back to the
  // built-in placeholder when no UI asset set was injected (dev / fresh checkout).
  function handleIndex(): Response {
    const file = assets?.file(INDEX_PATH);
    const body: BodyInit = file ?? PLACEHOLDER_HTML;
    return new Response(body, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": INDEX_CACHE_CONTROL,
      },
    });
  }

  // GET <path> for a non-index manifest key — a hashed sibling asset (JS/CSS/
  // fonts). The path must be an exact manifest key (the allowlist), never
  // resolved against the filesystem, so traversal is impossible by construction.
  // Bun.file carries the asset's MIME. Only content-addressed /assets/* names
  // earn the long immutable cache; any other served file (e.g. a public/-copied
  // favicon, not content-hashed) gets no-cache so a redeploy is re-fetched.
  // Returns null for an unknown path so dispatch falls through to its uniform 404.
  function handleAsset(path: string): Response | null {
    if (!assets) return null;
    const file = assets.file(path);
    if (!file) return null;
    const cache = path.startsWith("/assets/") ? ASSET_CACHE_CONTROL : INDEX_CACHE_CONTROL;
    return new Response(file, {
      headers: { "Cache-Control": cache },
    });
  }

  // POST /api/reviews — an incoming plan from the hook.
  async function handleCreateReview(req: Request): Promise<Response> {
    const body = await parseBody(req, PlanInputSchema);
    // The router logs the review record (created vs appended) itself.
    const routed = await routePlan(body, store, log);
    // Drop superseded reviews' unsettled long-poll entries — their hooks have
    // given up (or will, at their own timeout), and a lingering unsettled entry
    // pins openDecisionCount, blocking idle shutdown (EXC-454). A still-polling
    // hook re-creates its entry per heartbeat, but that's bounded by its
    // timeout, whose /expire clears it for good.
    for (const staleId of routed.expired) clearDecision(staleId);
    // A revision append re-pends a settled review; drop any orphaned registry
    // entry so the revision's long-poll awaits a fresh decision instead of
    // re-serving the prior one (EXC-590). routeIncomingPlan already cleared the
    // store decision (r.decision = undefined); this is its in-memory analog.
    if (routed.action === "append") clearDecision(routed.id);
    // Tell the hook whether a UI tab is already listening (polled recently): if
    // so it skips foregrounding the browser, so an open backgrounded tab's
    // away-gated desktop notification isn't pre-empted (EXC-559).
    const hasLiveClient = isClientLive(lastReviewsPollAt, Date.now(), LIVE_CLIENT_WINDOW_MS);
    return Response.json({ ...routed, hasLiveClient });
  }

  // POST /api/logs — the UI log bridge (EXC-445): the browser ships log events
  // written through the daemon's CaretLogger (leveling/redaction apply
  // downstream). New trust boundary — read the body ONCE to bound its size (the
  // body parser's .catch tolerance can't measure the raw text), then parse in a
  // guarded try so a malformed body is a clean 400, not a 500.
  async function handleLogs(req: Request): Promise<Response> {
    // One warn per rejected batch (a recoverable oddity, not a failure) —
    // factored so the four reject sites can't drift apart.
    const reject = (status: 400 | 413) => {
      log.warn("ui", "ui log batch rejected", { status });
      return new Response(null, { status });
    };
    // Optimistic pre-read cap on the declared length; the post-read byte count
    // below is the authoritative check (headers can lie or be absent).
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return reject(413);
    const text = await req.text();
    if (Buffer.byteLength(text, "utf-8") > MAX_BODY_BYTES) return reject(413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return reject(400);
    }
    const result = parseUiLogBatch(parsed);
    if ("status" in result) return reject(result.status);
    // The accept path logs nothing of its own (noise rule) — only the forwarded
    // events. All four CaretLogger methods take (step, string, extra?) here:
    // error's String(err) on an already-sanitized string is identity, so one
    // dispatch covers every level.
    for (const ev of result.events) log[ev.level](ev.step, ev.msg, ev.extra);
    return new Response(null, { status: 204 });
  }

  // GET /api/reviews — the pending list as client-facing shapes. Doubles as the
  // live-client heartbeat: a UI polls this every ~2s, so stamping the time here
  // lets handleCreateReview tell the hook whether a tab is already listening
  // (EXC-559).
  function handleListReviews(): Response {
    lastReviewsPollAt = Date.now();
    return Response.json(store.list().map(toClientReview));
  }

  // POST /api/ui/gone — a UI tab announces it is closing (sent via
  // navigator.sendBeacon on pagehide). Retract its presence immediately so the
  // next plan foregrounds a fresh tab instead of assuming the closed one will
  // surface it (EXC-562). Clearing to 0 makes isClientLive read not-live at
  // once, which is what lets LIVE_CLIENT_WINDOW_MS stay long enough to outlast a
  // throttled background poll without a just-closed tab lingering as "live".
  // Presence is one shared timestamp, not per-tab: closing one of several open
  // tabs retracts the shared signal until a surviving tab's next poll re-stamps
  // it (≤2s foregrounded). Accepted for a single-user laptop — per-tab presence
  // tracking isn't worth its complexity for the rare two-tabs-open case.
  function handleUiGone(): Response {
    lastReviewsPollAt = 0;
    log.debug("ui", "ui presence retracted");
    return new Response(null, { status: 204 });
  }

  // GET /api/prefs — machine-global UI prefs, read once on UI load (deliberately
  // not part of the 2s /api/reviews poll). Fails safe to "default" for an unreadable
  // approve mode. `updates.check` is writable through the POST half but reaches the
  // browser on GET /api/update instead (EXC-1210), folded into the verdict it qualifies,
  // so the switch has exactly one read path rather than two that can drift.
  async function handlePrefs(): Promise<Response> {
    const body: PrefsResponse = {
      approveMode: await readApproveMode(prefsPath, log, approveModeSet),
    };
    return Response.json(body);
  }

  // POST /api/prefs — the write half (EXC-1206). Unlike the daemon's other bodies
  // this one is REJECTED rather than degraded when it doesn't parse: see
  // PrefsPatchSchema. The write merges, so a patch naming one key leaves the rest
  // of prefs.json (the remembered approve mode) alone.
  async function handleSetPrefs(req: Request): Promise<Response> {
    const parsed = PrefsPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const error = parsed.error.issues[0]?.message ?? "invalid prefs patch";
      // warn, and carrying the reason: a refusal is the recoverable oddity this route's
      // strictness exists to produce, and the browser turns the body into a sentence
      // that names no key — so the daemon log is the only place WHICH key was refused
      // survives. Same posture as handleLogs' reject(). The reason is a zod message
      // about a boolean field, so there is nothing identifying in it.
      log.warn("prefs", "prefs patch rejected", { reason: error });
      return Response.json({ error }, { status: 400 });
    }
    await prefsWriter.merge(parsed.data);
    log.debug("prefs", "prefs saved");
    // Turning the check back on is a user action, so it is allowed to spend a call
    // (EXC-1210). The throttle still governs: a re-run inside the 24h window returns null
    // and the already-held verdict is what gets served. No log line — runUpdateCheck logs
    // its own verdict, and a second record restating it is per-iteration noise.
    if (parsed.data.updates?.check === true) cfg.onUpdatesEnabled?.();
    return Response.json({ ok: true });
  }

  // GET /api/reviews/:id — one review as its client-facing shape.
  function handleGetReview(id: string): Response {
    const r = store.get(id);
    return r ? Response.json(toClientReview(r)) : notFound();
  }

  // POST /api/reviews/:id/file-refs — of the candidate path strings the UI
  // parsed from this review's plan, which resolve inside the review's cwd and
  // what each one is. Kind comes from the filesystem, never from the token's
  // shape (EXC-916). Existence only, no reads: it drives the plan view's
  // reference affordance, which must appear only for something real.
  //
  // De-duped BEFORE the cap, so a plan repeating one path can't crowd out the
  // ones behind it, and resolved in parallel — the wider candidate gate makes
  // this a few hundred resolves on a long plan, which a sequential loop would
  // walk one blocking syscall at a time.
  async function handleFileRefs(req: Request, id: string): Promise<Response> {
    const r = store.get(id);
    if (!r) return notFound();
    const { paths } = await parseBody(req, FileRefsBodySchema);
    // Collected with a break rather than de-duping the whole array and then
    // slicing, so the cap bounds the WORK and not just the result: the body is
    // untrusted, and FileRefsBodySchema deliberately carries no `max()` on the
    // array (one would trip its `.catch([])` and degrade the whole body).
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const p of paths) {
      if (seen.has(p)) continue;
      seen.add(p);
      if (unique.push(p) === MAX_FILE_REFS) break;
    }
    const entries = await Promise.all(
      unique.map(async (p) => {
        const hit = await resolveInCwd(r.cwd, p);
        return hit === null ? null : ([p, hit.kind] as const);
      }),
    );
    const resolved: Record<string, FileRefKind> = Object.fromEntries(
      entries.filter((e) => e !== null),
    );
    // Counts only — a candidate is plan text, and plan text is never logged.
    // `requested` is what makes the cap visible: without it a plan truncated at
    // MAX_FILE_REFS reads exactly like one that fit.
    log.debug("request", `file-refs resolved: ${Object.keys(resolved).length}/${unique.length}`, {
      reviewId: id,
      requested: paths.length,
      directories: Object.values(resolved).filter((k) => k === "directory").length,
    });
    return Response.json({ resolved } satisfies FileRefsResponse);
  }

  // GET /api/reviews/:id/file?path=&line=&start=&end= — a line-aware excerpt of
  // a plan-referenced file for the preview card. `line` centres a default
  // window; `start`/`end` state one outright (both required, and they win over
  // `line`), which is how the card's boundary strips expand toward the file's
  // ends. Resolution is confined to the review's cwd; a path that doesn't
  // resolve (missing, or escaping cwd) is a 404, and a file too large to preview
  // is a 413 so the UI can say so. File contents are never logged.
  async function handleFileExcerpt(req: Request, id: string): Promise<Response> {
    const r = store.get(id);
    if (!r) return notFound();
    const params = new URL(req.url).searchParams;
    const path = params.get("path") ?? "";
    const num = (key: string): number | undefined => {
      const raw = params.get(key);
      return raw !== null && /^\d+$/.test(raw) ? Number(raw) : undefined;
    };
    const line = num("line");
    const start = num("start");
    const end = num("end");
    const range = start !== undefined && end !== undefined ? { start, end } : undefined;
    const excerpt = await readFileExcerpt(r.cwd, path, line, range);
    if (excerpt) return Response.json(excerpt);
    return (await isFileTooLargeToPreview(r.cwd, path)) ? tooLarge() : notFound();
  }

  // GET /api/reviews/:id/dir?root=&path= — one level of a directory the plan
  // referenced, so the folder preview expands lazily instead of loading a whole
  // subtree (EXC-917). `root` is the anchor the client names — the directory the
  // reader started expanding from — and `path` is the level being asked for,
  // empty to mean the anchor itself; the pair is what lets the descent guard
  // count depth from that anchor rather than from cwd. Confined to the review's
  // cwd exactly as the file routes are, and a single 404 covers every refusal —
  // a missing directory, an escape, and a descent past the guard rail are
  // indistinguishable to the caller.
  //
  // Counts only reach the log: a directory's contents are the reader's project.
  async function handleDirListing(req: Request, id: string): Promise<Response> {
    const r = store.get(id);
    if (!r) return notFound();
    const params = new URL(req.url).searchParams;
    const listing = await listDirectory(r.cwd, params.get("root") ?? "", params.get("path") ?? "");
    if (listing === null) return notFound();
    log.debug("request", "dir listed", {
      reviewId: id,
      total: listing.total,
      returned: listing.entries.length,
    });
    return Response.json(listing);
  }

  // GET /api/reviews/:id/skills — the skill names the reviewing agent can reach,
  // for the feedback editors' `/` completion (EXC-1176). Reference only: caret
  // never executes one. Enumeration belongs to the active adapter, so this route
  // is a thin pass-through of an injected capability — 404 when none is wired, the
  // same posture /api/diagnostics takes for an absent optional capability.
  //
  // Stateless on purpose: nothing is cached here, because the browser fetches once
  // per review (see ui/src/lib/skillCompletion.ts). A skill added mid-review is
  // therefore not offered until the tab reloads, which is the deliberate trade for
  // having no cache to invalidate.
  //
  // Counts only reach the log: the names are the reviewer's own configuration.
  async function handleSkills(id: string): Promise<Response> {
    if (!cfg.listSkills) return notFound();
    const r = store.get(id);
    if (!r) return notFound();
    const skills = await cfg.listSkills(r.cwd);
    log.debug("request", "skills listed", { reviewId: id, count: skills.length });
    return Response.json(skills);
  }

  // GET /api/reviews/:id/skill-description?name=&origin= — what one skill the
  // reviewer highlighted in the `/` list actually does, for the Ctrl+Space
  // preview panel (EXC-1186). A second route beside /skills rather than a field
  // on it: the list names skills, this opens one, so a `/` keystroke never pays
  // to read every skill's file.
  //
  // The two query parameters are a row of /skills handed straight back, and the
  // handler puts them back together as the `SkillRef` the adapter takes — the
  // origin is what says WHICH skill is meant, since two roots may offer the same
  // bare name and the list deliberately shows both. A row that never arrived is
  // two empty strings, which no root answers to and the adapter reports as null.
  //
  // Reading is the adapter's, so this is a
  // thin pass-through of an injected capability, 404 when none is wired, exactly
  // as /skills is. A skill with no description is a 200 carrying null: the panel
  // renders that, and a 404 would make it read as a missing route instead.
  //
  // Neither the name nor the description reaches the log: both are the reviewer's
  // own configuration, and a description is prose someone wrote.
  async function handleSkillDescription(req: Request, id: string): Promise<Response> {
    if (!cfg.readSkillDescription) return notFound();
    const r = store.get(id);
    if (!r) return notFound();
    const params = new URL(req.url).searchParams;
    const description = await cfg.readSkillDescription(r.cwd, {
      name: params.get("name") ?? "",
      origin: params.get("origin") ?? "",
    });
    log.debug("request", "skill description read", { reviewId: id, found: description !== null });
    return Response.json({ description } satisfies SkillDescriptionResponse);
  }

  // POST /api/reviews/:id/file-search — which files under this review's cwd
  // match what the reviewer has typed after an `@` in a feedback editor
  // (EXC-1175). The browser holds no filesystem, so the search happens here, and
  // only path strings go back — never a byte of file content.
  //
  // POST rather than GET because the query is a request body: reviewer-typed
  // text, untrusted like every other body here and parsed through a schema that
  // degrades rather than rejects. It also puts the route behind the CSRF guard,
  // which safe methods bypass. The work is bounded the way handleFileRefs bounds
  // its own — by a cap that stops the WALK and not merely the result — and
  // `searchFiles` owns both caps; a cwd that no longer resolves is the same
  // single 404 the directory listing answers with.
  //
  // Counts only reach the log: the query is reviewer-typed text and the paths
  // are the reader's project, so neither is ever a record's content.
  async function handleFileSearch(req: Request, id: string): Promise<Response> {
    const r = store.get(id);
    if (!r) return notFound();
    const { query } = await parseBody(req, FileSearchBodySchema);
    const result = await searchFiles(r.cwd, query);
    if (result === null) return notFound();
    log.debug("request", "file search answered", {
      reviewId: id,
      returned: result.paths.length,
      stoppedAt: result.stoppedAt,
    });
    return Response.json(result);
  }

  // GET /api/reviews/:id/decision — the hook's long-poll for a decision.
  async function handleDecision(id: string): Promise<Response> {
    // A decision may already be recorded: in memory (a deny keeps the review) or
    // on disk (an approve removed it from memory, or the daemon restarted
    // without rehydrating it). Serve it at once so a hook that dropped its
    // long-poll and reconnected still receives the decision.
    const inMem = store.get(id);
    if (inMem?.decision) {
      clearDecision(id);
      return Response.json(inMem.decision);
    }
    if (!inMem) {
      const disk = await store.persisted(id);
      if (disk?.decision) {
        // The reconnect-recovery path — rare and diagnostic gold when a hook
        // dropped its long-poll or the daemon restarted mid-review.
        log.debug("decision", `decision served from disk: ${shortId(id)}`, { reviewId: id });
        clearDecision(id);
        return Response.json(disk.decision);
      }
    }
    // Otherwise wait, but only to the heartbeat window, then 204 so the client
    // re-polls before any socket idle timeout closes the connection.
    const decision = await raceDecision(id, heartbeat);
    if (!decision) return new Response(null, { status: 204 });
    clearDecision(id);
    return Response.json(decision);
  }

  // PUT /api/reviews/:id/draft — autosaves the reviewer's working draft: the
  // version-scoped inline annotations and the review-scoped general-comment
  // draft. Each field is independently optional so a draft-only write never
  // wipes annotations (and vice versa) — an omitted field is left alone.
  async function handleDraft(req: Request, id: string): Promise<Response> {
    const raw: unknown = await req.json().catch(() => ({}));
    const invalid = malformedLineAnchor(raw);
    if (invalid) return Response.json({ error: invalid }, { status: 400 });
    const body: DraftBody = DraftBodySchema.parse(raw);
    const updated = await store.update(id, (r) => {
      // `!= null` so an absent OR null field is left alone — guarding null keeps
      // the old `?? []` null-safety (a stray null annotations would otherwise
      // persist and crash the client's `.map`).
      if (body.annotations != null) {
        currentVersion(r).annotations = body.annotations;
      }
      if (body.generalCommentDraft != null) {
        r.generalCommentDraft = body.generalCommentDraft;
      }
      // Persist the current version's unsent composer scratches, version-scoped
      // alongside its annotations so a new plan version starts with neither; the
      // source view rehydrates them from the served ClientReview on load. Drop a
      // stale write: a scratch save whose debounce fired after a new version
      // arrived carries the version it was composed against, and its old line
      // anchors must not land on the current version (an omitted version writes,
      // for back-compat).
      const cur = currentVersion(r);
      if (
        body.composerScratches != null &&
        (body.version == null || body.version === cur.version)
      ) {
        cur.composerScratches = body.composerScratches;
      }
    });
    // Id only — draft/annotation text is reviewer prose and never logged.
    if (updated) log.debug("draft", `draft saved: ${shortId(id)}`, { reviewId: id });
    return updated ? Response.json({ ok: true }) : notFound();
  }

  // POST /api/reviews/:id/resolve — the browser's approve/deny decision.
  async function handleResolve(req: Request, id: string): Promise<Response> {
    const body: ResolveBody = await parseBody(req, ResolveBodySchema);
    const existing = store.get(id);
    // Only a pending review can be resolved — guards against a double resolve
    // diverging the store from the decision the hook received.
    if (existing?.status !== "pending") return notFound();
    const decision: Decision = {
      behavior: body.behavior === "deny" ? "deny" : "allow",
      feedback: body.feedback,
      acceptMode: body.acceptMode,
      decidedAt: Date.now(),
    };
    // Persist the decision BEFORE unblocking the hook.
    await store.update(id, (r) => {
      r.decision = decision;
      r.status = decision.behavior === "allow" ? "approved" : "rejected";
      // A submitted general comment outlives its draft: keep it on the version
      // it was written against, so a later revision can show what was asked for.
      // Gated on the deny having actually carried it — Request changes composes
      // it into the feedback verbatim, while a plain Reject sends a canned
      // message after telling the reviewer the draft would NOT be sent, so
      // keeping it there would record feedback they chose to discard. An approve
      // is terminal (store.remove drops the review), so nothing would list one.
      const general = r.generalCommentDraft?.trim();
      if (general && decision.behavior === "deny" && decision.feedback?.includes(general)) {
        currentVersion(r).generalComment = general;
      }
      // Clear the unsent draft as part of resolving (both paths): a deny keeps
      // the review on disk as rejected and must not retain stale text; an
      // approve removes it (store.remove flushes "" first).
      r.generalCommentDraft = "";
      // Same invariant for the persisted composer scratches (version-scoped).
      currentVersion(r).composerScratches = [];
    });
    // Approval is terminal: bump the session epoch (so a later plan is a fresh
    // thread) and drop it from the active set so idle can fire.
    if (decision.behavior === "allow") {
      store.bumpEpoch(existing.sessionId);
      await store.remove(id);
      // Remember the chosen variant for the UI's next load. Fire-and-forget:
      // never awaited, so it can't delay the 200 that unblocks the long-polling
      // hook. A bare allow (no acceptMode) leaves prefs as-is; an id outside the
      // adapter-declared set is ignored by writeApproveMode.
      if (decision.acceptMode !== undefined && approveModeSet.valid.includes(decision.acceptMode)) {
        void writeApproveMode(decision.acceptMode, prefsWriter, log, approveModeSet).catch(() => {
          // Recoverable: prefs only seed the UI's next default.
          log.warn("prefs", "approve mode write failed");
        });
      }
    }
    // The plan has been decided on, so the pane that submitted it no longer
    // needs the reviewer (EXC-961). Fire-and-forget: markPaneRead returns as soon
    // as the child is spawned (output discarded, unref'd), so the 200 that
    // unblocks the long-polling hook is never held on cmux.
    if (existing.cmux) cfg.markPaneRead(existing.cmux);
    // Defer one tick so THIS 200 flushes before the hook's long-poll resolves
    // (otherwise the browser's POST can appear to race the unblock).
    setTimeout(() => resolveDecision(id, decision), 0);
    log.info("resolve", `review ${shortId(id)} resolved: ${decision.behavior}`, {
      reviewId: id,
      sessionId: existing.sessionId,
      acceptMode: decision.acceptMode,
    });
    return Response.json({ ok: true });
  }

  // POST /api/reviews/:id/expire — the hook is abandoning this review: its
  // timeout fired and it is about to emit the fail-safe deny (EXC-454). No
  // decision is recorded and the session epoch is untouched: the plan was never
  // reviewed.
  async function handleExpire(id: string): Promise<Response> {
    // Drop any unsettled long-poll entry unconditionally — even when the review
    // is already gone, a zombie hook's entry would otherwise pin
    // openDecisionCount and block idle shutdown forever.
    clearDecision(id);
    const existing = store.get(id);
    // Only a pending review can expire; resolved ones are already terminal.
    if (existing?.status !== "pending") return notFound();
    await store.expire(id);
    log.info("review", `review expired: ${shortId(id)}`, {
      reviewId: id,
      sessionId: existing.sessionId,
    });
    return Response.json({ ok: true });
  }

  // POST /api/reviews/:id/seen — the reviewer has demonstrably read this plan
  // (the UI's dwell watcher fired), so the pane that submitted it no longer needs
  // their attention even though no decision has been made yet (EXC-961). Purely a
  // signal: nothing is persisted, and a review submitted outside cmux is a
  // no-op 204 rather than an error.
  function handleSeen(id: string): Response {
    const existing = store.get(id);
    if (!existing) return notFound();
    if (existing.cmux) cfg.markPaneRead(existing.cmux);
    return new Response(null, { status: 204 });
  }

  // Resolve a request to its handler by method + path, returning the Response.
  // The wrapper (handle) owns the cross-origin guard, idle/in-flight bookkeeping,
  // and the catch-all 500; dispatch is pure routing + business logic.
  async function dispatch(req: Request, method: string, path: string): Promise<Response> {
    if (method === "GET" && path === "/api/health") return handleHealth();
    if (method === "GET" && path === "/api/diagnostics") return handleDiagnostics();
    if (method === "GET" && path === "/api/update") return handleUpdate();
    if (method === "POST" && path === "/api/retire") return handleRetire();
    if (method === "GET" && (path === "/" || path === INDEX_PATH)) return handleIndex();
    if (method === "POST" && path === "/api/reviews") return handleCreateReview(req);
    if (method === "POST" && path === "/api/logs") return handleLogs(req);
    if (method === "POST" && path === "/api/ui/gone") return handleUiGone();
    if (method === "GET" && path === "/api/reviews") return handleListReviews();
    if (method === "GET" && path === "/api/prefs") return handlePrefs();
    if (method === "POST" && path === "/api/prefs") return handleSetPrefs(req);

    const route = matchIdRoute(path);
    if (route) {
      const { id, sub } = route;
      if (method === "GET" && !sub) return handleGetReview(id);
      if (method === "GET" && sub === "/file") return handleFileExcerpt(req, id);
      if (method === "GET" && sub === "/dir") return handleDirListing(req, id);
      if (method === "GET" && sub === "/skills") return handleSkills(id);
      if (method === "GET" && sub === "/skill-description") {
        return handleSkillDescription(req, id);
      }
      if (method === "POST" && sub === "/file-refs") return handleFileRefs(req, id);
      if (method === "POST" && sub === "/file-search") return handleFileSearch(req, id);
      if (method === "GET" && sub === "/decision") return handleDecision(id);
      if (method === "PUT" && sub === "/draft") return handleDraft(req, id);
      if (method === "POST" && sub === "/resolve") return handleResolve(req, id);
      if (method === "POST" && sub === "/expire") return handleExpire(id);
      if (method === "POST" && sub === "/seen") return handleSeen(id);
    }

    // A hashed sibling asset (exact manifest-key match) — checked after the API
    // routes so a UI build can never shadow one. Unknown paths fall through to
    // the uniform 404.
    if (method === "GET") {
      const asset = handleAsset(path);
      if (asset) return asset;
    }

    return notFound();
  }

  // `self` is the server Bun passes as fetch's second argument; the guards need
  // its bound port. Bun declares `readonly port: number | undefined` — undefined
  // only for a unix-socket server, which this never is. Mirroring that union
  // rather than writing `port?: number` keeps the field's existence a
  // compile-time contract: an optional property would still typecheck against a
  // Bun that dropped `port`, and every request would then 403 silently. `-1` is
  // the fail-closed fallback — no authority can serialize a port to "-1", where
  // `0` would match a `Host: localhost:0`.
  async function handle(
    req: Request,
    self: { readonly port: number | undefined },
  ): Promise<Response> {
    inFlight++;
    cancelIdle(); // any in-flight request defers an idle shutdown
    try {
      const port = self.port ?? -1;

      // DNS-rebinding gate (EXC-1203): every method, ahead of the CSRF check. A
      // rebound page's Origin is already same-origin by the time it fires, so
      // the guard below structurally cannot see this attack.
      //
      // It also runs ahead of the URL parse below, and reads the raw header
      // rather than `url.host`: Bun derives req.url FROM Host, so a missing or
      // unparseable Host — cases this must reject — would throw out of the
      // constructor into the catch-all and 500 instead.
      if (isForeignHost(req, port)) {
        return new Response("host not recognized", { status: 403 });
      }

      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;

      // Gate every non-safe (state-changing) method, not a fixed POST/PUT list,
      // so a future mutating verb is CSRF-protected by default. Safe methods
      // (GET/HEAD) fall through — the browser's same-origin policy already
      // blocks a foreign page from reading the response (see the guard's
      // threat-model note above).
      if (!isSafeMethod(method) && isCrossOrigin(req, port)) {
        return new Response("cross-origin request blocked", { status: 403 });
      }

      return await dispatch(req, method, path);
    } catch (err) {
      // Never let a handler exception drop the connection without a response —
      // and log it first (a genuine failure, so at error level), since a bare
      // 500 alone is undebuggable. The log call is itself wrapped so a broken
      // sink can't escape and suppress the 500.
      // NB: values reaching this sink must not embed plan bodies — today no
      // handler error message interpolates plan content; keep it that way.
      try {
        log.error("request", err);
      } catch {
        // best-effort: the response below is what matters.
      }
      return new Response("internal error", { status: 500 });
    } finally {
      inFlight--;
      // Reconcile idle after every request — even a thrown one — so the timer
      // is never left permanently disarmed.
      refreshIdle();
    }
  }

  // Bind to loopback only: the daemon serves plan content and accepts approve/
  // deny decisions with no auth, so it must never be reachable off-host.
  const server = Bun.serve({
    port: opts.port ?? 0,
    hostname: "127.0.0.1",
    // Derived from the heartbeat to sit strictly above it (and ≤ Bun's 255s
    // cap), so a long-poll's 204 heartbeat always ships before the socket can
    // idle out mid-wait — the invariant deriveIdleTimeoutSec holds by
    // construction (EXC-533).
    idleTimeout: deriveIdleTimeoutSec(heartbeat),
    fetch: handle,
  });
  log.info("listen", `listening on 127.0.0.1:${server.port}`, {
    build: buildId,
    version: IDENTITY.version,
    commit,
    // instanceId only — stateDir is identifying and never reaches a log (EXC-461).
    instanceId,
  });

  // Write the single-instance lock atomically (temp + rename) so a concurrent
  // reader never sees a partial file. Best-effort: the lock is an optimization
  // for graceful takeover, not required to serve.
  function writeLock() {
    if (!lockPath) return;
    try {
      ensureStateDir(dirname(lockPath));
      // Typed against the reader's DaemonLock so the on-disk shape can't drift.
      const lock: DaemonLock = {
        pid: process.pid,
        port: server.port ?? 0,
        build: buildId,
        version: IDENTITY.version,
        startedAt: Date.now(),
        stateDir,
        instanceId,
      };
      const tmp = `${lockPath}.tmp.${process.pid}`;
      writeFileSync(tmp, JSON.stringify(lock));
      renameSync(tmp, lockPath);
    } catch {
      // ignore — a missing lock only forfeits graceful takeover, never serving.
    }
  }
  function removeLock() {
    if (!lockPath) return;
    try {
      unlinkSync(lockPath);
    } catch {
      // already gone — idempotent across the multiple exit paths.
    }
  }
  writeLock();

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelIdle();
    server.stop();
    removeLock();
  }

  // Startup-if-empty: arm the idle timer when no reviews were rehydrated.
  refreshIdle();

  return { port: server.port ?? 0, stop };
}
