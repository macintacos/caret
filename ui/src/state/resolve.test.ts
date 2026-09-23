import "@ui/support/setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";

import type { Annotation, ApproveVariantId, ResolveBody } from "@core/lib/types";
import {
  createResolve,
  HttpError,
  isNetworkFailure,
  type ResolveStore,
} from "@/state/resolve.svelte.ts";

interface SubmitCall {
  id: string;
  body: ResolveBody;
}

let submits: SubmitCall[];
let submitResult: () => Promise<void>;
let advanced: string[];
let flushOrder: string[];
let offline: boolean;
let superseded: number;
let cleared: number;
let saved: ApproveVariantId[];

function makeStore(over: Partial<ResolveStore> = {}): ResolveStore {
  return { approveMode: "default", busy: false, ...over };
}

function build(
  store: ResolveStore,
  opts: {
    activeId?: string | null;
    activeVersion?: number;
    /** The version the poll delivers while the flush is in flight. */
    versionAfterFlush?: number;
    annotations?: Annotation[];
    planText?: string;
  } = {},
) {
  const activeId = "activeId" in opts ? (opts.activeId ?? null) : "r1";
  let version = opts.activeVersion;
  const resolve = createResolve(store, {
    resolveReview: async (id, body) => {
      submits.push({ id, body });
      return submitResult();
    },
    saveApproveMode: (mode) => saved.push(mode),
    activeId: () => activeId,
    activeVersion: () => version,
    annotations: () => opts.annotations ?? [],
    planText: () => opts.planText ?? "",
    flushPending: async () => {
      flushOrder.push("flush");
      if (opts.versionAfterFlush !== undefined) version = opts.versionAfterFlush;
    },
    afterResolve: (id) => advanced.push(id),
    onOffline: () => {
      offline = true;
    },
    onSuperseded: () => {
      superseded++;
    },
    clearGeneralComment: () => {
      cleared++;
    },
  });
  return resolve;
}

beforeEach(() => {
  submits = [];
  submitResult = () => Promise.resolve();
  advanced = [];
  flushOrder = [];
  offline = false;
  superseded = 0;
  cleared = 0;
  saved = [];
});

const TIGHTEN_ANNOTATION: Annotation = {
  id: "a1",
  blockId: "b0",
  startOffset: 0,
  endOffset: 1,
  quote: "the cache",
  comment: "tighten",
};

/** submitResult rejects with an already-resolved-elsewhere HttpError; `run`
 * still advances the review and never flips offline. Returns the store so a
 * caller can check its own extra fields. */
async function expectHttpErrorAdvances(
  run: (resolve: ReturnType<typeof build>) => Promise<void>,
): Promise<ResolveStore> {
  submitResult = () => Promise.reject(new HttpError(404));
  const store = makeStore();
  const resolve = build(store);
  await run(resolve);
  expect(advanced).toEqual(["r1"]);
  expect(offline).toBe(false);
  expect(superseded).toBe(0);
  return store;
}

/** submitResult rejects with a 409 (a newer version of this review arrived);
 * `run` stays on the review, reports it superseded, and clears busy. */
async function expectSupersededStays(
  run: (resolve: ReturnType<typeof build>) => Promise<void>,
): Promise<void> {
  submitResult = () => Promise.reject(new HttpError(409));
  const store = makeStore();
  const resolve = build(store);
  await run(resolve);
  expect(advanced).toEqual([]);
  expect(superseded).toBe(1);
  expect(offline).toBe(false);
  expect(cleared).toBe(0);
  expect(store.busy).toBe(false);
}

/** submitResult rejects with a plain network error; `run` flips offline and
 * never advances. Returns the store so a caller can check its own extra
 * fields. */
async function expectNetworkFailureBlocksAdvance(
  run: (resolve: ReturnType<typeof build>) => Promise<void>,
): Promise<ResolveStore> {
  submitResult = () => Promise.reject(new Error("down"));
  const store = makeStore();
  const resolve = build(store);
  await run(resolve);
  expect(advanced).toEqual([]);
  expect(offline).toBe(true);
  return store;
}

