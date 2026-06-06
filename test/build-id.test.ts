import { expect, test } from "bun:test";
import pkg from "../package.json" with { type: "json" };
import { buildHash, IDENTITY, VERSION } from "../src/build-id.ts";

// computeBuildId / resolveCommit are covered in test/cli.test.ts. These tests
// pin the static identity surface that moved alongside the build fingerprint.

test("VERSION reflects package.json (honest identity, not the stale 0.0.1 hardcode)", () => {
  expect(VERSION).toBe(pkg.version);
});

test("IDENTITY names the caret service at the current version", () => {
  expect(IDENTITY).toEqual({ service: "caret", version: pkg.version });
});

test("buildHash is stable for identical input and differs for changed input", () => {
  expect(buildHash("<html>a</html>")).toBe(buildHash("<html>a</html>"));
  expect(buildHash("<html>a</html>")).not.toBe(buildHash("<html>b</html>"));
});

test("buildHash returns 'no-ui' when the UI is undefined", () => {
  expect(buildHash(undefined)).toBe("no-ui");
});
