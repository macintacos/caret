// The daemon's loopback HTTP client: the four fetch wrappers the hook uses to
// talk to a running daemon — health probe, post a review, expire it, and
// long-poll for the decision. Each is a thin wrapper over the daemon's HTTP
// surface, kept plain (no client abstraction) so the call sites read as the
// requests they are.

import type { Decision, HealthIdentity, PlanInput } from "./types.ts";

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

export async function postReview(baseUrl: string, input: PlanInput): Promise<{ id: string }> {
  const res = await fetch(`${baseUrl}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`POST /api/reviews failed: ${res.status}`);
  return (await res.json()) as { id: string };
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