/** `run` flushes the pending draft before it submits. */
async function expectFlushesBeforeSubmit(
  run: (resolve: ReturnType<typeof build>) => Promise<void>,
): Promise<void> {
  const store = makeStore();
  const resolve = build(store);
  flushOrder = [];
  await run(resolve);
  expect(flushOrder).toEqual(["flush"]);
}

/** With no active review, `run` submits nothing. */
async function expectNoopWhenInactive(
  run: (resolve: ReturnType<typeof build>) => Promise<void>,
): Promise<void> {
  const store = makeStore();
  const resolve = build(store, { activeId: null });
  await run(resolve);
  expect(submits).toEqual([]);
}

describe("version ownership", () => {
  test("every decision names the version the reviewer was looking at", async () => {
    const resolve = build(makeStore(), { activeVersion: 2 });
    await resolve.approve("default");
    await resolve.requestChanges("note");
    await resolve.reject();
    expect(submits.map((s) => s.body.version)).toEqual([2, 2, 2]);
  });

  test("a version the poll delivers during the flush never rides the decision", async () => {
    await build(makeStore(), { activeVersion: 1, versionAfterFlush: 2 }).approve("default");
    await build(makeStore(), { activeVersion: 1, versionAfterFlush: 2 }).reject();
    expect(submits.map((s) => s.body.version)).toEqual([1, 1]);
  });
});

describe("isNetworkFailure", () => {
  test("an HttpError is NOT a network failure (the daemon answered)", () => {
    expect(isNetworkFailure(new HttpError(409))).toBe(false);
  });
  test("a plain error IS a network failure", () => {
    expect(isNetworkFailure(new Error("offline"))).toBe(true);
  });
});

describe("approve", () => {
  test("submits an allow with the mode, remembers it, and advances", async () => {
    const store = makeStore();
    const resolve = build(store);
    await resolve.approve("acceptEdits");
    expect(submits).toEqual([{ id: "r1", body: { behavior: "allow", acceptMode: "acceptEdits" } }]);
    expect(store.approveMode).toBe("acceptEdits");
    expect(advanced).toEqual(["r1"]);
    expect(store.busy).toBe(false);
  });

  test("submits reviewer notes as feedback on the allow (EXC-791)", async () => {
    const store = makeStore();
    const resolve = build(store);
    await resolve.approve("default", "use the retry helper");
    expect(submits).toEqual([
      {
        id: "r1",
        body: { behavior: "allow", acceptMode: "default", feedback: "use the retry helper" },
      },
    ]);
  });

  test("omits a blank note from the allow body", async () => {
    const store = makeStore();
    const resolve = build(store);
    await resolve.approve("default", "   ");
    expect(submits).toEqual([{ id: "r1", body: { behavior: "allow", acceptMode: "default" } }]);
  });

  test("flushes the pending draft before submitting", async () => {
    // flush is recorded before the submit pushes (submit awaits after flush).
    await expectFlushesBeforeSubmit((resolve) => resolve.approve("default"));
    expect(submits).toHaveLength(1);
  });

  test("no-ops when nothing is active", async () => {
    await expectNoopWhenInactive((resolve) => resolve.approve("default"));
    expect(advanced).toEqual([]);
  });

  test("an HttpError (already resolved elsewhere) still advances", async () => {
    const store = await expectHttpErrorAdvances((resolve) => resolve.approve("default"));
    expect(store.busy).toBe(false);
  });

  test("a 409 (a newer version arrived) stays on the review", async () => {
    await expectSupersededStays((resolve) => resolve.approve("default"));
    expect(saved).toEqual([]);
  });

  test("a network failure flips offline and does NOT advance", async () => {
    const store = await expectNetworkFailureBlocksAdvance((resolve) => resolve.approve("default"));
    expect(store.busy).toBe(false);
  });
});

