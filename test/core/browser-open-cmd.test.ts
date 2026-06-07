import { expect, test } from "bun:test";
import { browserOpenCmd } from "../../src/commands/review.ts";

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
