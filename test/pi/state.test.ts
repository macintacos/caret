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
});

describe("reviewStore", () => {
  test("keeps one store per holder", () => {
    const holder = {};
    expect(reviewStore(holder)).toBe(reviewStore(holder));
    expect(reviewStore({})).not.toBe(reviewStore(holder));
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
