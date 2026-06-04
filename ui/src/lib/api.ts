// Same-origin JSON API client. All paths are relative `/api/...`; in dev the
// Vite proxy forwards them to the daemon on :42718.

import { shortId, uiLog } from "./log.ts";
import type { AcceptMode, Annotation, ClientReview, Health, ResolveBody } from "./types.ts";

/** Thrown when the daemon responded with a non-2xx status — distinct from a
 * network failure (the daemon is up, so it's not a connection problem). */
export class HttpError extends Error {
  constructor(public readonly status: number) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new HttpError(res.status);
  return (await res.json()) as T;
}

export async function getHealth(): Promise<Health> {
  return json(await fetch("/api/health"));
}

/** One-time read (on UI load) of the machine-global remembered approve mode.
 * Deliberately not part of the 2s reviews poll. */
export async function getApproveMode(): Promise<AcceptMode> {
  try {
    const { approveMode } = await json<{ approveMode: AcceptMode }>(await fetch("/api/prefs"));
    return approveMode;
  } catch (err) {
    uiLog.warn("prefs", "approve mode read failed", { reason: String(err) });
    throw err;
  }
}

export async function listReviews(): Promise<ClientReview[]> {
  return json(await fetch("/api/reviews"));
}

export async function getReview(id: string): Promise<ClientReview> {
  return json(await fetch(`/api/reviews/${encodeURIComponent(id)}`));
}

/** Autosaves the reviewer's working draft: inline annotations and the
 * review-scoped general-comment draft, sent together from one snapshot. */
export async function putDraft(
  id: string,
  draft: { annotations: Annotation[]; generalCommentDraft: string },
): Promise<void> {
  // Success is logged daemon-side; only the failure path is worth a UI record.
  try {
    await json<{ ok: true }>(
      await fetch(`/api/reviews/${encodeURIComponent(id)}/draft`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      }),
    );
  } catch (err) {
    uiLog.warn("draft", `draft save failed: ${shortId(id)}`, {
      reviewId: id,
      annotationCount: draft.annotations.length,
      reason: String(err),
    });
    throw err;
  }
}

export async function resolveReview(id: string, body: ResolveBody): Promise<void> {
  // Intent record before the POST: the behavior plus counts/ids only — feedback
  // body text is never logged (see DENY_KEYS / redaction rules).
  uiLog.info("resolve", `resolve submitted: ${shortId(id)}: ${body.behavior}`, {
    reviewId: id,
    ...(body.acceptMode === undefined ? {} : { acceptMode: body.acceptMode }),
    ...(body.feedback === undefined ? {} : { feedbackChars: body.feedback.length }),
  });
  try {
    await json<{ ok: true }>(
      await fetch(`/api/reviews/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  } catch (err) {
    if (err instanceof HttpError) {
      uiLog.warn("resolve", `resolve failed: ${shortId(id)}: http ${err.status}`, {
        reviewId: id,
        status: err.status,
      });
    } else {
      uiLog.error("resolve", err, { reviewId: id });
    }
    throw err;
  }
}

// Re-check the daemon's identity every Nth successful poll: a same-port
// takeover by a newer build can complete between 2s polls without a single
// failed tick, so the recovery-edge check alone would miss it.
const IDENTITY_CHECK_EVERY = 5;

/**
 * Polls GET /api/reviews on an interval, invoking `onUpdate` with each fresh
 * snapshot. Returns a stop function. Errors are reported via `onError` (or
 * swallowed) so a transient daemon hiccup doesn't kill the loop.
 *
 * `onSwap` fires once when the daemon behind the port is replaced — its
 * per-boot `instanceId` (GET /api/health) differs from the last seen one. The
 * id is checked at three points: once at start (seeds the baseline), on each
 * failure→recovery edge, and on every ~5th successful poll.
 */
export function startPolling(
  onUpdate: (reviews: ClientReview[]) => void,
  intervalMs = 2000,
  onError?: (err: unknown) => void,
  onSwap?: (instanceId: string) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Transition state: log only when the poll's health flips or the pending count
  // changes — never per-tick, which would drown the timeline in noise. Health is
  // carried by `failures` alone: zero ⟺ healthy.
  let failures = 0;
  let lastCount = -1;
  let successes = 0;
  // Last-seen daemon identity. `undefined` until the first health read seeds it;
  // a pre-fix daemon (no instanceId) keeps it undefined, so detection no-ops.
  let lastInstanceId: string | undefined;

  // Fetch /api/health and compare its instanceId against the baseline. Fires
  // onSwap (and logs one warn) only when a previous id existed and differs;
  // then advances the baseline so one swap yields one notification, not one per
  // poll. Opaque ids only — stateDir is identifying and is never read/logged.
  const checkIdentity = async () => {
    let health: Health;
    try {
      health = await getHealth();
    } catch {
      return; // health hiccup is not a swap; the reviews poll tracks liveness
    }
    const id = health.instanceId;
    if (id === undefined) return; // pre-fix daemon: cannot detect, skip
    const prev = lastInstanceId;
    lastInstanceId = id;
    if (prev !== undefined && prev !== id) {
      uiLog.warn("poll", "daemon instance changed", { from: prev, to: id });
      onSwap?.(id);
    }
  };

  const tick = async () => {
    if (stopped) return;
    try {
      const reviews = await listReviews();
      if (failures > 0) {
        uiLog.info("poll", "poll recovered", { failures });
        failures = 0;
        // A swap can complete during an outage; re-check on the recovery edge.
        await checkIdentity();
      }
      if (reviews.length !== lastCount) {
        uiLog.debug("poll", `reviews pending: ${reviews.length}`, { count: reviews.length });
        lastCount = reviews.length;
      }
      successes++;
      if (successes % IDENTITY_CHECK_EVERY === 0) await checkIdentity();
      if (!stopped) onUpdate(reviews);
    } catch (err) {
      // Warn only on the healthy→unhealthy transition; a sustained outage logs once.
      if (failures === 0) uiLog.warn("poll", "poll failed", { reason: String(err) });
      failures++;
      onError?.(err);
    } finally {
      if (!stopped) timer = setTimeout(tick, intervalMs);
    }
  };

  // Seed the identity baseline before the first poll so a later swap has
  // something to differ from.
  void checkIdentity().then(tick);

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
