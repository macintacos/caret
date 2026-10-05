// The daemon's loopback HTTP client: the fetch wrappers the hooks use to talk to
// a running daemon. Each is a thin wrapper over the daemon's HTTP surface; the one
// shared piece is daemonFetch, which carries the state dir's token.

import { daemonTokenFile } from "@/config/paths.ts";
import { AUTH_CHALLENGE } from "@/daemon/auth.ts";
import { readToken } from "@/daemon/token.ts";
import type {
  ClientReview,
  CreatedReview,
  Decision,
  HealthIdentity,
  PlanInput,
  PollResult,
  ResolveBody,
} from "@/lib/types.ts";

/** A daemon 401 bearing caret's challenge: names the token file, never the token. */
export class DaemonAuthError extends Error {}

/** fetch, carrying the state dir's token when its file is readable; a 401 bearing
 * caret's challenge throws DaemonAuthError, any other 401 is returned as is. The
 * token is re-read on every call so a re-mint is picked up. */
export async function daemonFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const file = daemonTokenFile();
  const token = readToken(file);
  const headers = new Headers(init.headers);
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(url, { ...init, headers });
  if (res.status !== 401 || res.headers.get("www-authenticate") !== AUTH_CHALLENGE) return res;
  throw new DaemonAuthError(
    token === null
      ? `the daemon requires a token, but ${file} does not exist or cannot be read; restart the caret daemon to mint one, or check that XDG_STATE_HOME matches the caret service's`
      : `the daemon rejected the token in ${file}; check that XDG_STATE_HOME matches the caret service's`,
  );
}

/** Parsed /api/health body — the shared HealthIdentity shape (every field
 * absent on a pre-fix daemon). */
export type HealthBody = HealthIdentity;

/** Probe the daemon's identity. Null on any failure (connection refused, a
 * non-ok status, a timeout) — the caller treats null as "nothing answering". A
 * DaemonAuthError rejection means a daemon holds the port but refused the token. */
export async function httpHealth(baseUrl: string): Promise<HealthBody | null> {
  try {
    const res = await daemonFetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return null;
    return (await res.json()) as HealthBody;
  } catch (e) {
    if (e instanceof DaemonAuthError) throw e;
    return null;
  }
}

export interface WaitForHealthOptions {
  /** Max number of health probes before giving up. */
  attempts?: number;
  /** Delay between probes (ms). */
  intervalMs?: number;
  /** Sleep primitive; injectable so tests drive the loop without real waits. */
  sleep?: (ms: number) => Promise<void>;
}

/** Poll /api/health until the daemon answers with the caret identity. Throws once
 * the attempt budget is exhausted, or on the first probe a daemon refuses the token
 * (DaemonAuthError). The dev driver's bounded wait; the in-process takeover loop in
 * daemon-lifecycle.ts drives httpHealth on its own schedule. */
export async function waitForHealth(
  baseUrl: string,
  opts: WaitForHealthOptions = {},
): Promise<void> {
  const attempts = opts.attempts ?? 100;
  const intervalMs = opts.intervalMs ?? 100;
  const sleep = opts.sleep ?? Bun.sleep;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if ((await httpHealth(baseUrl))?.service === "caret") return;
    await sleep(intervalMs);
  }
  throw new Error("caret daemon did not become healthy in time");
}

/** Create the review. Null on a 503, the refusal of a daemon stepping down, so the
 * caller can post to its successor; any other failure throws. */
export async function postReview(baseUrl: string, input: PlanInput): Promise<CreatedReview | null> {
  const res = await daemonFetch(`${baseUrl}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 503) return null;
  if (!res.ok) throw new Error(`POST /api/reviews failed: ${res.status}`);
  // The hook reads an older daemon's missing hasLiveClient as "no live client" and
  // its missing planFileCurrent as "plan file current".
  return (await res.json()) as CreatedReview;
}

/** `?version=N` naming the version this hook posted, so the daemon can refuse a
 * hook the review has moved past; empty for a caller that knows none. */
function versionSearch(version: number | undefined): string {
  return version === undefined ? "" : `?version=${version}`;
}

/** Best-effort expire: short-fused so a dying hook never hangs on it. The
 * caller (runReview's catch) swallows any throw. */
export async function expireReview(
  baseUrl: string,
  id: string,
  version: number | undefined,
): Promise<void> {
  const res = await daemonFetch(`${baseUrl}/api/reviews/${id}/expire${versionSearch(version)}`, {
    method: "POST",
    signal: AbortSignal.timeout(1000),
  });
  // 404 = already terminal (resolved or superseded); 409 = a newer version owns the
  // review. Either way nothing of this hook's is left to expire.
  if (!res.ok && res.status !== 404 && res.status !== 409) {
    throw new Error(`POST /expire failed: ${res.status}`);
  }
}

/** Poll once for the decision. Null on a 204 heartbeat (still pending) so the
 * caller re-polls; "superseded" once a newer version owns the review; the settled
 * Decision otherwise. */
export async function longPoll(
  baseUrl: string,
  id: string,
  version: number | undefined,
): Promise<PollResult> {
  const res = await daemonFetch(`${baseUrl}/api/reviews/${id}/decision${versionSearch(version)}`);
  if (res.status === 204) return null;
  if (res.status === 409) return "superseded";
  if (!res.ok) throw new Error(`decision long-poll failed: ${res.status}`);
  return (await res.json()) as Decision;
}

/** The daemon's pending reviews (GET /api/reviews). Short-fused so the
 * post-approval reconcile hook never hangs; rejects when no daemon answers, which
 * the caller treats as "nothing to reconcile". */
export async function listReviews(baseUrl: string): Promise<ClientReview[]> {
  const res = await daemonFetch(`${baseUrl}/api/reviews`, { signal: AbortSignal.timeout(1000) });
  if (!res.ok) throw new Error(`GET /api/reviews failed: ${res.status}`);
  return (await res.json()) as ClientReview[];
}

/** Resolve a review (POST /:id/resolve) — the reconcile hook uses it to mirror a
 * terminal approval into the daemon. Short-fused; a 404 (already resolved or
 * superseded) throws like any non-ok status and the best-effort caller swallows it. */
export async function resolveReview(baseUrl: string, id: string, body: ResolveBody): Promise<void> {
  const res = await daemonFetch(`${baseUrl}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(1000),
  });
  if (!res.ok) throw new Error(`POST /resolve failed: ${res.status}`);
}
