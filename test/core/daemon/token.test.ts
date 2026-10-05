import { expect, test } from "bun:test";
import { rmSync, statSync, writeFileSync } from "node:fs";

import { setupTempStateDir } from "@test/support/env.ts";
import { daemonTokenFile } from "@/config/paths.ts";
import { loadOrMintToken, readToken } from "@/daemon/token.ts";

setupTempStateDir("caret-token-");

test("a missing token file is minted owner-only with at least 128 bits", () => {
  const token = loadOrMintToken(daemonTokenFile());
  expect(Buffer.from(token, "base64url").length).toBeGreaterThanOrEqual(16);
  expect(statSync(daemonTokenFile()).mode & 0o777).toBe(0o600);
});

test("an existing token file is reused", () => {
  const first = loadOrMintToken(daemonTokenFile());
  expect(loadOrMintToken(daemonTokenFile())).toBe(first);
});

test("a deleted token file is re-minted with a new token", () => {
  const first = loadOrMintToken(daemonTokenFile());
  rmSync(daemonTokenFile());
  expect(loadOrMintToken(daemonTokenFile())).not.toBe(first);
});

test("readToken is null for a missing or empty file", () => {
  expect(readToken(daemonTokenFile())).toBeNull();
  loadOrMintToken(daemonTokenFile());
  writeFileSync(daemonTokenFile(), "");
  expect(readToken(daemonTokenFile())).toBeNull();
});

test("readToken trims a trailing newline", () => {
  loadOrMintToken(daemonTokenFile());
  writeFileSync(daemonTokenFile(), "abc\n");
  expect(readToken(daemonTokenFile())).toBe("abc");
});
