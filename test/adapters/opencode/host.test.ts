import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  hostCheck,
  hostConfigFilenames,
  loadedConfigFiles,
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

test("the host check passes when caret sits in the key its host loads", () => {
  expect(hostCheck([2, 0, 18], ["plugins"], []).status).toBe("pass");
  expect(hostCheck([1, 18, 29], ["plugin"], []).status).toBe("pass");
});

test("the host check fails for caret in plugin on v2", () => {
  expect(hostCheck([2, 0, 18], ["plugin"], []).status).toBe("fail");
  expect(hostCheck([2, 0, 18], ["plugin", "plugins"], []).status).toBe("fail");
});

test("the host check fails for caret in plugins on v1, naming the version that starts", () => {
  const check = hostCheck([1, 18, 29], ["plugins"], []);
  expect(check.status).toBe("fail");
  expect(check.detail).toContain("1.18.16");
});

test("the host check fails for a v1 too old to load caret", () => {
  expect(hostCheck([1, 3, 3], ["plugin"], []).status).toBe("fail");
  expect(hostCheck([1, 3, 4], ["plugin"], []).status).toBe("pass");
});

test("the host check joins every fault it finds", () => {
  const check = hostCheck([1, 3, 3], ["plugins"], []);
  expect(check.status).toBe("fail");
  expect(check.detail).toContain("; ");
  expect(check.status === "fail" && check.remedy).toContain("; ");
});

test("the host check is unknown when the version cannot be read", () => {
  expect(hostCheck(null, ["plugin"], []).status).toBe("unknown");
});

test("v1 loads config.json; v2 and an unknown host load only the opencode files", () => {
  expect(hostConfigFilenames([1, 18, 29])).toContain("config.json");
  expect(hostConfigFilenames([2, 0, 18])).toEqual(["opencode.jsonc", "opencode.json"]);
  expect(hostConfigFilenames(null)).toEqual(["opencode.jsonc", "opencode.json"]);
});

test("loadedConfigFiles keeps only the files the host reads", () => {
  const files = ["/c/opencode.jsonc", "/c/config.json"];
  expect(loadedConfigFiles(files, [2, 0, 18])).toEqual(["/c/opencode.jsonc"]);
  expect(loadedConfigFiles(files, [1, 18, 29])).toEqual(files);
});

test("the host check fails for caret in a file the host ignores, naming the file", () => {
  expect(hostCheck([2, 0, 18], ["plugins"], ["/c/config.json"])).toMatchObject({
    status: "fail",
    detail: expect.stringContaining("config.json"),
    remedy: expect.stringContaining("caret install"),
  });
});
