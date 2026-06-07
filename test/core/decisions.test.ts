import { beforeEach, expect, test } from "bun:test";
import { createDecisions, type DecisionRegistry } from "../../src/decisions.ts";
import type { Decision } from "../../src/types.ts";
import { recordingLog } from "../support/recording-log.ts";

const decision = (behavior: "allow" | "deny"): Decision => ({
  behavior,
  decidedAt: 1,
});

let d: DecisionRegistry;
beforeEach(() => {
  d = createDecisions();
});

test("await-then-resolve resolves the promise with the decision", async () => {
  const p = d.awaitDecision("r1");
  expect(d.resolveDecision("r1", decision("allow"))).toBe(true);
  await expect(p).resolves.toEqual({ behavior: "allow", decidedAt: 1 });
});

test("resolve-before-await: a later await still receives the decision", async () => {
  expect(d.resolveDecision("r2", decision("deny"))).toBe(true);
  await expect(d.awaitDecision("r2")).resolves.toEqual({
    behavior: "deny",
    decidedAt: 1,
  });
});

test("double resolve is a no-op and returns false", async () => {
  const p = d.awaitDecision("r3");
  expect(d.resolveDecision("r3", decision("allow"))).toBe(true);
  expect(d.resolveDecision("r3", decision("deny"))).toBe(false);
  await expect(p).resolves.toEqual({ behavior: "allow", decidedAt: 1 });
});

test("openDecisionCount tracks unsettled entries", () => {
  expect(d.openDecisionCount()).toBe(0);
  d.awaitDecision("a");
  d.awaitDecision("b");
  expect(d.openDecisionCount()).toBe(2);
  d.resolveDecision("a", decision("allow"));
  expect(d.openDecisionCount()).toBe(1);
  d.clearDecision("b");
  expect(d.openDecisionCount()).toBe(0);
});

test("a double resolve is logged at warn (EXC-444)", () => {
  const { recs, log } = recordingLog();
  const reg = createDecisions(log);
  reg.resolveDecision("r9", decision("allow"));
  reg.resolveDecision("r9", decision("deny"));
  // Stable contract: exactly one warn-level "resolve" record carrying the
  // reviewId in its structured field. The id rides the durable `extra.reviewId`
  // (warn, not error — a recoverable double-resolve); the prose isn't pinned.
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ level: "warn", step: "resolve", extra: { reviewId: "r9" } });
});

test("clearDecision removes a settled entry", () => {
  d.awaitDecision("c");
  d.resolveDecision("c", decision("allow"));
  d.clearDecision("c");
  d.awaitDecision("c");
  expect(d.openDecisionCount()).toBe(1);
});
