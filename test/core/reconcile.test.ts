import { expect, test } from "bun:test";
import { runReconcile } from "../../src/reconcile.ts";
import type { ClientReview, PlanInput } from "../../src/lib/types.ts";
import { setupTempStateDir } from "../support/env.ts";

// Point the state dir at a throwaway temp dir so reconcile's best-effort log
// lines append to a disposable caret.log, not the real ~/.local/state/caret.
setupTempStateDir("caret-reconcile-");

// A tool-agnostic fake stdin parser: runReconcile takes parseHookInput as an
// injected dependency, so this suite stays in test/core/ without reaching into
// any adapter (the real parser is exercised in test/adapters/<tool>/).
function fakeParseHookInput(stdin: string): PlanInput {
  const h = JSON.parse(stdin) as { session_id?: string; tool_input?: { plan?: string } };
  return { sessionId: h.session_id, plan: h.tool_input?.plan };
}

function clientReview(over: Partial<ClientReview> = {}): ClientReview {
  return {
    id: "rid",
    sessionId: "S",
    cwd: "/p",
    title: "t",
    status: "pending",
    planEpoch: 0,
    version: 1,
    currentPlan: "# P",
    annotations: [],
    versions: [],
    generalCommentDraft: "",
    composerScratches: [],
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

function reconcileDeps(over: Partial<Parameters<typeof runReconcile>[1]> = {}) {
  return {
    parseHookInput: fakeParseHookInput,
    listReviews: async () => [] as ClientReview[],
    resolveReview: async () => {},
    ...over,
  };
}

const stdin = JSON.stringify({ session_id: "S", tool_input: { plan: "# P" } });

test("a pending review for this session is reconciled to approved", async () => {
  const resolved: string[] = [];
  await runReconcile(
    stdin,
    reconcileDeps({
      listReviews: async () => [clientReview({ id: "rid", sessionId: "S" })],
      resolveReview: async (id: string) => {
        resolved.push(id);
      },
    }),
  );
  expect(resolved).toEqual(["rid"]);
});

test("no pending review for this session is a no-op (the UI already resolved it)", async () => {
  const resolved: string[] = [];
  await runReconcile(
    stdin,
    reconcileDeps({
      listReviews: async () => [clientReview({ id: "other", sessionId: "OTHER" })],
      resolveReview: async (id: string) => {
        resolved.push(id);
      },
    }),
  );
  expect(resolved).toEqual([]);
});

test("an empty pending list is a no-op", async () => {
  const resolved: string[] = [];
  await runReconcile(
    stdin,
    reconcileDeps({
      listReviews: async () => [],
      resolveReview: async (id: string) => {
        resolved.push(id);
      },
    }),
  );
  expect(resolved).toEqual([]);
});

test("no daemon answering (listReviews rejects) is a silent no-op, never throws", async () => {
  const resolved: string[] = [];
  await expect(
    runReconcile(
      stdin,
      reconcileDeps({
        listReviews: async () => {
          throw new Error("connection refused");
        },
        resolveReview: async (id: string) => {
          resolved.push(id);
        },
      }),
    ),
  ).resolves.toBeUndefined();
  expect(resolved).toEqual([]);
});

test("unparseable stdin is a silent no-op, never throws", async () => {
  const resolved: string[] = [];
  await expect(
    runReconcile(
      "not json",
      reconcileDeps({
        resolveReview: async (id: string) => {
          resolved.push(id);
        },
      }),
    ),
  ).resolves.toBeUndefined();
  expect(resolved).toEqual([]);
});

test("stdin without a session id short-circuits before listing reviews", async () => {
  let listed = 0;
  await runReconcile(
    JSON.stringify({ tool_input: { plan: "# P" } }),
    reconcileDeps({
      listReviews: async () => {
        listed++;
        return [];
      },
    }),
  );
  expect(listed).toBe(0);
});

test("a resolve failure is swallowed (best-effort), never throws", async () => {
  await expect(
    runReconcile(
      stdin,
      reconcileDeps({
        listReviews: async () => [clientReview({ id: "rid", sessionId: "S" })],
        resolveReview: async () => {
          throw new Error("resolve 404 — raced with a UI resolve");
        },
      }),
    ),
  ).resolves.toBeUndefined();
});
