// Same-origin JSON API client. All paths are relative `/api/...`; in dev the
// Vite proxy forwards them to the daemon on :42718.

import type {
  Annotation,
  ApproveVariantId,
  ClientReview,
  DaemonDiagnostics,
  DirListing,
  FileExcerpt,
  FileRefKind,
  FileRefsResponse,
  FileSearchResponse,
  HealthIdentity,
  PersistedScratch,
  PrefsPatch,
  PrefsResponse,
  ResolveBody,
  SkillDescriptionResponse,
  SkillRef,
  UpdateReport,
} from "@core/lib/types";
import { shortId, uiLog } from "$lib/log.ts";

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

/** The daemon's self-diagnostics for the settings Advanced pane (EXC-842):
 * system/runtime identity, uptime, the live parsed settings, and the config path.
 * Failure is a UI-worthy record (the pane degrades those blocks); a healthy probe
 * is silent, like getHealth. */
export async function getDiagnostics(): Promise<DaemonDiagnostics> {
  try {
    return await json(await fetch("/api/diagnostics"));
  } catch (err) {
    uiLog.warn("request", "diagnostics probe failed", { reason: String(err) });
    throw err;
  }
}

/** The cached update verdict (EXC-1207): whether this caret is behind, and the command
 * that would take the upgrade. Reading it never makes the daemon call out — the verdict
 * was decided at boot — so this is a plain load-time read, not a poll.
 *
 * Throws on failure, unlike this file's degrading readers: every update surface renders
 * this one value, so there is nothing to fall back to. A 404 is a daemon that wires no
 * update thunk at all — App leaves the report null and every surface stays quiet. */
export async function getUpdate(): Promise<UpdateReport> {
  try {
    return await json(await fetch("/api/update"));
  } catch (err) {
    uiLog.warn("request", "update report read failed", { reason: String(err) });
    throw err;
  }
}

/** Whether the daemon's update check is on (EXC-1207) — the browser's copy of the
 * `updates.check` opt-out, so flipping the Settings toggle silences the badges at once
 * rather than after the daemon's next boot.
 *
 * A second GET of /api/prefs on load (the resolve state already makes one for
 * approveMode). Threading a shared read through resolve.svelte.ts and its tests would
 * cost a refactor to save one loopback request against a local daemon. Fails safe to on,
 * matching the daemon's own read. */
