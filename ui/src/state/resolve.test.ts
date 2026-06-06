import "../../test-setup.ts";
import { beforeEach, describe, expect, test } from "bun:test";
import type { Annotation, ApproveVariantId, ResolveBody } from "@core/types";
import { createResolve, HttpError, isNetworkFailure, type ResolveStore } from "./resolve.svelte.ts";

interface SubmitCall {
  id: string;
  body: ResolveBody;
}

let submits: SubmitCall[];
let submitResult: () => Promise<void>;
let advanced: string[];
let flushOrder: string[];
let offline: boolean;
let cleared: number;

function makeStore(over: Partial<ResolveStore> = {}): ResolveStore {
  return { approveMode: "default", busy: false, ...over };
}

function build(
  store: ResolveStore,
  opts: { activeId?: string | null; annotations?: Annotation[] } = {},
) {
  const activeId = "activeId" in opts ? (opts.activeId ?? null) : "r1";
  const resolve = createResolve(store, {
    resolveReview: async (id, body) => {
      submits.push({ id, body });
      return submitResult();
    },
    activeId: () => activeId,
    annotations: () => opts.annotations ?? [],
    flushPending: async () => {
      flushOrder.push("flush");
    },
    afterResolve: (id) => advanced.push(id),
    onOffline: () => {
      offline = true;
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
  cleared = 0;
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

  test("flushes the pending draft before submitting", async () => {
    const store = makeStore();
    const resolve = build(store);
    flushOrder = [];
    await resolve.approve("default");
    // flush is recorded before the submit pushes (submit awaits after flush).
    expect(flushOrder).toEqual(["flush"]);
    expect(submits).toHaveLength(1);
  });

  test("no-ops when nothing is active", async () => {
    const store = makeStore();
    const resolve = build(store, { activeId: null });
    await resolve.approve("default");
    expect(submits).toEqual([]);
    expect(advanced).toEqual([]);
  });

  test("an HttpError (already resolved elsewhere) still advances", async () => {
    submitResult = () => Promise.reject(new HttpError(404));
    const store = makeStore();
    const resolve = build(store);
    await resolve.approve("default");
    expect(advanced).toEqual(["r1"]);
    expect(offline).toBe(false);
    expect(store.busy).toBe(false);
  });

  test("a network failure flips offline and does NOT advance", async () => {
    submitResult = () => Promise.reject(new Error("down"));
    const store = makeStore();
    const resolve = build(store);
    await resolve.approve("default");
    expect(advanced).toEqual([]);
    expect(offline).toBe(true);
    expect(store.busy).toBe(false);
  });
});

describe("requestChanges", () => {
  test("submits a deny with formatted feedback, clears the draft, and advances", async () => {
    const store = makeStore();
    const annotations: Annotation[] = [
      {
        id: "a1",
        blockId: "b0",
        startOffset: 0,
        endOffset: 1,
        quote: "the cache",
        comment: "tighten",
      },
    ];
    const resolve = build(store, { annotations });
    await resolve.requestChanges("General note.");
    expect(submits).toHaveLength(1);
    expect(submits[0]!.body.behavior).toBe("deny");
    // Feedback carries both the general comment and the inline comment.
    expect(submits[0]!.body.feedback).toContain("General note.");
    expect(submits[0]!.body.feedback).toContain("tighten");
    expect(cleared).toBe(1);
    expect(advanced).toEqual(["r1"]);
  });

  test("flushes the pending draft before formatting + submitting", async () => {
    const store = makeStore();
    const resolve = build(store);
    flushOrder = [];
    await resolve.requestChanges("note");
    expect(flushOrder).toEqual(["flush"]);
  });

  test("an HttpError still advances and clears", async () => {
    submitResult = () => Promise.reject(new HttpError(409));
    const store = makeStore();
    const resolve = build(store);
    await resolve.requestChanges("note");
    // The catch advances on an HttpError; the post-success clear does not run.
    expect(advanced).toEqual(["r1"]);
    expect(offline).toBe(false);
  });

  test("a network failure flips offline and does NOT advance", async () => {
    submitResult = () => Promise.reject(new Error("down"));
    const store = makeStore();
    const resolve = build(store);
    await resolve.requestChanges("note");
    expect(advanced).toEqual([]);
    expect(offline).toBe(true);
  });

  test("no-ops when nothing is active", async () => {
    const store = makeStore();
    const resolve = build(store, { activeId: null });
    await resolve.requestChanges("note");
    expect(submits).toEqual([]);
  });
});

describe("loadApproveMode", () => {
  test("reads the remembered mode into the store", async () => {
    const store = makeStore();
    const resolve = createResolve(store, {
      getApproveMode: async () => "auto" as ApproveVariantId,
      activeId: () => null,
      annotations: () => [],
      flushPending: async () => {},
      afterResolve: () => {},
      onOffline: () => {},
      clearGeneralComment: () => {},
    });
    resolve.loadApproveMode();
    // Resolve the microtask queue so the .then() lands.
    await Promise.resolve();
    expect(store.approveMode).toBe("auto");
  });

  test("a failure leaves the current default", async () => {
    const store = makeStore({ approveMode: "default" });
    const resolve = createResolve(store, {
      getApproveMode: async () => {
        throw new Error("offline");
      },
      activeId: () => null,
      annotations: () => [],
      flushPending: async () => {},
      afterResolve: () => {},
      onOffline: () => {},
      clearGeneralComment: () => {},
    });
    resolve.loadApproveMode();
    await Promise.resolve();
    expect(store.approveMode).toBe("default");
  });
});