describe("requestChanges", () => {
  test("submits a deny with formatted feedback, clears the draft, and advances", async () => {
    const store = makeStore();
    const resolve = build(store, { annotations: [TIGHTEN_ANNOTATION] });
    await resolve.requestChanges("General note.");
    expect(submits).toHaveLength(1);
    expect(submits[0]!.body.behavior).toBe("deny");
    // Feedback carries both the general comment and the inline comment.
    expect(submits[0]!.body.feedback).toContain("General note.");
    expect(submits[0]!.body.feedback).toContain("tighten");
    expect(cleared).toBe(1);
    expect(advanced).toEqual(["r1"]);
  });

  test("quotes a line-anchored annotation's source line from the plan text", async () => {
    const store = makeStore();
    const annotations: Annotation[] = [{ id: "l1", startLine: 2, endLine: 2, comment: "tighten" }];
    const planText = ["# Heading", "warm the cache on boot", "more text"].join("\n");
    const resolve = build(store, { annotations, planText });
    await resolve.requestChanges("");
    expect(submits).toHaveLength(1);
    // The plan text reaches the formatter: the quoted source line is present.
    expect(submits[0]!.body.feedback).toContain("Line 2:");
    expect(submits[0]!.body.feedback).toContain("> warm the cache on boot");
  });

  test("flushes the pending draft before formatting + submitting", async () => {
    await expectFlushesBeforeSubmit((resolve) => resolve.requestChanges("note"));
  });

  test("an HttpError still advances and clears", async () => {
    // The catch advances on an HttpError; the post-success clear does not run.
    await expectHttpErrorAdvances((resolve) => resolve.requestChanges("note"));
  });

  test("a 409 (a newer version arrived) stays on the review", async () => {
    await expectSupersededStays((resolve) => resolve.requestChanges("note"));
  });

  test("a network failure flips offline and does NOT advance", async () => {
    await expectNetworkFailureBlocksAdvance((resolve) => resolve.requestChanges("note"));
  });

  test("no-ops when nothing is active", async () => {
    await expectNoopWhenInactive((resolve) => resolve.requestChanges("note"));
  });
});

describe("reject", () => {
  test("submits a deny with the canned reject-and-wait message, clears the draft, and advances", async () => {
    const store = makeStore();
    const resolve = build(store);
    await resolve.reject();
    expect(submits).toHaveLength(1);
    expect(submits[0]!.body.behavior).toBe("deny");
    // The concise message tells the agent the plan was rejected and to wait.
    expect(submits[0]!.body.feedback).toContain("rejected");
    expect(submits[0]!.body.feedback?.toLowerCase()).toContain("wait");
    expect(cleared).toBe(1);
    expect(advanced).toEqual(["r1"]);
  });

  test("sends only the canned message — never the queued inline comments", async () => {
    const store = makeStore();
    const resolve = build(store, { annotations: [TIGHTEN_ANNOTATION] });
    await resolve.reject();
    expect(submits).toHaveLength(1);
    expect(submits[0]!.body.feedback).not.toContain("tighten");
  });

  test("flushes the pending draft before submitting", async () => {
    await expectFlushesBeforeSubmit((resolve) => resolve.reject());
  });

  test("an HttpError (already resolved elsewhere) still advances", async () => {
    await expectHttpErrorAdvances((resolve) => resolve.reject());
  });

  test("a 409 (a newer version arrived) stays on the review", async () => {
    await expectSupersededStays((resolve) => resolve.reject());
  });

  test("a network failure flips offline and does NOT advance", async () => {
    await expectNetworkFailureBlocksAdvance((resolve) => resolve.reject());
  });

  test("no-ops when nothing is active", async () => {
    await expectNoopWhenInactive((resolve) => resolve.reject());
  });
});

describe("remembering the approve mode", () => {
  test("persists the mode once the allow lands", async () => {
    const resolve = build(makeStore());
    await resolve.approve("auto");
    expect(saved).toEqual(["auto"]);
  });

  test("persists nothing when the submit fails, so the next plan keeps the old default", async () => {
    submitResult = () => Promise.reject(new Error("offline"));
    const resolve = build(makeStore());
    await resolve.approve("auto");
    expect(saved).toEqual([]);
  });
});
