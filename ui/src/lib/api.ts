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

/**
 * Polls GET /api/reviews on an interval, invoking `onUpdate` with each fresh
 * snapshot. Returns a stop function. Errors are reported via `onError` (or
 * swallowed) so a transient daemon hiccup doesn't kill the loop.
 */
export function startPolling(
  onUpdate: (reviews: ClientReview[]) => void,
  intervalMs = 2000,
  onError?: (err: unknown) => void,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Transition state: log only when the poll's health flips or the pending count
  // changes — never per-tick, which would drown the timeline in noise. Health is
  // carried by `failures` alone: zero ⟺ healthy.
  let failures = 0;
  let lastCount = -1;

  const tick = async () => {
    if (stopped) return;
    try {
      const reviews = await listReviews();
      if (failures > 0) {
        uiLog.info("poll", "poll recovered", { failures });
        failures = 0;
      }
      if (reviews.length !== lastCount) {
        uiLog.debug("poll", `reviews pending: ${reviews.length}`, { count: reviews.length });
        lastCount = reviews.length;
      }
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

  void tick();

  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
  };
}
