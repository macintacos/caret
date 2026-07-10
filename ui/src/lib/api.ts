// Same-origin JSON API client. All paths are relative `/api/...`; in dev the
// Vite proxy forwards them to the daemon on :42718.

import { shortId, uiLog } from "./log.ts";
import type {
  Annotation,
  ApproveVariantId,
  ClientReview,
  FileExcerpt,
  FileRefsResponse,
  HealthIdentity,
  ResolveBody,
} from "@core/types";

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

export async function getHealth(): Promise<HealthIdentity> {
  // Only the failure path is worth a UI record; a healthy probe is silent.
  try {
    return await json(await fetch("/api/health"));
  } catch (err) {
    uiLog.warn("request", "health probe failed", { reason: String(err) });
    throw err;
  }
}

/** One-time read (on UI load) of the machine-global remembered approve variant.
 * Deliberately not part of the 2s reviews poll. */
export async function getApproveMode(): Promise<ApproveVariantId> {
  try {
    const { approveMode } = await json<{ approveMode: ApproveVariantId }>(
      await fetch("/api/prefs"),
    );
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
  // Only the failure path is worth a UI record; a successful read is silent.
  try {
    return await json(await fetch(`/api/reviews/${encodeURIComponent(id)}`));
  } catch (err) {
    if (err instanceof HttpError) {
      uiLog.warn("request", `review fetch failed: ${shortId(id)}: http ${err.status}`, {
        reviewId: id,
        status: err.status,
      });
    } else {
      uiLog.error("request", err, { reviewId: id });
    }
    throw err;
  }
}

/** Of the plan's candidate filename references, which resolve to a real file
 * inside the review's cwd — the daemon is the existence gate, so the plan view's
 * filename icon appears only for these. Non-essential: a failed request degrades
 * to an empty list (no icons) rather than throwing, and an empty candidate list
 * skips the round trip entirely. */
export async function resolveFileRefs(id: string, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  try {
    const { resolved } = await json<FileRefsResponse>(
      await fetch(`/api/reviews/${encodeURIComponent(id)}/file-refs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      }),
    );
    return resolved;
  } catch (err) {
    uiLog.warn("request", `file refs resolve failed: ${shortId(id)}`, {
      reviewId: id,
      candidateCount: paths.length,
      reason: String(err),
    });
    return [];
  }
}

/** A bounded, line-aware excerpt of a plan-referenced file for the hover
 * preview: the excerpt centers on `line` when given, else the file's head.
 * Throws HttpError on a non-2xx so the popover can render a fallback. */
export async function getFileExcerpt(
  id: string,
  path: string,
  line?: number,
): Promise<FileExcerpt> {
  const params = new URLSearchParams({ path });
  if (line !== undefined) params.set("line", String(line));
  return json(await fetch(`/api/reviews/${encodeURIComponent(id)}/file?${params}`));
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
