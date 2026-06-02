// Same-origin JSON API client. All paths are relative `/api/...`; in dev the
// Vite proxy forwards them to the daemon on :42718.

import type { Annotation, ClientReview, Health, ResolveBody } from "./types.ts";

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export async function getHealth(): Promise<Health> {
  return json(await fetch("/api/health"));
}

export async function listReviews(): Promise<ClientReview[]> {
  return json(await fetch("/api/reviews"));
}

export async function getReview(id: string): Promise<ClientReview> {
  return json(await fetch(`/api/reviews/${encodeURIComponent(id)}`));
}

export async function putAnnotations(id: string, annotations: Annotation[]): Promise<void> {
  await json<{ ok: true }>(
    await fetch(`/api/reviews/${encodeURIComponent(id)}/annotations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ annotations }),
    }),
  );
}

export async function resolveReview(id: string, body: ResolveBody): Promise<void> {
  await json<{ ok: true }>(
    await fetch(`/api/reviews/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
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

  const tick = async () => {
    if (stopped) return;
    try {
      const reviews = await listReviews();
      if (!stopped) onUpdate(reviews);
    } catch (err) {
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