export async function getUpdatesCheck(): Promise<boolean> {
  try {
    const body = await json<PrefsResponse>(await fetch("/api/prefs"));
    return body.updates?.check !== false;
  } catch (err) {
    uiLog.warn("prefs", "updates check read failed", { reason: String(err) });
    return true;
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

/** Write the daemon-owned prefs a settings control may change (EXC-1206).
 *
 * The one API function here that rewrites its own failure message. A settings control
 * renders whatever this throws in a persistent toast, and `HttpError`'s message is
 * `"HTTP 400"` — a status line, not something a person can act on. The two failure
 * classes stay apart because only one of them is the reviewer's to fix: an unreachable
 * daemon they can start, a refused body they cannot. */
export async function setPrefs(patch: PrefsPatch): Promise<void> {
  try {
    await json<{ ok: true }>(
      await fetch("/api/prefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    );
  } catch (err) {
    uiLog.warn("prefs", "prefs save failed", { reason: String(err) });
    // The status rides in the sentence rather than being the whole of it, and `cause`
    // keeps the HttpError for anyone who wants to branch on it.
    throw new Error(
      err instanceof HttpError
        ? `The daemon couldn't save the change (HTTP ${err.status}).`
        : "The caret daemon isn't reachable, so the change wasn't saved.",
      { cause: err },
    );
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

/** Of the plan's candidate path references, which resolve inside the review's
 * cwd and what each one is — the daemon holds the filesystem, so it is both the
 * existence gate and the only thing that can say file vs. directory (EXC-916).
 * A path that resolves to nothing is absent from the result. Non-essential: a
 * failed request degrades to nothing resolved (no icons) rather than throwing,
 * and an empty candidate list skips the round trip entirely. */
export async function resolveFileRefs(
  id: string,
  paths: string[],
): Promise<Record<string, FileRefKind>> {
  if (paths.length === 0) return {};
  try {
    const { resolved } = await json<FileRefsResponse>(
      await fetch(`/api/reviews/${encodeURIComponent(id)}/file-refs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths }),
      }),
    );
    // `?? {}` keeps the never-throws promise above honest against a 2xx whose
    // body is missing the field: the consumer walks this with Object.entries.
    return resolved ?? {};
  } catch (err) {
    uiLog.warn("request", `file refs resolve failed: ${shortId(id)}`, {
      reviewId: id,
      candidateCount: paths.length,
      reason: String(err),
    });
    return {};
  }
}

/** The files under the review's cwd whose path matches what the reviewer has
 * typed after an `@` in a feedback editor (EXC-1175) — the daemon holds the
 * filesystem, so it is the only thing that can answer. Non-essential in exactly
 * the way `resolveFileRefs` is: a failed request degrades to no matches rather
 * than throwing, so the editor keeps behaving as it did before completion
 * existed and no error reaches the reviewer. */
export async function searchFiles(id: string, query: string): Promise<FileSearchResponse> {
  try {
    const body = await json<FileSearchResponse>(
      await fetch(`/api/reviews/${encodeURIComponent(id)}/file-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      }),
    );
    // Defensive against a 2xx whose body is missing a field, for the same reason
    // resolveFileRefs is: the caller maps over `paths` and branches on `stoppedAt`.
    return {
      paths: body.paths ?? [],
      stoppedAt: body.stoppedAt === "results" || body.stoppedAt === "scan" ? body.stoppedAt : null,
    };
  } catch (err) {
    // `debug`, not `warn`, and deliberately so: this fires once per debounced
    // keystroke, and a review whose cwd is gone fails every one of them. A `warn`
    // per character is the per-iteration noise logging-rules.md forbids, in the
    // same timeline /caret:debug reads. The daemon logs this exchange at debug
    // too, and the once-per-render resolveFileRefs is what `warn` is sized for.
    uiLog.debug("request", `file search failed: ${shortId(id)}`, {
      reviewId: id,
      queryChars: query.length,
      reason: String(err),
    });
    return { paths: [], stoppedAt: null };
  }
}

/** A line-aware excerpt of a plan-referenced file for the preview panel: the
 * 1-based inclusive `range` when given, else a window centred on `line`, else
 * the file's head. Throws HttpError on a non-2xx so the preview can tell a
 * too-large file (413) from any other failure. */
export async function getFileExcerpt(
  id: string,
  path: string,
  line?: number,
  range?: { start: number; end: number },
): Promise<FileExcerpt> {
  const params = new URLSearchParams({ path });
  if (line !== undefined) params.set("line", String(line));
  if (range !== undefined) {
    params.set("start", String(range.start));
    params.set("end", String(range.end));
  }
  return json(await fetch(`/api/reviews/${encodeURIComponent(id)}/file?${params}`));
}

/** One level of a directory the plan referenced, for the folder popover's lazy
 * expansion (EXC-917). `root` is the anchor the reader started expanding from —
 * the reference as written in the prose — and `path` is the level being asked
 * for, empty to mean the anchor itself. The pair is what lets the route bound the
 * descent, so `root` travels on every request rather than only the first.
 *
 * Throws HttpError on a non-2xx. The route answers every refusal with one 404 —
 * a missing directory, an escape, a descent past the guard rail — so the card has
 * a single failure state to render rather than a taxonomy it can't act on. */
export async function getDirListing(id: string, root: string, path: string): Promise<DirListing> {
  const params = new URLSearchParams({ root, path });
  return json(await fetch(`/api/reviews/${encodeURIComponent(id)}/dir?${params}`));
}

/** The skill names the agent reviewing this review can reach, for the feedback
 * editors' `/` completion (EXC-1176) — the daemon holds the filesystem, so it is
 * the only thing that can enumerate them. Reference only: caret never executes a
 * completed skill.
 *
 * Non-essential, like `resolveFileRefs`: nothing here throws, so the editor
 * behaves exactly as it did before completion existed. The two ways of having no
 * skills are kept apart, because only one of them is worth asking again:
 *
 * - **A 404 answers `[]`** — a daemon that wires no skill capability at all (the
 *   e2e fixture daemon 404s this route deliberately). That is a settled answer,
 *   so the caller may cache it; re-asking would mean a round trip per keystroke.
 * - **Anything else answers `null`** — offline, a 5xx, a daemon mid-restart. The
 *   answer is unknown rather than empty, so the caller drops it and retries. */
export async function getSkills(id: string): Promise<SkillRef[] | null> {
  try {
    return await json<SkillRef[]>(await fetch(`/api/reviews/${encodeURIComponent(id)}/skills`));
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      uiLog.debug("request", `skills route unwired: ${shortId(id)}`, { reviewId: id });
      return [];
    }
    uiLog.warn("request", `skills fetch failed: ${shortId(id)}`, {
      reviewId: id,
      reason: String(err),
    });
    return null;
  }
}

/** What one skill the reviewer highlighted in the `/` list actually does, for the
 * Ctrl+Space preview panel (EXC-1186). `skill` is that row handed straight back,
 * whole — the origin is what says which skill is meant, since two roots may offer
 * the same bare name and the list deliberately shows both.
 *
 * Null covers both "this skill describes itself nowhere" and every failure,
 * because the panel has one thing to render either way. Non-essential in exactly
 * the way `searchFiles` is: nothing throws, so the list keeps working when the
 * read does not — a 404 from a daemon that wires no such capability included.
 *
 * `debug` rather than `warn`, and for the same reason `searchFiles` is: this
 * fires once per highlighted row, so a `warn` per arrow key is the per-iteration
 * noise logging-rules.md forbids. A description that simply is not there is not a
 * failure at all and is logged nowhere. */
export async function getSkillDescription(id: string, skill: SkillRef): Promise<string | null> {
  const params = new URLSearchParams({ name: skill.name, origin: skill.origin });
  try {
    const body = await json<SkillDescriptionResponse>(
      await fetch(`/api/reviews/${encodeURIComponent(id)}/skill-description?${params}`),
    );
    // Defensive against a 2xx whose body is missing the field, for the same
    // reason `searchFiles` is: the caller renders this straight into the panel.
    return body.description ?? null;
  } catch (err) {
    uiLog.debug("request", `skill description read failed: ${shortId(id)}`, {
      reviewId: id,
      reason: String(err),
    });
    return null;
  }
}

/** Autosaves the reviewer's working draft: inline annotations, the review-scoped
 * general-comment draft, and the current version's unsent composer scratches, sent
 * together from one snapshot. */
export async function putDraft(
  id: string,
  draft: {
    annotations: Annotation[];
    generalCommentDraft: string;
    composerScratches: PersistedScratch[];
    version?: number;
  },
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

/** Tell the daemon the reviewer has read this plan, so it can clear the unread
 * mark on the cmux pane that submitted it (EXC-961). Non-essential: a failed
 * mark just leaves the pane unread, so failure is swallowed rather than thrown.
 * Deliberately `debug` rather than the `warn` this file's other swallowed
 * failures use — a dwell that fires just after the review resolved 404s, which
 * is a routine race, and warning on it every time would be noise. */
export async function markSeen(id: string): Promise<void> {
  try {
    const res = await fetch(`/api/reviews/${encodeURIComponent(id)}/seen`, { method: "POST" });
    if (!res.ok) throw new HttpError(res.status);
    uiLog.debug("ui", `review seen: ${shortId(id)}`, { reviewId: id });
  } catch (err) {
    uiLog.debug("ui", `review seen mark failed: ${shortId(id)}`, {
      reviewId: id,
      reason: String(err),
    });
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
