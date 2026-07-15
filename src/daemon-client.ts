// The daemon's loopback HTTP client: the fetch wrappers the hooks use to talk to
// a running daemon — health probe, post a review, expire it, long-poll for the
// decision, and (for the post-approval reconcile hook) list pending reviews and
// resolve one. Each is a thin wrapper over the daemon's HTTP surface, kept plain
// (no client abstraction) so the call sites read as the requests they are.

import type {
  ClientReview,
  Decision,
  HealthIdentity,
  PlanInput,
  ResolveBody,
} from "./lib/types.ts";

/** Parsed /api/health body — the shared HealthIdentity shape (every field
 * absent on a pre-fix daemon). */
export type HealthBody = HealthIdentity;

/** Probe the daemon's identity. Null on any failure (connection refused, a
 * non-ok status, a timeout) — the caller treats null as "nothing answering". */
export async function httpHealth(baseUrl: string): Promise<HealthBody | null> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(500),
    });
    if (!res.ok) return null;
    return (await res.json()) as HealthBody;
  } catch {
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

/** Poll /api/health until the daemon answers with the caret identity, or throw
 * once the attempt budget is exhausted. The single bounded health-wait the
 * out-of-process callers share (the dev driver and the e2e fixture, which boot
 * a daemon and then wait for it to listen); the in-process takeover loop in
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

export async function postReview(
  baseUrl: string,
  input: PlanInput,
): Promise<{ id: string; hasLiveClient?: boolean }> {
  const res = await fetch(`${baseUrl}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`POST /api/reviews failed: ${res.status}`);
  // hasLiveClient is optional: an older daemon (mid-upgrade version skew) omits
  // it, and the hook treats its absence as "no live client" — i.e. open the
  // browser, today's behavior (EXC-559).
  return (await res.json()) as { id: string; hasLiveClient?: boolean };
}

/** Best-effort expire: short-fused so a dying hook never hangs on it. The
 * caller (runReview's catch) swallows any throw. */
export async function expireReview(baseUrl: string, id: string): Promise<void> {
  const res = await fetch(`${baseUrl}/api/reviews/${id}/expire`, {
    method: "POST",
    signal: AbortSignal.timeout(1000),
  });
  // 404 = already terminal (resolved or superseded) — nothing left to expire.
  if (!res.ok && res.status !== 404) throw new Error(`POST /expire failed: ${res.status}`);
}

export async function longPoll(baseUrl: string, id: string): Promise<Decision | null> {
  const res = await fetch(`${baseUrl}/api/reviews/${id}/decision`);
  if (res.status === 204) return null; // heartbeat: still pending — re-poll
  if (!res.ok) throw new Error(`decision long-poll failed: ${res.status}`);
  return (await res.json()) as Decision;
}

/** The daemon's pending reviews (GET /api/reviews). Short-fused so the
 * post-approval reconcile hook never hangs; rejects when no daemon answers, which
 * the caller treats as "nothing to reconcile". */
export async function listReviews(baseUrl: string): Promise<ClientReview[]> {
  const res = await fetch(`${baseUrl}/api/reviews`, { signal: AbortSignal.timeout(1000) });
  if (!res.ok) throw new Error(`GET /api/reviews failed: ${res.status}`);
  return (await res.json()) as ClientReview[];
}

/** Resolve a review (POST /:id/resolve) — the reconcile hook uses it to mirror a
 * terminal approval into the daemon. Short-fused; a 404 (already resolved or
 * superseded) throws like any non-ok status and the best-effort caller swallows it. */
export async function resolveReview(baseUrl: string, id: string, body: ResolveBody): Promise<void> {
  const res = await fetch(`${baseUrl}/api/reviews/${id}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(1000),
  });
  if (!res.ok) throw new Error(`POST /resolve failed: ${res.status}`);
}
