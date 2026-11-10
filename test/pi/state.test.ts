import { describe, expect, test } from "bun:test";

import { createReviewStore, footerText, reviewStore } from "@piext/state.ts";

describe("createReviewStore", () => {
  test("an unseen session is not planning", () => {
    expect(createReviewStore().get("s1")).toEqual({ planning: false });
  });

  test("update merges a patch into one session only", () => {
    const store = createReviewStore();
    store.update("s1", { planning: true });
    store.update("s1", { pending: "http://x/r/1" });
    expect(store.get("s1")).toEqual({ planning: true, pending: "http://x/r/1" });
    expect(store.get("s2")).toEqual({ planning: false });
  });

  test("a subscriber hears each update until it unsubscribes", () => {
    const store = createReviewStore();
    const calls: [string, unknown][] = [];
    const stop = store.subscribe((id, state) => calls.push([id, state]));
    store.update("s1", { lastOutcome: "approved" });
    stop();
    store.update("s1", { planning: true });
    expect(calls).toEqual([["s1", { planning: false, lastOutcome: "approved" }]]);
  });

  test("a throwing subscriber neither fails the update nor starves the next one", () => {
    const store = createReviewStore();
    const heard: string[] = [];
    store.subscribe(() => {
      throw new Error("footer broke");
    });
    store.subscribe((id) => heard.push(id));
    expect(() => store.update("s1", { planning: true })).not.toThrow();
    expect(heard).toEqual(["s1"]);
  });
});

describe("reviewStore", () => {
  test("calls on one holder share sessions and subscribers", () => {
    const holder = {};
    const heard: string[] = [];
    reviewStore(holder).subscribe((id) => heard.push(id));
    reviewStore(holder).update("s1", { planning: true });
    expect(reviewStore(holder).get("s1")).toEqual({ planning: true });
    expect(heard).toEqual(["s1"]);
  });

  test("a fresh holder shares nothing", () => {
    const holder = {};
    const heard: string[] = [];
    reviewStore(holder).subscribe((id) => heard.push(id));
    reviewStore({}).update("s1", { planning: true });
    expect(reviewStore(holder).get("s1")).toEqual({ planning: false });
    expect(heard).toEqual([]);
  });

  test("the holder keeps only data, so each module instance runs its own methods", () => {
    const holder: Record<symbol, unknown> = {};
    reviewStore(holder);
    const stored = Object.values(Object.getOwnPropertySymbols(holder).map((k) => holder[k]))[0];
    expect(Object.values(stored as object).some((v) => typeof v === "function")).toBe(false);
  });
});

describe("footerText", () => {
  test("a waiting plan wins over planning", () => {
    expect(footerText({ planning: false, pending: "u" })).toBe("^ plan waiting");
    expect(footerText({ planning: true, pending: "u" })).toBe("^ plan waiting");
  });

  test("planning alone shows planning", () => {
    expect(footerText({ planning: true })).toBe("^ planning");
  });

  test("an idle session clears the footer", () => {
    expect(footerText({ planning: false })).toBeUndefined();
  });
});
