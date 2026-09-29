import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  parseOpencodeVersion,
  pluginKeyFor,
  readOpencodeVersion,
} from "@/adapters/opencode/host.ts";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "caret-oc-host-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** A fake `opencode` whose `--version` runs `body`. */
function shim(body: string): string {
  const bin = join(dir, "opencode");
  writeFileSync(bin, `#!/bin/sh\n${body}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test("parses v2's prefixed version and v1's bare one", () => {
  expect(parseOpencodeVersion("opencode v2.0.18\n")).toEqual([2, 0, 18]);
  expect(parseOpencodeVersion("1.14.17\n")).toEqual([1, 14, 17]);
});

test("rejects output that is not a version", () => {
  expect(parseOpencodeVersion("")).toBeNull();
  expect(parseOpencodeVersion("error: unknown flag")).toBeNull();
  expect(parseOpencodeVersion("opencode 2.0")).toBeNull();
});

test("reads the version a binary prints", () => {
  expect(readOpencodeVersion({ bin: shim("echo opencode v2.0.18") })).toEqual([2, 0, 18]);
  expect(readOpencodeVersion({ bin: shim("echo 1.18.29") })).toEqual([1, 18, 29]);
});

test("a failing binary or no binary reads as unknown", () => {
  expect(readOpencodeVersion({ bin: shim("echo 2.0.18; exit 1") })).toBeNull();
  expect(readOpencodeVersion({ bin: null })).toBeNull();
});

test("a hung binary is killed at the bound, even with a grandchild holding stdout", () => {
  const bin = shim("sleep 30; echo 2.0.18");
  const start = performance.now();
  expect(readOpencodeVersion({ bin, timeoutMs: 200 })).toBeNull();
  expect(performance.now() - start).toBeLessThan(1_000);
});

test("v2 loads caret from plugins; v1 and an unknown host from plugin", () => {
  expect(pluginKeyFor([2, 0, 18])).toBe("plugins");
  expect(pluginKeyFor([1, 18, 29])).toBe("plugin");
  expect(pluginKeyFor(null)).toBe("plugin");
});
