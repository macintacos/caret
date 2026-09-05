import { expect, test } from "bun:test";

import { parseReviewUrl } from "@opencode/caret.plugin.ts";
import { browserOpenCmd, reviewUrlLine } from "@/commands/review.ts";

// browserOpenCmd is the pure platform→argv selection extracted from openBrowser
// so the branch choice is testable without spawning (the spawn-and-swallow stays
// at the call site). caret is macOS-first; the non-darwin branches ship but are
// exercised primarily on macOS — these assertions pin each branch's exact argv.

const URL = "http://caret.localhost:4242/?review=rid";

test("darwin uses `open`", () => {
  expect(browserOpenCmd("darwin", URL)).toEqual(["open", URL]);
});

test("win32 uses `cmd /c start`", () => {
  expect(browserOpenCmd("win32", URL)).toEqual(["cmd", "/c", "start", "", URL]);
});

test("linux uses `xdg-open`", () => {
  expect(browserOpenCmd("linux", URL)).toEqual(["xdg-open", URL]);
});

test("any other platform falls back to `xdg-open`", () => {
  expect(browserOpenCmd("freebsd", URL)).toEqual(["xdg-open", URL]);
});

// The review URL crosses to the OpenCode plugin as text on stderr, so the two ends
// are only in contract as long as the producer's wording still parses. Nothing else
// compares them.
test("the announced line is the one the OpenCode plugin parses back", () => {
  expect(parseReviewUrl(reviewUrlLine(URL))).toBe(URL);
});
