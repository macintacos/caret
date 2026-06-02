#!/usr/bin/env bun
// Deterministic dev driver: plays the agent's side of the caret protocol so
// `mise run dev` shows a fake plan that survives request-changes / approve
// round-trips — no real Claude session, no LLM. It seeds one fake plan, then
// long-polls the decision and either threads a canned revision (on
// request-changes, reusing the sessionId) or re-seeds a fresh plan (on approve).
//
// Mirrors the HTTP protocol helpers in src/cli.ts (postReview / longPoll /
// httpHealth) and the revision-threading contract in src/reviews.ts.

import { DEFAULT_PORT } from "../../src/paths.ts";
import type { Decision, PlanInput } from "../../src/types.ts";

/** Fixed session for the single dev review; reused across versions so a
 * revision threads into the same review instead of forking a new one. */
export const DEV_SESSION = "caret-dev";

const log = (msg: string) => process.stderr.write(`[caret dev driver] ${msg}\n`);

function fixture(name: string): Promise<string> {
  return Bun.file(`${import.meta.dir}/${name}`).text();
}

async function postPlan(base: string, plan: string): Promise<string> {
  const input: PlanInput = { sessionId: DEV_SESSION, cwd: process.cwd(), plan };
  const res = await fetch(`${base}/api/reviews`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`POST /api/reviews failed: ${res.status}`);
  const { id } = (await res.json()) as { id: string };
  return id;
}

/** Seed the v1 fake plan as a new pending review. Used for the initial seed and
 * to re-seed after an approve (the prior review is gone, so this starts a fresh
 * thread). */
export async function seedPlan(base: string): Promise<string> {
  return postPlan(base, await fixture("fake-plan.md"));
}

/** Post the canned v2 revision, reusing DEV_SESSION so it appends as a new
 * version of the rejected review rather than forking a new one. */
export async function postRevision(base: string): Promise<string> {
  return postPlan(base, await fixture("fake-plan.revised.md"));
}

/** Poll GET /api/health until the daemon reports the caret identity. */
export async function waitForHealth(base: string, maxAttempts = 100): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok && ((await res.json()) as { service?: string }).service === "caret") return;
    } catch {
      // not up yet — keep polling
    }
    await Bun.sleep(100);
  }
  throw new Error("caret dev daemon did not become healthy in time");
}

/** One bounded decision poll: a Decision, or null on a 204 heartbeat. */
export async function longPollOnce(base: string, id: string): Promise<Decision | null> {
  const res = await fetch(`${base}/api/reviews/${id}/decision`);
  if (res.status === 204) return null;
  if (!res.ok) throw new Error(`decision long-poll failed: ${res.status}`);
  return (await res.json()) as Decision;
}

/** Refuse to run unless the dev port + isolated state dir are explicitly set —
 * never fall back to the production defaults and touch an installed caret. */
export function assertDevEnv(): void {
  const port = process.env.CARET_PORT;
  if (!port || Number(port) === DEFAULT_PORT) {
    throw new Error(
      `caret dev driver requires CARET_PORT set to a dev port distinct from the production default (${DEFAULT_PORT})`,
    );
  }
  if (!process.env.XDG_STATE_HOME) {
    throw new Error("caret dev driver requires XDG_STATE_HOME set to an isolated dev state dir");
  }
}

/** Seed a plan, then keep the dev review alive across decisions forever. */
export async function run(): Promise<void> {
  assertDevEnv();
  const base = `http://127.0.0.1:${process.env.CARET_PORT}`;
  await waitForHealth(base);
  let id = await seedPlan(base);
  log(`seeded fake plan as review ${id}`);

  for (;;) {
    let decision: Decision | null;
    try {
      decision = await longPollOnce(base, id);
    } catch {
      await Bun.sleep(500); // transient drop — back off and reconnect
      continue;
    }
    if (!decision) continue; // heartbeat: still pending
    if (decision.behavior === "deny") {
      id = await postRevision(base);
      log(`changes requested → posted revision as review ${id}`);
    } else {
      id = await seedPlan(base);
      log(`approved → re-seeded a fresh plan as review ${id}`);
    }
  }
}

if (import.meta.main) {
  run().catch((err) => {
    process.stderr.write(`caret dev driver: ${err}\n`);
    process.exit(1);
  });
}
