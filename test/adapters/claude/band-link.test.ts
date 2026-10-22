// `caret band-link`: the link Claude Code's plan-waiting band (mod/hooks/band.tsx) shows.
// Covers the pure halves — the bounded poll for the session's review and the link itself.

import { expect, test } from "bun:test";

import { awaitPendingReview, type BandLinkDeps, bandLink } from "@/commands/band-link.ts";

function deps(answers: Array<string | undefined | Error>, sleeps: number[] = []): BandLinkDeps {
  return {
    pendingReviewId: async () => {
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  };
}

test("awaitPendingReview returns the review found on the first poll", async () => {
  const sleeps: number[] = [];
  expect(await awaitPendingReview(deps(["r1"], sleeps))).toBe("r1");
  expect(sleeps).toEqual([]);
});

test("awaitPendingReview keeps polling through rejections and empty answers", async () => {
  const sleeps: number[] = [];
  const found = await awaitPendingReview(
    deps([new Error("no daemon"), undefined, "r2"], sleeps),
    25,
    200,
  );
  expect(found).toBe("r2");
  expect(sleeps).toEqual([200, 200]);
});

test("awaitPendingReview gives up after its attempt budget", async () => {
  const sleeps: number[] = [];
  const found = await awaitPendingReview(deps([], sleeps), 3, 50);
  expect(found === undefined).toBe(true);
  expect(sleeps).toEqual([50, 50]);
});

test("bandLink points at the review when one was found", () => {
  expect(bandLink("http://127.0.0.1:42718", "caret.localhost", "r1", null)).toBe(
    "http://caret.localhost:42718/?review=r1",
  );
});

test("bandLink falls back to caret's UI root without a review", () => {
  expect(bandLink("http://127.0.0.1:42718", "caret.localhost", undefined, null)).toBe(
    "http://caret.localhost:42718/",
  );
});

test("bandLink logs the browser in when given a token", () => {
  expect(bandLink("http://127.0.0.1:42718", "caret.localhost", "r1", "t0k")).toBe(
    "http://caret.localhost:42718/?review=r1&token=t0k",
  );
});
